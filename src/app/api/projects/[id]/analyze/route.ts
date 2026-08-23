import { chargeCredits, isDenied, EDITOR_COST } from "@/lib/credits";
import { getViewer } from "@/lib/auth";
import { enqueueAnalyze, loadProject } from "@/services/projectService";

/** AI 공간 분석 시작 (background job) */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();

  const loaded = await loadProject(id, viewer.userId);
  if (!loaded) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

  if (!loaded.engine.getScene().source.imageUrl) {
    return Response.json({ error: "먼저 방 사진을 업로드해 주세요." }, { status: 400 });
  }

  const charge = await chargeCredits(EDITOR_COST.analyze);
  if (isDenied(charge)) return charge.denied;

  const job = enqueueAnalyze(loaded, charge.refund);
  return Response.json({ job });
}
