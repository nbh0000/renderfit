import { chargeCredits, isDenied, EDITOR_COST } from "@/lib/credits";
import { getViewer } from "@/lib/auth";
import { loadProject, runAICommand } from "@/services/projectService";
import { intentOf } from "@/ai/router";

/** 자연어 명령 실행 (AI Command Bar) */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();
  const loaded = await loadProject(id, viewer.userId);

  if (!loaded) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

  let body: { instruction?: string; selectedObjectId?: string | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const instruction = (body.instruction ?? "").trim();
  if (!instruction) return Response.json({ error: "명령을 입력해 주세요." }, { status: 400 });
  if (instruction.length > 500) {
    return Response.json({ error: "명령이 너무 깁니다." }, { status: 400 });
  }

  const charge = await chargeCredits(EDITOR_COST.command);
  if (isDenied(charge)) return charge.denied;

  const result = await runAICommand(loaded, instruction, body.selectedObjectId ?? null);

  // 아무것도 못 알아들었으면 값을 받지 않는다
  if (!result.ok) await charge.refund();

  return Response.json({
    ok: result.ok,
    message: result.message,
    intent: intentOf(
      result.results.map((r) => ({ tool: r.tool, arguments: {}, explanation: "", confidence: 1 }))
    ),
    results: result.results,
    jobs: result.jobs,
    scene: result.project.scene,
    canUndo: loaded.engine.canUndo(),
    canRedo: loaded.engine.canRedo(),
  });
}
