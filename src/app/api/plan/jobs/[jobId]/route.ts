import { getViewer } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import { parseFloorPlanDoc } from "@renderfit/plan-schema";

/**
 * 검수할 도면 하나를 내려준다.
 *
 * 자기 잡만 본다. 도면은 남의 집 평면이라, 주소만 알면 열리는 상태로 두면 누가 어떤
 * 도면을 올렸는지가 그대로 샌다.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  const viewer = await getViewer();

  const admin = createAdminSupabase();
  if (!admin) {
    return Response.json(
      { error: "Supabase 가 연결돼 있지 않아 검수 기록을 읽을 수 없습니다." },
      { status: 503 }
    );
  }

  const { data, error } = await admin
    .from("plan_ingest_jobs")
    .select("id, owner_id, project_id, route, format, file_name, crop, image_url, status, error, doc, review_status")
    .eq("id", jobId)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "잡을 찾을 수 없습니다." }, { status: 404 });

  if (data.owner_id && data.owner_id !== viewer.userId) {
    return Response.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  if (!data.doc) {
    return Response.json(
      { error: data.error ?? "아직 도면을 읽지 못했습니다.", status: data.status },
      { status: 409 }
    );
  }

  /* 저장된 문서도 한 번 검사한다 — 스키마가 바뀐 뒤 옛 잡을 열면 화면이 깨진다 */
  const parsed = parseFloorPlanDoc(data.doc);
  if (!parsed.ok) {
    return Response.json({ error: `저장된 도면이 스키마와 다릅니다 — ${parsed.error}` }, { status: 422 });
  }

  return Response.json({
    job: {
      id: data.id,
      projectId: data.project_id,
      route: data.route,
      format: data.format,
      fileName: data.file_name,
      crop: data.crop,
      imageUrl: data.image_url,
      status: data.status,
      reviewStatus: data.review_status ?? "auto",
    },
    doc: parsed.doc,
  });
}
