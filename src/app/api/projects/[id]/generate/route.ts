import { getViewer } from "@/lib/auth";
import { enqueueGenerate, loadProject } from "@/services/projectService";

/** 스타일 기반 AI 생성 시작 (background job) */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();

  let body: { styleId?: string | null; prompt?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  if (body.prompt && body.prompt.length > 500) {
    return Response.json({ error: "추가 요청은 500자 이하로 입력해 주세요." }, { status: 400 });
  }

  const loaded = await loadProject(id, viewer.userId);
  if (!loaded) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

  if (!loaded.engine.getScene().source.imageUrl) {
    return Response.json({ error: "먼저 방 사진을 업로드해 주세요." }, { status: 400 });
  }

  const job = enqueueGenerate(loaded, { styleId: body.styleId ?? null, prompt: body.prompt });
  return Response.json({ job });
}
