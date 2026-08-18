import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMode } from "@/config/modes";
import { getRoom } from "@/config/rooms";
import { getStyle } from "@/config/styles";
import {
  IMAGES_PER_JOB,
  RESOLUTION_MAP,
  creditCost,
  getPlan,
  planAllows,
  type PlanId,
  type ResolutionId,
} from "@/config/plans";
import { generateImages, isMockMode, type ImagePayload } from "@/lib/image-api";
import { createMemoryStore, createSupabaseStore, type JobStore } from "@/lib/jobs/store";
import { newId, putJob } from "@/lib/job-store";
import { buildPrompt } from "@/lib/prompt";
import { getViewer } from "@/lib/auth";
import { createAdminSupabase, createServerSupabase } from "@/lib/supabase/server";
import { SOURCES_BUCKET } from "@/lib/supabase/env";
import type { GenerationJob, GenerationSettings } from "@/lib/types";
import { validateImageFile } from "@/lib/upload";

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes("jpeg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

async function toPayload(file: File): Promise<{ payload: ImagePayload; bytes: Buffer }> {
  const bytes = Buffer.from(await file.arrayBuffer());
  return {
    payload: { data: bytes.toString("base64"), mimeType: file.type },
    bytes,
  };
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("요청 형식이 올바르지 않습니다.");
  }

  const raw = form.get("settings");
  if (typeof raw !== "string") return bad("생성 설정이 없습니다.");

  let settings: GenerationSettings;
  try {
    settings = JSON.parse(raw) as GenerationSettings;
  } catch {
    return bad("생성 설정을 읽을 수 없습니다.");
  }

  const image = form.get("image");
  if (!(image instanceof File)) return bad("이미지를 업로드해 주세요.");
  const fileCheck = validateImageFile(image);
  if (!fileCheck.ok) return bad(fileCheck.message!);

  const mode = getMode(settings.modeId);
  const room = getRoom(settings.roomId);
  const style = getStyle(settings.styleId);
  if (!mode || !room || !style) return bad("모드/방/스타일 값이 올바르지 않습니다.");

  const resolution = RESOLUTION_MAP[settings.resolution as ResolutionId];
  if (!resolution) return bad("해상도 값이 올바르지 않습니다.");

  /* ── 사용자와 플랜 ── */
  const viewer = await getViewer();
  let planId: PlanId;

  if (viewer.configured) {
    if (!viewer.userId || !viewer.profile) return bad("로그인이 필요합니다.", 401);
    planId = viewer.profile.plan;
  } else {
    // Supabase 미설정 로컬 모드에서만 클라이언트가 보낸 플랜을 신뢰한다.
    planId = (request.headers.get("x-mock-plan") ?? "free") as PlanId;
  }

  const plan = getPlan(planId);

  if (!planAllows(plan.id, mode.requiredPlan)) {
    return bad(
      `${mode.label} 모드는 ${getPlan(mode.requiredPlan).label} 플랜부터 사용할 수 있습니다.`,
      403
    );
  }
  if (!planAllows(plan.id, resolution.requiredPlan)) {
    return bad("고해상도 출력은 프로 플랜 전용입니다.", 403);
  }
  if (settings.useMask && !plan.features.masking) {
    return bad("보존 마스킹은 프로 플랜 전용입니다.", 403);
  }
  const hasMaterials = Object.values(settings.materials ?? {}).some(
    (v) => typeof v === "string" && v.trim().length > 0
  );
  if (hasMaterials && !plan.features.materials) {
    return bad("재질 지정은 프로 플랜 전용입니다.", 403);
  }

  /* ── 장수와 크레딧 ── */
  const requestedCount = Number(form.get("count") ?? IMAGES_PER_JOB);
  const count = Math.min(
    IMAGES_PER_JOB,
    Math.max(1, Number.isFinite(requestedCount) ? Math.floor(requestedCount) : IMAGES_PER_JOB)
  );

  const prompt = buildPrompt(settings);
  const credits = creditCost(resolution.id, count);
  const watermark = !plan.features.noWatermark;
  const forceFail = form.get("simulateFailure") === "true";

  const { payload: sourcePayload, bytes: sourceBytes } = await toPayload(image);

  const referenceFile = form.get("reference");
  const reference =
    referenceFile instanceof File && validateImageFile(referenceFile).ok
      ? (await toPayload(referenceFile)).payload
      : undefined;

  const maskFile = form.get("mask");
  const mask =
    settings.useMask && maskFile instanceof File
      ? (await toPayload(maskFile)).payload
      : undefined;

  const hint = { room: room.label, style: style.label, mode: mode.label };

  /* ── 로컬 mock 모드 (Supabase 미설정) ── */
  if (!viewer.configured) {
    const job: GenerationJob = {
      id: newId("job"),
      status: "pending",
      createdAt: new Date().toISOString(),
      settings,
      sourceImageUrl: null, // 원본은 클라이언트 objectURL로 표시
      prompt,
      results: [],
      creditsCharged: credits,
      planAtRequest: plan.id,
    };
    putJob(job);

    const store = createMemoryStore();
    after(() =>
      runPipeline({
        store,
        jobId: job.id,
        prompt,
        source: sourcePayload,
        mask,
        reference,
        size: resolution.px,
        count,
        watermark,
        hint,
        forceFail,
        refundCredits: credits,
      })
    );

    return Response.json({ jobId: job.id, creditsCharged: credits, mock: isMockMode() });
  }

  /* ── Supabase 모드 ── */
  const supabase = await createServerSupabase();
  if (!supabase) return bad("서버 설정 오류입니다.", 500);

  const userId = viewer.userId!;

  // 1) 크레딧 선차감 (동시 요청에서도 잔액이 음수가 되지 않는다)
  const { data: remainingCredits, error: consumeError } = await supabase.rpc("consume_credits", {
    p_amount: credits,
  });
  if (consumeError) {
    const insufficient = consumeError.message?.includes("INSUFFICIENT_CREDITS");
    return bad(
      insufficient ? "크레딧이 부족합니다." : "크레딧 차감에 실패했습니다.",
      insufficient ? 402 : 500
    );
  }

  const refundWithSession = async (amount: number) => {
    const { error } = await supabase.rpc("refund_credits", { p_amount: amount });
    return !error;
  };

  const jobId = crypto.randomUUID();
  const sourcePath = `${userId}/${jobId}/source.${extensionFor(image.type)}`;

  // 2) 원본 업로드
  const { error: uploadError } = await supabase.storage
    .from(SOURCES_BUCKET)
    .upload(sourcePath, sourceBytes, { contentType: image.type, upsert: true });

  if (uploadError) {
    await refundWithSession(credits);
    return bad("원본 이미지를 저장하지 못했습니다.", 500);
  }

  // 3) job 기록 (pending)
  const { error: insertError } = await supabase.from("generation_jobs").insert({
    id: jobId,
    user_id: userId,
    project_id: settings.projectId ?? null,
    status: "pending",
    mode_id: settings.modeId,
    room_id: settings.roomId,
    style_id: settings.styleId,
    resolution: settings.resolution,
    materials: settings.materials ?? {},
    use_mask: Boolean(settings.useMask),
    prompt,
    source_path: sourcePath,
    image_count: count,
    credits_charged: credits,
    plan_at_request: plan.id,
  });

  if (insertError) {
    await refundWithSession(credits);
    return bad("작업을 생성하지 못했습니다.", 500);
  }

  // 4) 생성은 응답 이후 백그라운드로 진행한다.
  // 서비스 롤 키가 있으면 그걸로, 없으면 사용자 세션 클라이언트로 기록한다.
  const admin = createAdminSupabase();
  const writer: SupabaseClient = admin ?? supabase;
  const refund = admin
    ? async (amount: number) => {
        const { error } = await admin.rpc("admin_refund_credits", {
          p_user: userId,
          p_amount: amount,
        });
        return !error;
      }
    : refundWithSession;

  const store = createSupabaseStore(writer, userId, refund);

  // TODO: 생성 시간이 길어지면 서버리스 타임아웃을 넘길 수 있다.
  //       추후 큐(예: Supabase Edge Function + pg_cron, 또는 QStash)로 이관한다.
  after(() =>
    runPipeline({
      store,
      jobId,
      prompt,
      source: sourcePayload,
      mask,
      reference,
      size: resolution.px,
      count,
      watermark,
      hint,
      forceFail,
      refundCredits: credits,
    })
  );

  return Response.json({
    jobId,
    creditsCharged: credits,
    credits: remainingCredits,
    mock: isMockMode(),
  });
}

interface PipelineInput {
  store: JobStore;
  jobId: string;
  prompt: string;
  source: ImagePayload;
  mask?: ImagePayload;
  reference?: ImagePayload;
  size: number;
  count: number;
  watermark: boolean;
  hint: { room: string; style: string; mode: string };
  forceFail: boolean;
  refundCredits: number;
}

/** 생성 → 저장. 어떤 단계에서 실패하든 크레딧을 환불하고 job을 failed로 남긴다. */
async function runPipeline(input: PipelineInput): Promise<void> {
  try {
    await input.store.markProcessing(input.jobId);

    if (input.forceFail) {
      throw new Error("이미지 생성에 실패했습니다. (시뮬레이션)");
    }

    const images = await generateImages({
      prompt: input.prompt,
      image: input.source,
      mask: input.mask,
      reference: input.reference,
      size: input.size,
      count: input.count,
      hint: input.hint,
    });

    await input.store.saveResults(input.jobId, images, input.watermark);
  } catch (error) {
    const message = error instanceof Error ? error.message : "알 수 없는 오류";
    try {
      await input.store.markFailed(input.jobId, message, input.refundCredits);
    } catch {
      // 실패 기록마저 실패하면 폴링이 타임아웃으로 처리한다.
    }
  }
}
