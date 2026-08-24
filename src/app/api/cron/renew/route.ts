import { getPlan, type PlanId } from "@/config/plans";
import { canSellOnServer, tossAuthHeader, TOSS_API } from "@/lib/payments/server";
import {
  afterFailure,
  decideRenewal,
  nextPeriodEnd,
  type SubscriptionRow,
} from "@/lib/payments/renewal";
import { createAdminSupabase } from "@/lib/supabase/server";

/**
 * 매월 자동결제.
 *
 * 첫 결제는 사용자가 카드를 등록할 때 끝난다. 둘째 달부터는 우리가 빌링키로 직접
 * 청구해야 하고, 그 일을 이 라우트가 한다. 하루에 한 번(가능하면 몇 번) 부르면 된다.
 *
 * 판단은 전부 renewal.ts에 있다 — 여기서는 그 판단을 따라 결제대행사를 부르고 결과를
 * 적기만 한다. 그래야 규칙을 결제 키 없이 시험할 수 있다.
 *
 * 부르는 쪽 예:
 *   curl -X POST https://<도메인>/api/cron/renew -H "x-cron-secret: <CRON_SECRET>"
 */

/** 한 번에 처리할 구독 수 — 함수 실행 시간이 길어지지 않게 끊는다 */
const BATCH = 50;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "CRON_SECRET이 설정되지 않았습니다." }, { status: 503 });
  }
  if (request.headers.get("x-cron-secret") !== secret) {
    return Response.json({ error: "권한이 없습니다." }, { status: 401 });
  }

  const sellable = canSellOnServer();
  if (!sellable.ok) {
    return Response.json({ error: sellable.reason }, { status: 503 });
  }

  const admin = createAdminSupabase();
  if (!admin) return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const now = new Date();

  const { data: due, error } = await admin
    .from("subscriptions")
    .select("id, user_id, plan, billing_key, status, period_end, failed_attempts, retry_at")
    .in("status", ["active", "past_due", "canceled"])
    .lte("period_end", now.toISOString())
    .order("period_end", { ascending: true })
    .limit(BATCH);

  if (error) {
    console.error("[cron] 구독을 읽지 못했습니다:", error.message);
    return Response.json({ error: "구독을 읽지 못했습니다." }, { status: 500 });
  }

  const tally = { charged: 0, failed: 0, expired: 0, skipped: 0 };

  for (const row of (due ?? []) as SubscriptionRow[]) {
    const action = decideRenewal(row, now);

    if (action.kind === "skip") {
      tally.skipped += 1;
      continue;
    }

    if (action.kind === "expire") {
      await admin
        .from("subscriptions")
        .update({ status: "expired", updated_at: now.toISOString() })
        .eq("id", row.id);
      await admin.rpc("expire_plan", { p_user: row.user_id });

      tally.expired += 1;
      console.info(`[cron] 구독 종료 ${row.id} — ${action.reason}`);
      continue;
    }

    /*
     * 주문을 먼저 pending으로 적는다.
     *
     * order_id에 유니크 제약이 걸려 있으므로, 스케줄러가 겹쳐 돌아도 같은 주기를 두 번
     * 청구할 수 없다. 여기서 막히면 이미 다른 실행이 처리한 것이니 조용히 넘어간다.
     */
    const { data: order, error: orderError } = await admin
      .from("payments")
      .insert({
        user_id: row.user_id,
        subscription_id: row.id,
        order_id: action.orderId,
        plan: action.plan,
        amount: action.amount,
        status: "pending",
      })
      .select("id")
      .maybeSingle();

    if (orderError || !order) {
      tally.skipped += 1;
      continue;
    }

    try {
      const charged = await fetch(`${TOSS_API}/billing/${row.billing_key}`, {
        method: "POST",
        headers: { Authorization: tossAuthHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({
          customerKey: row.user_id,
          orderId: action.orderId,
          orderName: `렌더핏 ${getPlan(action.plan as PlanId)?.label ?? action.plan} 요금제`,
          amount: action.amount,
        }),
      });

      const payment = (await charged.json()) as { paymentKey?: string; message?: string };

      if (!charged.ok || !payment.paymentKey) {
        throw new Error(payment.message ?? "승인 실패");
      }

      /* 성공 — 주기를 늘리고 크레딧을 채운다 */
      await admin
        .from("payments")
        .update({ status: "paid", payment_key: payment.paymentKey, updated_at: now.toISOString() })
        .eq("id", order.id);

      await admin
        .from("subscriptions")
        .update({
          status: "active",
          period_start: row.period_end,
          period_end: action.periodEnd,
          failed_attempts: 0,
          retry_at: null,
          updated_at: now.toISOString(),
        })
        .eq("id", row.id);

      const plan = getPlan(action.plan as PlanId);
      await admin.rpc("apply_paid_plan", {
        p_user: row.user_id,
        p_plan: action.plan,
        p_credits: plan?.monthlyCredits ?? 0,
      });

      tally.charged += 1;
    } catch (thrown) {
      const reason = thrown instanceof Error ? thrown.message : "승인 실패";
      const next = afterFailure(row, now);

      await admin
        .from("payments")
        .update({ status: "failed", failure_reason: reason.slice(0, 300), updated_at: now.toISOString() })
        .eq("id", order.id);

      await admin
        .from("subscriptions")
        .update({ ...next, updated_at: now.toISOString() })
        .eq("id", row.id);

      if (next.status === "expired") {
        await admin.rpc("expire_plan", { p_user: row.user_id });
        tally.expired += 1;
      } else {
        tally.failed += 1;
      }

      console.warn(`[cron] 자동결제 실패 ${row.id} (${next.failed_attempts}회) — ${reason}`);
    }
  }

  console.info("[cron] 자동결제 마침:", tally);
  return Response.json({ ok: true, ...tally });
}

/** 스케줄러가 살아 있는지 확인용 */
export async function GET() {
  return Response.json({ ok: true, hint: "POST에 x-cron-secret 헤더를 붙여 부르세요." });
}
