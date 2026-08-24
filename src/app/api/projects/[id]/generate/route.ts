import { chargeCredits, isDenied, EDITOR_COST } from "@/lib/credits";
import { getViewer } from "@/lib/auth";
import {
  enqueueGenerate,
  enqueueGenerateVariants,
  loadProject,
  VARIANT_COUNT,
} from "@/services/projectService";

/** 스타일 기반 AI 생성 시작 (background job) */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const viewer = await getViewer();

  let body: { styleId?: string | null; prompt?: string; variants?: number };
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

  // variants=2 → 두 방향으로 만들어 고르게 한다 (바로 적용하지 않는다)
  const options = { styleId: body.styleId ?? null, prompt: body.prompt };
  const compare = Boolean(body.variants && body.variants > 1);

  /*
   * 2안 비교는 이미지 생성을 두 번 부른다. 한 번 값만 받으면 가장 비싼 작업에서
   * 원가의 절반만 받는 셈이라, 만드는 장수만큼 받는다.
   */
  const charge = await chargeCredits(
    compare ? EDITOR_COST.renderFinal * VARIANT_COUNT : EDITOR_COST.renderFinal
  );
  if (isDenied(charge)) return charge.denied;

  const job = compare
    ? enqueueGenerateVariants(loaded, options, charge.refund)
    : enqueueGenerate(loaded, options, charge.refund);

  return Response.json({ job });
}
