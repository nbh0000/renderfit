import { createAdminSupabase } from "@/lib/supabase/server";
import { recordIncident } from "@/lib/incidents";

/**
 * 도중에 죽은 작업을 정리한다.
 *
 * 생성은 응답을 보낸 뒤 백그라운드에서 이어진다. 그래서 그 사이에 서버가 내려가면
 * (배포, 재시작, 프로세스 종료) 작업은 processing 인 채로 영원히 남는다. 결과는
 * 이렇게 된다.
 *
 *   · 화면은 "만드는 중"에서 멈춘 채 끝나지 않는다
 *   · 크레딧은 이미 빠져나갔는데 아무것도 못 받는다
 *   · 관리자 화면에는 실패로도 잡히지 않아 우리도 모른다
 *
 * 실제로 그런 행이 남아 있었다. 돈이 걸린 일이라 그냥 둘 수 없다.
 *
 * 큐를 따로 두기 전까지는, 상태를 물어보러 온 김에 오래된 것을 실패로 확정하고
 * 크레딧을 되돌려 준다. 사람이 보고 있을 때 정리되므로 별도의 스케줄러가 없어도
 * 된다는 점이 이 방식의 장점이다.
 */

/**
 * 이 시간이 지나도록 끝나지 않았으면 죽은 것으로 본다.
 *
 * 가장 오래 걸리는 4K 네 장이 대략 3분이다. 넉넉히 두 배를 준다 — 살아 있는 작업을
 * 실패로 만드는 쪽이, 죽은 작업을 조금 늦게 거두는 쪽보다 훨씬 나쁘다.
 */
export const STALE_AFTER_MS = 6 * 60 * 1000;

/** 아직 끝나지 않은 상태들 */
const RUNNING = ["pending", "processing"];

export interface StaleSweepResult {
  /** 실패로 확정한 작업 수 */
  failed: number;
  /** 되돌려 준 크레딧 합계 */
  refunded: number;
}

/**
 * 한 사용자의 죽은 작업을 거둔다.
 *
 * 서비스 롤이 없으면 아무 일도 하지 않는다 — 사용자 세션으로는 generation_jobs 를
 * 고칠 수 없게 막아 뒀고, 크레딧 환불도 서버만 할 수 있다.
 */
export async function sweepStaleJobs(userId: string): Promise<StaleSweepResult> {
  const admin = createAdminSupabase();
  if (!admin) return { failed: 0, refunded: 0 };

  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  const { data: rows, error } = await admin
    .from("generation_jobs")
    .select("id, credits_charged, credits_refunded, created_at")
    .eq("user_id", userId)
    .in("status", RUNNING)
    .lt("created_at", cutoff)
    .limit(20);

  if (error || !rows || rows.length === 0) return { failed: 0, refunded: 0 };

  let failed = 0;
  let refunded = 0;

  for (const row of rows as {
    id: string;
    credits_charged: number | null;
    credits_refunded: boolean | null;
  }[]) {
    const credits = row.credits_refunded ? 0 : (row.credits_charged ?? 0);

    /*
     * 크레딧을 먼저 되돌리고 그 결과를 그대로 적는다.
     * 순서가 바뀌면 "환불했다"고 적어 놓고 실제로는 안 준 상태가 생길 수 있다.
     */
    let gaveBack = false;
    if (credits > 0) {
      const { error: refundError } = await admin.rpc("admin_refund_credits", {
        p_user: userId,
        p_amount: credits,
      });
      gaveBack = !refundError;

      if (refundError) {
        await recordIncident({
          kind: "credit_failed",
          userId,
          message: `중단된 작업의 크레딧 ${credits}개를 되돌리지 못했습니다 — ${refundError.message}`,
          context: { jobId: row.id },
        });
      }
    }

    const { error: markError } = await admin
      .from("generation_jobs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        error: "생성이 도중에 끊겼습니다. 크레딧은 되돌려 드렸습니다.",
        credits_refunded: gaveBack || Boolean(row.credits_refunded),
      })
      .eq("id", row.id)
      // 그 사이에 정상적으로 끝났다면 건드리지 않는다.
      .in("status", RUNNING);

    if (markError) continue;

    failed += 1;
    refunded += gaveBack ? credits : 0;
  }

  if (failed > 0) {
    await recordIncident({
      kind: "job_failed",
      userId,
      message: `중단된 작업 ${failed}건을 정리했습니다 (크레딧 ${refunded}개 환불).`,
      context: { failed, refunded },
    });
  }

  return { failed, refunded };
}
