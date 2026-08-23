import { withPersistGuard } from "@/lib/persist-guard";
import { getViewer } from "@/lib/auth";
import { loadProject, undo } from "@/services/projectService";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withPersistGuard(async () => {
    const { id } = await ctx.params;
    const viewer = await getViewer();
    const loaded = await loadProject(id, viewer.userId);

    if (!loaded) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

    const result = await undo(loaded);
    return Response.json({
      ok: result.ok,
      scene: result.project.scene,
      canUndo: loaded.engine.canUndo(),
      canRedo: loaded.engine.canRedo(),
    });
  });
}
