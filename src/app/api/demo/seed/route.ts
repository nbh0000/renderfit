import { getViewer } from "@/lib/auth";
import { seedDemoProject } from "@/services/demoSeed";
import { listProjects } from "@/services/projectService";

/** 데모 프로젝트 생성 (npm run seed 또는 대시보드 버튼에서 호출) */
export async function POST() {
  const viewer = await getViewer();
  const project = await seedDemoProject(viewer.userId);

  return Response.json({
    ok: true,
    project: { id: project.id, name: project.name },
    total: (await listProjects(viewer.userId)).length,
  });
}
