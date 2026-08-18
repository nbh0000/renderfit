import { getViewer } from "@/lib/auth";
import { loadProject, persist } from "@/services/projectService";
import { executeCommand } from "@/ai/tools";
import type { StructuredCommand } from "@/ai/providers/types";

/**
 * Scene operation 실행.
 * 에디터(드래그/속성 변경)와 AI 커맨드가 같은 경로를 쓴다.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  const loaded = await loadProject(id, viewer.userId);

  if (!loaded) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

  let body: { tool?: string; arguments?: Record<string, unknown> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  if (!body.tool) return Response.json({ error: "실행할 도구가 없습니다." }, { status: 400 });

  const command: StructuredCommand = {
    tool: body.tool,
    arguments: body.arguments ?? {},
    explanation: "",
    confidence: 1,
  };

  const result = executeCommand(loaded.engine, command);
  if (!result.ok) {
    return Response.json({ error: result.error ?? result.message }, { status: 400 });
  }

  const project = await persist(loaded);

  return Response.json({
    ok: true,
    result,
    scene: project.scene,
    canUndo: loaded.engine.canUndo(),
    canRedo: loaded.engine.canRedo(),
  });
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  const loaded = await loadProject(id, viewer.userId);

  if (!loaded) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

  return Response.json(
    { operations: loaded.engine.getOperations().slice(-50) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
