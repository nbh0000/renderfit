import { getViewer } from "@/lib/auth";
import { enqueueRender, loadProject } from "@/services/projectService";

/** POST /api/projects/:id/render/preview | final */
export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string; quality: string }> }
) {
  const { id, quality } = await ctx.params;
  if (quality !== "preview" && quality !== "final") {
    return Response.json({ error: "렌더 품질은 preview 또는 final이어야 합니다." }, { status: 400 });
  }

  const viewer = await getViewer();
  const loaded = await loadProject(id, viewer.userId);
  if (!loaded) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

  const job = enqueueRender(loaded, quality);
  return Response.json({ job });
}
