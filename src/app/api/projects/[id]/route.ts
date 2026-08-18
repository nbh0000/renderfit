import { getViewer } from "@/lib/auth";
import { deleteProject, loadProject } from "@/services/projectService";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  const loaded = await loadProject(id, viewer.userId);

  if (!loaded) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

  return Response.json(loaded.project, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  await deleteProject(id, viewer.userId);
  return Response.json({ ok: true });
}
