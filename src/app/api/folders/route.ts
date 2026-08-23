import { withPersistGuard } from "@/lib/persist-guard";
import { getViewer } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  createProject,
  listProjects,
  memoryCreateProject,
  memoryListProjects,
} from "@/lib/projects";

export async function GET() {
  const viewer = await getViewer();

  if (!viewer.configured) {
    return Response.json({ projects: memoryListProjects() }, { headers: { "Cache-Control": "no-store" } });
  }
  if (!viewer.userId) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const supabase = await createServerSupabase();
  if (!supabase) return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  return Response.json(
    { projects: await listProjects(supabase) },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  return withPersistGuard(async () => {
    let body: { name?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const name = (body.name ?? "").trim();
    if (!name) return Response.json({ error: "프로젝트 이름을 입력해 주세요." }, { status: 400 });
    if (name.length > 60) {
      return Response.json({ error: "프로젝트 이름은 60자 이하로 입력해 주세요." }, { status: 400 });
    }

    const viewer = await getViewer();

    if (!viewer.configured) {
      return Response.json({ project: memoryCreateProject(name) });
    }
    if (!viewer.userId) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

    const supabase = await createServerSupabase();
    if (!supabase) return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });

    const project = await createProject(supabase, viewer.userId, name);
    if (!project) return Response.json({ error: "프로젝트를 만들지 못했습니다." }, { status: 500 });

    return Response.json({ project });
  });
}
