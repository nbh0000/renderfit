import { withPersistGuard } from "@/lib/persist-guard";
import { getViewer } from "@/lib/auth";
import { createProject, listProjects } from "@/services/projectService";
import { summarizeScene } from "@/scene/serialization";

/** 디자인 프로젝트 목록 / 생성 */
export async function GET() {
  const viewer = await getViewer();
  const projects = await listProjects(viewer.userId);

  return Response.json(
    {
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        status: project.status,
        thumbnailUrl: project.thumbnailUrl,
        summary: summarizeScene(project.scene),
        objectCount: project.scene.objects.length,
        updatedAt: project.updatedAt,
        createdAt: project.createdAt,
      })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  return withPersistGuard(async () => {
    let body: { name?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      body = {};
    }

    const viewer = await getViewer();
    const project = await createProject(body.name ?? "새 프로젝트", viewer.userId);

    return Response.json({ project: { id: project.id, name: project.name } }, { status: 201 });
  });
}
