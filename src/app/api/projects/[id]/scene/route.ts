import { getViewer } from "@/lib/auth";
import { loadProject, persist } from "@/services/projectService";
import { parseScene } from "@/scene/validation";
import { SceneEngine } from "@/scene/engine/SceneEngine";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  const loaded = await loadProject(id, viewer.userId);

  if (!loaded) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  return Response.json(loaded.engine.getScene(), { headers: { "Cache-Control": "no-store" } });
}

/** Scene 전체 교체 (import / 버전 복원용). 검증을 통과해야만 저장한다. */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  const loaded = await loadProject(id, viewer.userId);

  if (!loaded) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const scene = parseScene(body);
    const engine = new SceneEngine(scene, {
      operations: loaded.engine.getOperations(),
      redo: loaded.engine.getRedoStack(),
    });
    const project = await persist({ project: loaded.project, engine });
    return Response.json({ ok: true, scene: project.scene });
  } catch {
    return Response.json({ error: "Scene 데이터가 올바르지 않습니다." }, { status: 400 });
  }
}
