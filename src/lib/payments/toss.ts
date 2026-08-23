import type { PlanId } from "@/config/plans";
import { isBusinessRegistered } from "@/config/business";

/**
 * 토스페이먼츠 정기결제 어댑터 (클라이언트 쪽).
 *
 * 흐름은 이렇다.
 *
 *  1. 여기서 빌링 인증 창을 띄운다 (카드 등록)
 *  2. 성공하면 토스가 successUrl로 authKey와 customerKey를 붙여 되돌려 보낸다
 *  3. /api/payments/confirm 이 시크릿 키로 빌링키를 발급받고 첫 결제를 승인한다
 *  4. 승인되면 요금제를 올리고 그 달 크레딧을 채운다
 *
 * 매월 갱신은 서버가 빌링키로 자동결제를 걸어야 한다 (스케줄러 필요).
 */

export interface CheckoutRequest {
  planId: PlanId;
  amount: number;
  customerEmail?: string | null;
  /** 사용자를 가리키는 값 — 토스에 넘겨 빌링키와 묶는다 */
  customerKey?: string;
}

export interface CheckoutResult {
  ok: boolean;
  message: string;
}

export function tossClientKey(): string {
  return process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY ?? "";
}

export function isTossConfigured(): boolean {
  return Boolean(tossClientKey());
}

/**
 * 결제를 열어도 되는 상태인가.
 *
 * 결제 키만 있으면 되는 게 아니다. 사업자 정보를 표시하지 않은 채 돈을 받으면
 * 전자상거래법 위반이라 결제 자체를 막는다.
 */
export function canSell(): { ok: boolean; reason?: string } {
  if (!isBusinessRegistered()) {
    return { ok: false, reason: "사업자 정보 등록이 끝나면 결제를 열 수 있습니다." };
  }
  if (!isTossConfigured()) {
    return { ok: false, reason: "결제 연동 준비 중입니다. 곧 카드 등록으로 바로 시작할 수 있습니다." };
  }
  return { ok: true };
}

/**
 * 카드 등록 창을 띄운다.
 *
 * 주문번호는 서버에서 받는다 — 클라이언트가 만들면 금액을 바꿔치기할 수 있다.
 */
export async function requestSubscription(request: CheckoutRequest): Promise<CheckoutResult> {
  const sellable = canSell();
  if (!sellable.ok) {
    return { ok: false, message: sellable.reason ?? "지금은 결제할 수 없습니다." };
  }

  const prepared = await fetch("/api/payments/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ planId: request.planId }),
  });

  const data = (await prepared.json()) as {
    orderId?: string;
    orderName?: string;
    customerKey?: string;
    error?: string;
  };

  if (!prepared.ok || !data.orderId || !data.customerKey) {
    return { ok: false, message: data.error ?? "결제를 준비하지 못했습니다." };
  }

  try {
    const { loadTossPayments } = await import("@tosspayments/tosspayments-sdk");
    const toss = await loadTossPayments(tossClientKey());
    const payment = toss.payment({ customerKey: data.customerKey });

    /*
     * 정기결제는 결제창이 아니라 빌링 인증창이다. 카드가 등록되면 토스가
     * successUrl로 authKey를 붙여 되돌려 보내고, 승인은 서버에서 한다.
     */
    await payment.requestBillingAuth({
      method: "CARD",
      successUrl: `${window.location.origin}/api/payments/confirm?orderId=${encodeURIComponent(data.orderId)}`,
      failUrl: `${window.location.origin}/pricing?payment=failed`,
      customerEmail: request.customerEmail ?? undefined,
    });

    // 인증창으로 넘어가므로 여기까지 오면 사용자가 창을 닫은 것이다.
    return { ok: false, message: "카드 등록을 취소했습니다." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "카드 등록에 실패했습니다.";
    return { ok: false, message };
  }
}
