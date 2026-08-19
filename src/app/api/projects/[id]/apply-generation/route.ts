import { getViewer } from "@/lib/auth";
import { applyGeneratedImage, loadProject } from "@/services/projectService";

/**
 * 고른 시안을 장면에 반영한다 (2안 비교에서 사용).
 *
 * imageUrl은 우리가 만들어 준 결과만 허용한다 — 외부 URL을 장면에 꽂지 못하게 막는다.
 */
function isOwnResult(url: string): boolean {
  return url.startsWith("/api/files/") || url.startsWith("/api/placeholder/");
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();

  let body: { imageUrl?: string; label?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const imageUrl = (body.imageUrl ?? "").trim();
  if (!imageUrl || !isOwnResult(imageUrl)) {
    return Response.json({ error: "적용할 수 없는 이미지입니다." }, { status: 400 });
  }

  const loaded = await loadProject(id, viewer.userId);
  if (!loaded) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

  const project = await applyGeneratedImage(loaded, imageUrl, body.label || "AI 생성");

  return Response.json({
    scene: project.scene,
    canUndo: loaded.engine.canUndo(),
    canRedo: loaded.engine.canRedo(),
  });
}
