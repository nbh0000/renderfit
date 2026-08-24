import { recordEvent } from "@/lib/events";
import { chargeCredits, isDenied, EDITOR_COST } from "@/lib/credits";
import { getViewer } from "@/lib/auth";
import { enqueueRender, loadProject } from "@/services/projectService";

/** POST /api/projects/:id/render/preview | final */
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string; quality: string }> }
) {
  const { id, quality } = await ctx.params;
  if (quality !== "preview" && quality !== "final") {
    return Response.json({ error: "렌더 품질은 preview 또는 final이어야 합니다." }, { status: 400 });
  }

  let body: { viewport?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // 본문이 없으면 뷰포트 캡처 없이 렌더한다.
  }

  const viewer = await getViewer();
  const loaded = await loadProject(id, viewer.userId);
  if (!loaded) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

  const viewportImage =
    typeof body.viewport === "string" && body.viewport.startsWith("data:image/")
      ? body.viewport
      : undefined;

  const charge = await chargeCredits(
    quality === "final" ? EDITOR_COST.renderFinal : EDITOR_COST.renderPreview
  );
  if (isDenied(charge)) return charge.denied;

  void recordEvent({
    name: "render_start",
    userId: viewer.userId,
    props: {
      credits: quality === "final" ? EDITOR_COST.renderFinal : EDITOR_COST.renderPreview,
      quality,
      projectId: id,
    },
  });

  const job = enqueueRender(loaded, quality, { viewportImage }, charge.refund);
  return Response.json({ job });
}
