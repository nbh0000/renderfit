import { getViewer } from "@/lib/auth";
import { loadProject, restoreVersion, saveVersion } from "@/services/projectService";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  const loaded = await loadProject(id, viewer.userId);

  if (!loaded) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

  return Response.json(
    {
      versions: loaded.project.versions.map((version) => ({
        id: version.id,
        version: version.version,
        label: version.label,
        createdAt: version.createdAt,
        objectCount: version.scene.objects.length,
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/** 버전 저장 또는 복원 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  const loaded = await loadProject(id, viewer.userId);

  if (!loaded) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

  let body: { action?: "save" | "restore"; label?: string; versionId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (body.action === "restore") {
    if (!body.versionId) return Response.json({ error: "버전 id가 필요합니다." }, { status: 400 });
    const project = await restoreVersion(loaded, body.versionId);
    if (!project) return Response.json({ error: "버전을 찾을 수 없습니다." }, { status: 404 });
    return Response.json({ ok: true, scene: project.scene });
  }

  const project = await saveVersion(loaded, body.label ?? `v${loaded.project.versions.length + 1}`);
  return Response.json({ ok: true, versions: project.versions.length });
}
