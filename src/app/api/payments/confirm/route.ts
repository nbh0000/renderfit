import { recordIncident } from "@/lib/incidents";
import { getViewer } from "@/lib/auth";
import { getPlan, type PlanId } from "@/config/plans";
import { canSellOnServer, tossAuthHeader, TOSS_API } from "@/lib/payments/server";
import { createAdminSupabase } from "@/lib/supabase/server";

/**
 * 카드 등록이 끝난 뒤 첫 결제를 승인한다.
 *
 * 토스는 빌링 인증이 끝나면 이 주소로 authKey와 customerKey를 붙여 사용자를 되돌려
 * 보낸다. 여기서 두 단계를 밟는다.
 *
 *  1. authKey로 빌링키를 발급받는다 (다음 달부터 이 키로 자동결제를 건다)
 *  2. 빌링키로 첫 달 금액을 승인한다
 *
 * 금액은 클라이언트가 보낸 값을 믿지 않고, prepare 단계에서 서버가 기록해 둔 주문에서
 * 읽는다. 그렇게 해야 금액을 바꿔치기당하지 않는다.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");
  const authKey = url.searchParams.get("authKey");
  const customerKey = url.searchParams.get("customerKey");

  const fail = (reason: string) =>
    Response.redirect(`${url.origin}/pricing?payment=failed&reason=${encodeURIComponent(reason)}`, 303);

  const sellable = canSellOnServer();
  if (!sellable.ok) return fail(sellable.reason ?? "결제를 받을 수 없습니다.");
  if (!orderId || !authKey || !customerKey) return fail("결제 정보가 올바르지 않습니다.");

  const viewer = await getViewer();
  if (!viewer.userId || viewer.userId !== customerKey) return fail("로그인 정보가 다릅니다.");

  const admin = createAdminSupabase();
  if (!admin) return fail("서버 설정 오류입니다.");

  /* 1) 서버가 만들어 둔 주문을 찾는다 — 금액의 근거는 이것뿐이다 */
  const { data: order } = await admin
    .from("payments")
    .select("id, plan, amount, status, user_id")
    .eq("order_id", orderId)
    .maybeSingle();

  if (!order || order.user_id !== viewer.userId) return fail("주문을 찾을 수 없습니다.");
  if (order.status !== "pending") return fail("이미 처리된 주문입니다.");

  const plan = getPlan(order.plan as PlanId);
  if (!plan) return fail("요금제를 찾을 수 없습니다.");

  const markFailed = async (reason: string) => {
    await admin
      .from("payments")
      .update({ status: "failed", failure_reason: reason.slice(0, 300), updated_at: new Date().toISOString() })
      .eq("id", order.id);
    return fail(reason);
  };

  try {
    /* 2) 빌링키 발급 */
    const issued = await fetch(`${TOSS_API}/billing/authorizations/issue`, {
      method: "POST",
      headers: { Authorization: tossAuthHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({ authKey, customerKey }),
    });

    const billing = (await issued.json()) as { billingKey?: string; message?: string };
    if (!issued.ok || !billing.billingKey) {
      return markFailed(billing.message ?? "카드 등록에 실패했습니다.");
    }

    /* 3) 첫 달 승인 */
    const charged = await fetch(`${TOSS_API}/billing/${billing.billingKey}`, {
      method: "POST",
      headers: { Authorization: tossAuthHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        customerKey,
        orderId,
        orderName: `렌더핏 ${plan.label} 요금제`,
        amount: order.amount,
      }),
    });

    const payment = (await charged.json()) as { paymentKey?: string; message?: string };
    if (!charged.ok || !payment.paymentKey) {
      return markFailed(payment.message ?? "결제 승인에 실패했습니다.");
    }

    /* 4) 구독을 만들고 요금제·크레딧을 반영한다 */
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const { data: subscription } = await admin
      .from("subscriptions")
      .insert({
        user_id: viewer.userId,
        plan: plan.id,
        billing_key: billing.billingKey,
        period_start: now.toISOString(),
        period_end: periodEnd.toISOString(),
      })
      .select("id")
      .maybeSingle();

    await admin
      .from("payments")
      .update({
        status: "paid",
        payment_key: payment.paymentKey,
        subscription_id: subscription?.id ?? null,
        updated_at: now.toISOString(),
      })
      .eq("id", order.id);

    const { error: applyError } = await admin.rpc("apply_paid_plan", {
      p_user: viewer.userId,
      p_plan: plan.id,
      p_credits: plan.monthlyCredits,
    });

    if (applyError) {
      // 돈은 받았는데 요금제가 안 올라간 상태 — 조용히 넘기면 안 된다
      await recordIncident({
        kind: "payment_orphaned",
        userId: viewer.userId,
        message: `결제는 승인됐는데 요금제 반영에 실패했습니다 — ${applyError.message}`,
        context: { orderId, plan: plan.id, amount: order.amount, paymentKey: payment.paymentKey },
      });
      return fail("결제는 됐지만 요금제 반영에 실패했습니다. 문의해 주세요.");
    }

    return Response.redirect(`${url.origin}/pricing?payment=done`, 303);
  } catch (error) {
    return markFailed(error instanceof Error ? error.message : "결제 처리 중 오류가 발생했습니다.");
  }
}
