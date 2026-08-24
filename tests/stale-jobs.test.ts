import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 도중에 끊긴 작업을 거두는 절차.
 *
 * 생성은 응답을 보낸 뒤 백그라운드로 이어진다. 그 사이 서버가 내려가면 작업은
 * processing 인 채로 영원히 남는다 — 화면은 "만드는 중"에서 멈추고, 크레딧은 이미
 * 빠져나갔는데 아무것도 못 받는다. 돈이 걸린 일이라 순서가 중요하다.
 *
 *   1. 크레딧을 먼저 되돌린다
 *   2. 되돌린 결과를 그대로 적는다
 *
 * 순서가 바뀌면 "환불했다"고 적어 놓고 실제로는 안 준 상태가 생긴다.
 */

const rpc = vi.fn();
const update = vi.fn();
const recordIncident = vi.fn();
let rows: unknown[] = [];

vi.mock("@/lib/incidents", () => ({ recordIncident: (...args: unknown[]) => recordIncident(...args) }));

vi.mock("@/lib/supabase/server", () => ({
  createAdminSupabase: () => ({
    rpc,
    from() {
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        lt: () => chain,
        limit: () => Promise.resolve({ data: rows, error: null }),
        update(patch: Record<string, unknown>) {
          update(patch);
          return { eq: () => ({ in: () => Promise.resolve({ error: null }) }) };
        },
      };
      return chain;
    },
  }),
}));

async function sweep(userId = "u1") {
  const { sweepStaleJobs } = await import("@/lib/jobs/stale");
  return sweepStaleJobs(userId);
}

beforeEach(() => {
  vi.resetModules();
  rpc.mockReset().mockResolvedValue({ error: null });
  update.mockReset();
  recordIncident.mockReset();
  rows = [];
});

describe("끊긴 작업 정리", () => {
  it("크레딧을 되돌리고 실패로 확정한다", async () => {
    rows = [{ id: "j1", credits_charged: 4, credits_refunded: false }];

    const result = await sweep();

    expect(rpc).toHaveBeenCalledWith("admin_refund_credits", { p_user: "u1", p_amount: 4 });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", credits_refunded: true })
    );
    expect(result).toEqual({ failed: 1, refunded: 4 });
  });

  it("환불이 실패하면 환불했다고 적지 않는다", async () => {
    rows = [{ id: "j1", credits_charged: 4, credits_refunded: false }];
    rpc.mockResolvedValue({ error: { message: "rpc 없음" } });

    const result = await sweep();

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ credits_refunded: false }));
    expect(result.refunded).toBe(0);
    // 크레딧이 돌아가지 않았다는 것은 사람이 알아야 한다.
    expect(recordIncident).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "credit_failed" })
    );
  });

  it("이미 환불된 작업에 두 번 주지 않는다", async () => {
    rows = [{ id: "j1", credits_charged: 4, credits_refunded: true }];

    const result = await sweep();

    expect(rpc).not.toHaveBeenCalled();
    expect(result).toEqual({ failed: 1, refunded: 0 });
  });

  it("거둘 것이 없으면 아무것도 하지 않는다", async () => {
    expect(await sweep()).toEqual({ failed: 0, refunded: 0 });
    expect(rpc).not.toHaveBeenCalled();
    expect(recordIncident).not.toHaveBeenCalled();
  });
});
