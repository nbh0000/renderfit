import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * 편집기 AI 작업의 크레딧 과금.
 *
 * 빠른 생성은 처음부터 크레딧을 걷었는데 편집기는 한 푼도 걷지 않았다. 정작 비용은
 * 편집기 쪽이 크다 — 도면 분석은 vision을 두 번 부르고 실사 렌더는 이미지 생성이다.
 * 무료 사용자가 편집기만 열어 두면 하루 종일 공짜로 돌릴 수 있었다.
 */

const rpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: async () => ({ rpc }),
}));

const configured = vi.fn(() => true);
vi.mock("@/lib/supabase/env", () => ({
  isSupabaseConfigured: () => configured(),
}));

const { chargeCredits, isDenied, EDITOR_COST } = await import("@/lib/credits");

beforeEach(() => {
  rpc.mockReset();
  configured.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("크레딧 걷기", () => {
  it("일을 시작하기 전에 먼저 깎는다", async () => {
    rpc.mockResolvedValue({ error: null });

    const charge = await chargeCredits(EDITOR_COST.renderFinal);

    expect(isDenied(charge)).toBe(false);
    expect(rpc).toHaveBeenCalledWith("consume_credits", { p_amount: EDITOR_COST.renderFinal });
  });

  it("잔액이 모자라면 402로 막는다", async () => {
    rpc.mockResolvedValue({ error: { message: "INSUFFICIENT_CREDITS" } });

    const charge = await chargeCredits(2);
    if (!isDenied(charge)) throw new Error("막혔어야 한다");

    expect(charge.denied.status).toBe(402);
    const body = (await charge.denied.json()) as { insufficient: boolean };
    expect(body.insufficient).toBe(true);
  });

  it("다른 오류는 402가 아니라 500이다 — 요금제를 권할 일이 아니다", async () => {
    rpc.mockResolvedValue({ error: { message: "connection reset" } });

    const charge = await chargeCredits(2);
    if (!isDenied(charge)) throw new Error("막혔어야 한다");

    expect(charge.denied.status).toBe(500);
  });

  it("실패하면 돌려준다", async () => {
    rpc.mockResolvedValue({ error: null });

    const charge = await chargeCredits(2);
    if (isDenied(charge)) throw new Error("걷혔어야 한다");

    await charge.refund();
    expect(rpc).toHaveBeenCalledWith("refund_credits", { p_amount: 2 });
  });

  it("두 번 돌려주지 않는다 — 없던 크레딧이 생기면 안 된다", async () => {
    rpc.mockResolvedValue({ error: null });

    const charge = await chargeCredits(2);
    if (isDenied(charge)) throw new Error("걷혔어야 한다");

    await charge.refund();
    await charge.refund();
    await charge.refund();

    const refunds = rpc.mock.calls.filter(([name]) => name === "refund_credits");
    expect(refunds).toHaveLength(1);
  });

  it("Supabase가 없는 로컬·데모에서는 걷지 않는다", async () => {
    configured.mockReturnValue(false);

    const charge = await chargeCredits(2);

    expect(isDenied(charge)).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("작업별 값", () => {
  it("비싼 일이 더 비싸다", () => {
    // 실사 렌더는 이미지 생성이라 분석·명령보다 비싸야 한다
    expect(EDITOR_COST.renderFinal).toBeGreaterThan(EDITOR_COST.command);
    expect(EDITOR_COST.renderFinal).toBeGreaterThanOrEqual(EDITOR_COST.renderPreview);
  });

  it("공짜로 부를 수 있는 AI 작업은 없다", () => {
    for (const [name, cost] of Object.entries(EDITOR_COST)) {
      expect(cost, `${name}이 공짜다`).toBeGreaterThan(0);
    }
  });
});
