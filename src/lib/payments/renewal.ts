import { getPlan, type PlanId } from "@/config/plans";

/**
 * 매월 자동결제를 어떻게 굴릴지 정하는 규칙.
 *
 * 첫 결제는 사용자가 카드를 등록할 때 끝나지만, 둘째 달부터는 우리가 빌링키로 직접
 * 청구해야 한다. 이 파일에는 결제대행사를 부르지 않는 판단만 모아 둔다 — 누구에게
 * 언제 청구할지, 실패하면 언제 다시 걸지, 언제 포기할지. 그래야 결제 키 없이도
 * 규칙을 그대로 시험할 수 있고, 규칙이 틀려서 돈을 두 번 걷는 일이 없다.
 */

/** 자동결제를 이만큼 연달아 실패하면 구독을 끝낸다 */
export const MAX_ATTEMPTS = 3;

/** 실패 후 며칠 뒤에 다시 걸까 (1차·2차·3차) */
export const RETRY_DAYS = [1, 3, 5];

export type SubscriptionRow = {
  id: string;
  user_id: string;
  plan: string;
  billing_key: string;
  status: "active" | "past_due" | "canceled" | "expired";
  period_end: string;
  failed_attempts: number;
  retry_at: string | null;
};

export type RenewalAction =
  | { kind: "charge"; plan: PlanId; amount: number; orderId: string; periodEnd: string }
  | { kind: "expire"; reason: string }
  | { kind: "skip"; reason: string };

/** 하루를 밀리초로 */
const DAY = 24 * 60 * 60 * 1000;

/**
 * 주문번호를 주기마다 하나만 만든다.
 *
 * payments.order_id 에 유니크 제약이 걸려 있으므로, 같은 주기를 두 번 청구하려 하면
 * 두 번째는 DB가 막는다. 스케줄러가 겹쳐 돌거나 재시도가 꼬여도 돈이 두 번 나가지
 * 않게 하는 마지막 방어선이다.
 */
export function renewalOrderId(subscriptionId: string, periodEnd: string): string {
  const stamp = periodEnd.slice(0, 10).replace(/-/g, "");
  return `renew_${subscriptionId.replace(/-/g, "").slice(0, 16)}_${stamp}`;
}

/**
 * 이 구독을 지금 어떻게 할지 정한다.
 *
 * now를 인자로 받는 것은 시험 때문이다 — 시간에 기대는 규칙은 시계를 넘겨받아야
 * 재현할 수 있다.
 */
export function decideRenewal(subscription: SubscriptionRow, now: Date): RenewalAction {
  const periodEnd = new Date(subscription.period_end);

  if (subscription.status === "expired") {
    return { kind: "skip", reason: "이미 끝난 구독" };
  }

  // 아직 주기가 남았으면 건드리지 않는다
  if (periodEnd.getTime() > now.getTime()) {
    return { kind: "skip", reason: "주기가 아직 남음" };
  }

  /*
   * 해지를 예약한 구독은 주기가 끝나면 청구하지 않고 그대로 보낸다.
   * 해지했는데 한 번 더 걷히면 그게 가장 큰 불만이 된다.
   */
  if (subscription.status === "canceled") {
    return { kind: "expire", reason: "해지 예약 후 주기 종료" };
  }

  if (subscription.failed_attempts >= MAX_ATTEMPTS) {
    return { kind: "expire", reason: `자동결제 ${MAX_ATTEMPTS}회 실패` };
  }

  // 실패해서 기다리는 중이면 그 시각까지는 다시 걸지 않는다
  if (subscription.retry_at && new Date(subscription.retry_at).getTime() > now.getTime()) {
    return { kind: "skip", reason: "재시도 대기 중" };
  }

  const plan = getPlan(subscription.plan as PlanId);
  if (!plan || plan.priceMonthly <= 0) {
    return { kind: "expire", reason: "요금제를 찾을 수 없음" };
  }

  return {
    kind: "charge",
    plan: plan.id,
    amount: plan.priceMonthly,
    orderId: renewalOrderId(subscription.id, subscription.period_end),
    periodEnd: nextPeriodEnd(periodEnd).toISOString(),
  };
}

/**
 * 다음 주기의 끝.
 *
 * 밀린 결제를 몰아서 걷지 않도록 "지금"이 아니라 "지난 주기 끝"에서 한 달을 더한다.
 * 다만 스케줄러가 며칠 멈춰 있었다면 이미 지난 날짜가 나오므로, 그때는 오늘을
 * 기준으로 잡아 과거로 만료되는 구독이 생기지 않게 한다.
 */
export function nextPeriodEnd(previousEnd: Date, now: Date = new Date()): Date {
  const next = new Date(previousEnd);
  next.setMonth(next.getMonth() + 1);

  if (next.getTime() <= now.getTime()) {
    const fromNow = new Date(now);
    fromNow.setMonth(fromNow.getMonth() + 1);
    return fromNow;
  }

  return next;
}

/** 실패했을 때 다음 시도 시각과 누적 횟수 */
export function afterFailure(
  subscription: SubscriptionRow,
  now: Date
): { failed_attempts: number; retry_at: string | null; status: "past_due" | "expired" } {
  const attempts = subscription.failed_attempts + 1;

  if (attempts >= MAX_ATTEMPTS) {
    return { failed_attempts: attempts, retry_at: null, status: "expired" };
  }

  const days = RETRY_DAYS[Math.min(attempts - 1, RETRY_DAYS.length - 1)];
  return {
    failed_attempts: attempts,
    retry_at: new Date(now.getTime() + days * DAY).toISOString(),
    status: "past_due",
  };
}
