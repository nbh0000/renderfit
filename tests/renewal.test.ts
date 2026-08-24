import { describe, expect, it } from "vitest";
import {
  afterFailure,
  decideRenewal,
  nextPeriodEnd,
  renewalOrderId,
  MAX_ATTEMPTS,
  type SubscriptionRow,
} from "@/lib/payments/renewal";

/**
 * 매월 자동결제 규칙.
 *
 * 돈이 걸린 판단이라 결제대행사를 부르지 않고도 전부 시험할 수 있게 떼어 놓았다.
 * 여기서 틀리면 해지한 사람에게 한 번 더 걷거나, 같은 달을 두 번 걷거나, 내야 할
 * 사람을 그냥 보내 준다.
 */
function subscription(overrides: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    user_id: "user-1",
    plan: "pro",
    billing_key: "bk_test",
    status: "active",
    period_end: "2026-09-01T00:00:00.000Z",
    failed_attempts: 0,
    retry_at: null,
    ...overrides,
  };
}

const BEFORE = new Date("2026-08-25T00:00:00.000Z");
const AFTER = new Date("2026-09-02T00:00:00.000Z");

describe("언제 걷을지", () => {
  it("주기가 남았으면 건드리지 않는다", () => {
    expect(decideRenewal(subscription(), BEFORE).kind).toBe("skip");
  });

  it("주기가 끝났으면 걷는다", () => {
    const action = decideRenewal(subscription(), AFTER);
    expect(action.kind).toBe("charge");
    if (action.kind !== "charge") return;

    expect(action.plan).toBe("pro");
    expect(action.amount).toBeGreaterThan(0);
  });

  it("해지를 예약했으면 한 번 더 걷지 않는다", () => {
    // 해지했는데 또 걷히는 것이 가장 큰 불만이 된다
    const action = decideRenewal(subscription({ status: "canceled" }), AFTER);
    expect(action.kind).toBe("expire");
  });

  it("이미 끝난 구독은 손대지 않는다", () => {
    expect(decideRenewal(subscription({ status: "expired" }), AFTER).kind).toBe("skip");
  });

  it("재시도 대기 중이면 기다린다", () => {
    const action = decideRenewal(
      subscription({
        status: "past_due",
        failed_attempts: 1,
        retry_at: "2026-09-05T00:00:00.000Z",
      }),
      AFTER
    );
    expect(action.kind).toBe("skip");
  });

  it("대기 시각이 지나면 다시 건다", () => {
    const action = decideRenewal(
      subscription({
        status: "past_due",
        failed_attempts: 1,
        retry_at: "2026-09-01T00:00:00.000Z",
      }),
      AFTER
    );
    expect(action.kind).toBe("charge");
  });

  it("정해진 횟수를 넘기면 구독을 끝낸다", () => {
    const action = decideRenewal(
      subscription({ status: "past_due", failed_attempts: MAX_ATTEMPTS }),
      AFTER
    );
    expect(action.kind).toBe("expire");
  });

  it("없어진 요금제는 끝낸다 — 값을 모르면 걷을 수 없다", () => {
    const action = decideRenewal(subscription({ plan: "없는요금제" }), AFTER);
    expect(action.kind).toBe("expire");
  });
});

describe("같은 달을 두 번 걷지 않는다", () => {
  it("주기마다 주문번호가 하나로 정해진다", () => {
    const row = subscription();
    const once = renewalOrderId(row.id, row.period_end);
    const twice = renewalOrderId(row.id, row.period_end);

    // 같은 주기 → 같은 주문번호 → DB의 유니크 제약이 두 번째를 막는다
    expect(once).toBe(twice);
  });

  it("다음 주기는 주문번호가 달라진다", () => {
    const row = subscription();
    const september = renewalOrderId(row.id, "2026-09-01T00:00:00.000Z");
    const october = renewalOrderId(row.id, "2026-10-01T00:00:00.000Z");

    expect(september).not.toBe(october);
  });

  it("다른 구독끼리도 겹치지 않는다", () => {
    const a = renewalOrderId("aaaaaaaa-1111-2222-3333-444444444444", "2026-09-01T00:00:00.000Z");
    const b = renewalOrderId("bbbbbbbb-1111-2222-3333-444444444444", "2026-09-01T00:00:00.000Z");

    expect(a).not.toBe(b);
  });
});

describe("다음 주기 끝", () => {
  it("지난 주기 끝에서 한 달을 더한다 — 날짜가 밀리지 않게", () => {
    const next = nextPeriodEnd(new Date("2026-09-01T00:00:00.000Z"), AFTER);
    expect(next.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("스케줄러가 오래 멈춰 있었어도 과거로 만료되지 않는다", () => {
    // 3개월 밀린 구독을 살릴 때 다음 만료가 과거면 곧바로 또 걷힌다
    const late = new Date("2026-12-20T00:00:00.000Z");
    const next = nextPeriodEnd(new Date("2026-09-01T00:00:00.000Z"), late);

    expect(next.getTime()).toBeGreaterThan(late.getTime());
  });
});

describe("실패했을 때", () => {
  it("한 번 실패하면 며칠 뒤로 미룬다", () => {
    const next = afterFailure(subscription(), AFTER);

    expect(next.status).toBe("past_due");
    expect(next.failed_attempts).toBe(1);
    expect(new Date(next.retry_at!).getTime()).toBeGreaterThan(AFTER.getTime());
  });

  it("뒤로 갈수록 더 오래 기다린다", () => {
    const first = afterFailure(subscription({ failed_attempts: 0 }), AFTER);
    const second = afterFailure(subscription({ failed_attempts: 1 }), AFTER);

    expect(new Date(second.retry_at!).getTime()).toBeGreaterThan(
      new Date(first.retry_at!).getTime()
    );
  });

  it("마지막 실패에서는 끝내고 더 기다리지 않는다", () => {
    const next = afterFailure(subscription({ failed_attempts: MAX_ATTEMPTS - 1 }), AFTER);

    expect(next.status).toBe("expired");
    expect(next.retry_at).toBeNull();
  });
});
