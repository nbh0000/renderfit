import { getViewer } from "@/lib/auth";
import { getPlan, type PlanId } from "@/config/plans";
import { canSellOnServer } from "@/lib/payments/server";
import { createAdminSupabase } from "@/lib/supabase/server";

/**
 * 결제를 준비한다 — 주문번호를 서버에서 발급한다.
 *
 * 주문번호와 금액을 클라이언트가 만들면 금액을 바꿔치기할 수 있다. 여기서 요금제를
 * 보고 금액을 정해 pending 상태로 먼저 기록해 두고, 승인 단계에서 그 기록과 대조한다.
 */
export async function POST(request: Request) {
  const sellable = canSellOnServer();
  if (!sellable.ok) {
    return Response.json({ error: sellable.reason }, { status: 503 });
  }

  const viewer = await getViewer();
  if (!viewer.userId) {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let body: { planId?: PlanId };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const plan = body.planId ? getPlan(body.planId) : null;
  if (!plan || plan.priceMonthly <= 0) {
    return Response.json({ error: "유료 요금제를 골라 주세요." }, { status: 400 });
  }

  const admin = createAdminSupabase();
  if (!admin) {
    return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  }

  const orderId = `renderfit_${plan.id}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

  const { error } = await admin.from("payments").insert({
    user_id: viewer.userId,
    order_id: orderId,
    plan: plan.id,
    amount: plan.priceMonthly,
    status: "pending",
  });

  if (error) {
    console.error("[payments] 주문을 만들지 못했습니다:", error.message);
    return Response.json({ error: "결제를 준비하지 못했습니다." }, { status: 500 });
  }

  return Response.json({
    orderId,
    orderName: `렌더핏 ${plan.label} 요금제`,
    // 토스는 사용자를 이 값으로 식별해 빌링키와 묶는다
    customerKey: viewer.userId,
    amount: plan.priceMonthly,
  });
}
