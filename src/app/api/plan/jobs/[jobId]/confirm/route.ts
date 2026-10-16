import { getViewer } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import { SceneEngine } from "@/scene/engine/SceneEngine";
import { toScene } from "@/scene/planDoc";
import { loadProject, persist } from "@/services/projectService";
import { parseFloorPlanDoc } from "@renderfit/plan-schema";

/**
 * 검수를 마친다 — 여기가 도면이 편집기·3D 로 넘어가는 **유일한 문**이다.
 *
 * 확인을 누르기 전까지 문서는 잡 안에만 있다. 자동으로 읽은 도면을 그대로 얹으면
 * 틀린 채로 3D 가 서고 견적까지 뽑히는데, 사용자는 그것이 자기 도면인 줄 안다.
 *
 * 사람이 무엇을 고쳤는지도 함께 남긴다. 매번 같은 자리를 고치고 있다면 그건 파서가
 * 거기서 틀린다는 뜻이고, 무엇이 자주 틀리는지 알아야 다음에 무엇을 고칠지 정한다.
 */

/** 한 번에 받을 수정 내역 (통계용이라 넉넉하면 된다) */
const MAX_EDITS = 2000;

export async function POST(request: Request, ctx: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await ctx.params;
  const viewer = await getViewer();

  const admin = createAdminSupabase();
  if (!admin) {
    return Response.json(
      { error: "Supabase 가 연결돼 있지 않아 검수 결과를 저장할 수 없습니다." },
      { status: 503 }
    );
  }

  let body: { doc?: unknown; edits?: unknown; verdicts?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const parsed = parseFloorPlanDoc(body.doc);
  if (!parsed.ok) {
    return Response.json({ error: `도면이 스키마와 다릅니다 — ${parsed.error}` }, { status: 422 });
  }

  const { data: job, error: readError } = await admin
    .from("plan_ingest_jobs")
    .select("id, owner_id, project_id")
    .eq("id", jobId)
    .maybeSingle();

  if (readError) return Response.json({ error: readError.message }, { status: 500 });
  if (!job) return Response.json({ error: "잡을 찾을 수 없습니다." }, { status: 404 });

  if (job.owner_id && job.owner_id !== viewer.userId) {
    return Response.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  /*
   * 남은 지적이 있으면 확정하지 않는다.
   *
   * 화면의 확인 버튼도 막고 있지만 여기서 한 번 더 본다. 확정은 "사람이 이 도면을
   * 전부 봤다"는 뜻이고, 그 뜻이 브라우저 코드 한 줄에만 걸려 있으면 안 된다.
   */
  const verdicts =
    typeof body.verdicts === "object" && body.verdicts !== null
      ? (body.verdicts as Record<string, unknown>)
      : {};

  const left = parsed.doc.review.flags.filter((_, index) => !verdicts[String(index)]).length;
  if (left > 0) {
    return Response.json(
      { error: `아직 확인하지 않은 곳이 ${left}군데 남았습니다.` },
      { status: 409 }
    );
  }

  const doc = {
    ...parsed.doc,
    review: { ...parsed.doc.review, status: "confirmed" as const },
  };

  /* ── 프로젝트에 얹는다 ── */
  let appliedTo: string | null = null;
  if (job.project_id) {
    const loaded = await loadProject(job.project_id, viewer.userId);
    if (loaded) {
      /*
       * 되돌리기 스택은 그대로 이어 간다 — 도면을 들여왔다고 사용자가 그전에 한 일이
       * 사라지면 안 된다.
       */
      const engine = new SceneEngine(toScene(doc, loaded.engine.getScene()), {
        operations: loaded.engine.getOperations(),
        redo: loaded.engine.getRedoStack(),
      });
      await persist({ project: loaded.project, engine }, {});
      appliedTo = job.project_id;
    }
  }

  const { error: updateError } = await admin
    .from("plan_ingest_jobs")
    .update({ doc, review_status: "confirmed", updated_at: new Date().toISOString() })
    .eq("id", jobId);

  if (updateError) return Response.json({ error: updateError.message }, { status: 500 });

  /* ── 무엇을 고쳤나 ── */
  const edits = Array.isArray(body.edits) ? body.edits.slice(0, MAX_EDITS) : [];
  const rows = edits
    .filter(
      (edit): edit is { kind: string; target: string; before?: unknown; after?: unknown } =>
        typeof edit === "object" &&
        edit !== null &&
        typeof (edit as { kind?: unknown }).kind === "string" &&
        typeof (edit as { target?: unknown }).target === "string"
    )
    .map((edit) => ({
      job_id: jobId,
      owner_id: viewer.userId,
      kind: edit.kind.slice(0, 40),
      target: edit.target.slice(0, 80),
      before_value: text(edit.before),
      after_value: text(edit.after),
    }));

  if (rows.length > 0) {
    const { error } = await admin.from("plan_review_edits").insert(rows);
    /* 통계를 못 남겼다고 검수를 되돌리지는 않는다 — 도면 쪽은 이미 확정됐다 */
    if (error) console.warn(`[review] 수정 내역을 못 남겼습니다: ${error.message}`);
  }

  console.info(
    `[review] ${jobId} 확정 — 수정 ${rows.length}건` + (appliedTo ? ` · ${appliedTo} 에 적용` : "")
  );

  return Response.json({
    ok: true,
    edits: rows.length,
    ...(appliedTo ? { appliedTo } : {}),
  });
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value).slice(0, 200);
}
