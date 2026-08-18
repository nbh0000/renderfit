/**
 * 토스페이먼츠 결제 어댑터 — 인터페이스만 정의한다.
 *
 * TODO(실연동):
 *  1. `@tosspayments/tosspayments-sdk` 설치 후 loadTossPayments(clientKey)로 위젯 초기화
 *  2. requestBillingAuth('카드')로 정기결제(빌링키) 발급 → successUrl에서 authKey 수신
 *  3. 서버(/api/payments/confirm)에서 시크릿 키로 빌링키 발급·승인 API 호출
 *  4. 승인 성공 시 profiles.plan 갱신 + renew_credits(플랜 월 크레딧) 호출
 *  5. 매월 갱신은 빌링키로 자동결제 (Supabase pg_cron 또는 외부 스케줄러)
 *  6. 결제/구독 이력 테이블(subscriptions, payments) 추가
 *
 * 현재는 결제 창을 띄우지 않고 안내만 한다.
 */
import type { PlanId } from "@/config/plans";

export interface CheckoutRequest {
  planId: PlanId;
  /** 주문 식별자 (실연동 시 서버에서 발급) */
  orderId?: string;
  amount: number;
  customerEmail?: string | null;
}

/** 주문 번호 생성 — TODO: 실연동 시 서버에서 발급받아 검증한다 */
export function createOrderId(planId: PlanId): string {
  return `order_${planId}_${Math.random().toString(36).slice(2, 10)}`;
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

export async function requestSubscription(request: CheckoutRequest): Promise<CheckoutResult> {
  if (!isTossConfigured()) {
    return {
      ok: false,
      message: "결제 연동 준비 중입니다. 곧 카드 등록으로 바로 시작할 수 있습니다.",
    };
  }

  // TODO: 토스페이먼츠 위젯 호출로 교체
  const orderId = request.orderId ?? createOrderId(request.planId);
  return {
    ok: false,
    message: `결제 연동이 아직 완료되지 않았습니다. (${orderId} / ${request.amount.toLocaleString("ko-KR")}원)`,
  };
}
