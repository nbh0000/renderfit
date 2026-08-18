import { getJob } from "@/lib/job-store";
import { fetchJob } from "@/lib/jobs/read";
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

    const job = await fetchJob(supabase, id);
    if (!job) return Response.json({ error: "해당 작업을 찾을 수 없습니다." }, { status: 404 });
    return Response.json(job, { headers: { "Cache-Control": "no-store" } });
  }

  const job = getJob(id);
  if (!job) {
    return Response.json({ error: "해당 작업을 찾을 수 없습니다." }, { status: 404 });
  }
  return Response.json(job, { headers: { "Cache-Control": "no-store" } });
}
