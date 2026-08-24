import { getJob } from "@/lib/job-store";
import { fetchJob } from "@/lib/jobs/read";
import { sweepStaleJobs } from "@/lib/jobs/stale";
import { createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  if (isSupabaseConfigured()) {
    const supabase = await createServerSupabase();
    if (!supabase) return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

    let job = await fetchJob(supabase, id);
    if (!job) return Response.json({ error: "해당 작업을 찾을 수 없습니다." }, { status: 404 });

    /*
     * 끝나지 않은 채 오래된 작업은 여기서 거둔다.
     *
     * 생성은 응답을 보낸 뒤 백그라운드에서 이어지므로, 그 사이 서버가 내려가면
     * 작업이 processing 인 채로 남는다. 화면은 영원히 "만드는 중"이고 크레딧은
     * 이미 빠져나간 상태다. 상태를 물으러 온 김에 정리하고 크레딧을 되돌린다.
     */
    if (job.status === "pending" || job.status === "processing") {
      const swept = await sweepStaleJobs(user.id);
      if (swept.failed > 0) job = (await fetchJob(supabase, id)) ?? job;
    }

    return Response.json(job, { headers: { "Cache-Control": "no-store" } });
  }

  const job = getJob(id);
  if (!job) {
    return Response.json({ error: "해당 작업을 찾을 수 없습니다." }, { status: 404 });
  }
  return Response.json(job, { headers: { "Cache-Control": "no-store" } });
}
