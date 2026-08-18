import { FLOORPLAN_PROMPT_TEMPLATE } from "@/config/modes";
import { FLOORPLAN_CREDITS } from "@/config/plans";
import { generateImages } from "@/lib/image-api";
import { getViewer } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { RESULTS_BUCKET } from "@/lib/supabase/env";

/**
 * 참고용 배치도 생성 — 이미 만들어진 시안 1장을 입력으로 탑뷰 배치도 1장을 만든다.
 * 결과에는 반드시 고정 고지 문구가 따라붙는다(표시는 클라이언트, 다운로드 파일은 canvas 합성).
 */

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

/** 배치도 생성용 크기 — 도면 다이어그램이므로 기본 해상도로 충분하다. */
const FLOORPLAN_SIZE = 1024;

export async function POST(request: Request) {
  let body: { resultId?: string; imageUrl?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad("요청 형식이 올바르지 않습니다.");
  }

  const viewer = await getViewer();

  /* ── 로컬 mock 모드 ── */
  if (!viewer.configured) {
    const imageUrl = body.imageUrl ?? "";
    const parsed = parseDataUrl(imageUrl);
    if (!parsed) return bad("배치도를 만들 이미지를 찾을 수 없습니다.");

    const [image] = await generateImages({
      prompt: FLOORPLAN_PROMPT_TEMPLATE,
      image: parsed,
      size: FLOORPLAN_SIZE,
      count: 1,
      hint: { room: "배치도", style: "탑뷰", mode: "참고용 배치도" },
    });

    return Response.json({
      url: `data:${image.mimeType};base64,${image.data.toString("base64")}`,
      creditsCharged: FLOORPLAN_CREDITS,
    });
  }

  /* ── Supabase 모드 ── */
  if (!viewer.userId) return bad("로그인이 필요합니다.", 401);
  if (!body.resultId) return bad("배치도를 만들 시안을 지정해 주세요.");

  const supabase = await createServerSupabase();
  if (!supabase) return bad("서버 설정 오류입니다.", 500);

  const { data: result, error: resultError } = await supabase
    .from("generation_results")
    .select("id, job_id, storage_path, user_id")
    .eq("id", body.resultId)
    .maybeSingle();

  if (resultError || !result) return bad("해당 시안을 찾을 수 없습니다.", 404);

  // 원본 시안을 내려받아 생성 입력으로 쓴다.
  const { data: file, error: downloadError } = await supabase.storage
    .from(RESULTS_BUCKET)
    .download(result.storage_path as string);

  if (downloadError || !file) return bad("시안 이미지를 불러오지 못했습니다.", 500);

  const bytes = Buffer.from(await file.arrayBuffer());

  // 크레딧 선차감
  const { error: consumeError } = await supabase.rpc("consume_credits", {
    p_amount: FLOORPLAN_CREDITS,
  });
  if (consumeError) {
    const insufficient = consumeError.message?.includes("INSUFFICIENT_CREDITS");
    return bad(insufficient ? "크레딧이 부족합니다." : "크레딧 차감에 실패했습니다.", insufficient ? 402 : 500);
  }

  const refund = async () => {
    await supabase.rpc("refund_credits", { p_amount: FLOORPLAN_CREDITS });
  };

  try {
    const [image] = await generateImages({
      prompt: FLOORPLAN_PROMPT_TEMPLATE,
      image: { data: bytes.toString("base64"), mimeType: file.type || "image/png" },
      size: FLOORPLAN_SIZE,
      count: 1,
      hint: { room: "배치도", style: "탑뷰", mode: "참고용 배치도" },
    });

    const extension = image.mimeType.includes("svg") ? "svg" : "png";
    const path = `${viewer.userId}/${result.job_id}/floorplan-${result.id}.${extension}`;

    // TODO: 배치도는 아직 DB에 기록하지 않는다. 보관/재열람이 필요해지면 테이블을 추가한다.
    const { error: uploadError } = await supabase.storage
      .from(RESULTS_BUCKET)
      .upload(path, image.data, { contentType: image.mimeType, upsert: true });

    if (uploadError) throw new Error(uploadError.message);

    const url = supabase.storage.from(RESULTS_BUCKET).getPublicUrl(path).data.publicUrl;

    const { data: profile } = await supabase
      .from("profiles")
      .select("credits")
      .eq("id", viewer.userId)
      .maybeSingle();

    return Response.json({
      url,
      creditsCharged: FLOORPLAN_CREDITS,
      credits: profile?.credits ?? null,
    });
  } catch (error) {
    await refund();
    return bad(
      error instanceof Error
        ? `배치도 생성에 실패했습니다. 크레딧이 환불되었습니다.`
        : "배치도 생성에 실패했습니다. 크레딧이 환불되었습니다.",
      500
    );
  }
}

function parseDataUrl(value: string): { data: string; mimeType: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(value);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}
