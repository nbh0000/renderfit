import { requireAdmin } from "@/lib/admin-api";
import { recordIncident } from "@/lib/incidents";
import { TOSS_API, tossAuthHeader, tossSecretKey } from "@/lib/payments/server";

/**
 * 환불.
 *
 * 토스에 취소를 요청하고, 성공하면 우리 장부(payments)에 환불 금액을 적는다.
 * 부분 환불이 가능하므로 금액을 받는다 — 비우면 남은 전액이다.
 *
 * 토스 콘솔에서 직접 취소한 뒤 장부만 맞추는 경우는 manual 로 표시한다. 그때는
 * 토스를 다시 부르지 않는다 (두 번 취소하면 오류만 난다).
 *
 * 전액 환불이고 endSubscription 이면 구독을 끝내고 요금제를 무료로 되돌린다.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const { writer, viewer } = guard;

  const body = (await request.json().catch(() => ({}))) as {
    amount?: unknown;
    reason?: unknown;
    manual?: unknown;
    endSubscription?: unknown;
  };
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
  if (!reason) return Response.json({ error: "환불 사유를 적어 주세요." }, { status: 400 });

  const { data: payment } = await writer
    .from("payments")
    .select("id, user_id, payment_key, plan, amount, status, refunded_amount, subscription_id")
    .eq("id", id)
    .maybeSingle();

  if (!payment) return Response.json({ error: "결제를 찾을 수 없습니다." }, { status: 404 });
  if (!["paid", "refunded"].includes(payment.status)) {
    return Response.json({ error: "승인된 결제만 환불할 수 있습니다." }, { status: 400 });
  }

  const remaining = payment.amount - payment.refunded_amount;
  if (remaining <= 0)
    return Response.json({ error: "이미 전액 환불된 결제입니다." }, { status: 400 });

  const amount =
    typeof body.amount === "number" && Number.isInteger(body.amount) && body.amount > 0
      ? Math.min(body.amount, remaining)
      : remaining;

  const manual = body.manual === true;

  /* 1) 결제대행사에 취소 요청 */
  if (!manual) {
    if (!tossSecretKey()) {
      return Response.json(
        {
          error:
            "토스 시크릿 키가 없어 취소를 보낼 수 없습니다. 토스 콘솔에서 취소한 뒤 '장부만 반영'으로 적어 주세요.",
        },
        { status: 400 }
      );
    }
    if (!payment.payment_key) {
      return Response.json(
        { error: "결제 키가 없는 결제입니다. 토스 콘솔에서 확인해 주세요." },
        { status: 400 }
      );
    }

    const response = await fetch(`${TOSS_API}/payments/${payment.payment_key}/cancel`, {
      method: "POST",
      headers: {
        Authorization: tossAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cancelReason: reason,
        ...(amount < remaining ? { cancelAmount: amount } : {}),
      }),
    });

    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
      };
      await recordIncident({
        kind: "payment_failed",
        userId: payment.user_id,
        message: `환불 요청 실패 — ${detail.message ?? response.status}`,
        context: {
          paymentId: id,
          amount,
          code: detail.code,
          by: viewer.authEmail,
        },
      });
      return Response.json(
        {
          error: `토스가 취소를 거절했습니다: ${detail.message ?? response.status}`,
        },
        { status: 502 }
      );
    }
  }

  /* 2) 장부 반영 */
  const refundedTotal = payment.refunded_amount + amount;
  const fullyRefunded = refundedTotal >= payment.amount;

  const { error: updateError } = await writer
    .from("payments")
    .update({
      refunded_amount: refundedTotal,
      status: fullyRefunded ? "refunded" : "paid",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateError) {
    // 돈은 돌려줬는데 장부가 안 맞는 상태 — 반드시 사람이 봐야 한다
    await recordIncident({
      kind: "payment_orphaned",
      userId: payment.user_id,
      message: `환불은 됐는데 장부 반영에 실패했습니다 — ${updateError.message}`,
      context: { paymentId: id, amount, by: viewer.authEmail },
    });
    return Response.json(
      {
        error: "환불은 됐지만 장부 반영에 실패했습니다. 사고 목록을 확인해 주세요.",
      },
      { status: 500 }
    );
  }

  /* 3) 구독 종료 */
  let subscriptionEnded = false;
  if (fullyRefunded && body.endSubscription === true) {
    if (payment.subscription_id) {
      await writer
        .from("subscriptions")
        .update({
          status: "expired",
          canceled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", payment.subscription_id);
    }
    await writer.rpc("expire_plan", { p_user: payment.user_id });
    subscriptionEnded = true;
  }

  await recordIncident({
    kind: "admin_action",
    userId: payment.user_id,
    message: `환불 ${amount.toLocaleString("ko-KR")}원${manual ? " (장부만 반영)" : ""}${subscriptionEnded ? ", 구독 종료" : ""} — ${reason}`,
    context: { paymentId: id, amount, manual, by: viewer.authEmail },
  });

  return Response.json({
    ok: true,
    refundedAmount: refundedTotal,
    fullyRefunded,
    subscriptionEnded,
  });
}
