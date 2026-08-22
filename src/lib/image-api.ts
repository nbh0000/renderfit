import { IMAGES_PER_JOB, MODEL_FLASH } from "@/config/plans";
import { roomSceneSvg } from "./placeholder-svg";

/**
 * 이미지 생성 어댑터 — Gemini 이미지 편집 API (Nano Banana 계열).
 *
 * GEMINI_API_KEY가 없으면 자동으로 mock 모드로 동작한다(플레이스홀더 SVG 반환).
 * 반환값은 항상 바이트이므로, 저장 위치(Supabase Storage / 인메모리)는 호출부가 정한다.
 */

export interface ImagePayload {
  /** base64 (data URL 접두사 없이) */
  data: string;
  mimeType: string;
}

export interface GenerateImagesParams {
  prompt: string;
  /** 원본 이미지 (사진 / 스케치 / 평면도) */
  image: ImagePayload;
  /** 보존 마스킹용 흑백 PNG. 흰색 = 보존 영역 */
  mask?: ImagePayload;
  /** 커스텀 스타일 참고 이미지 */
  reference?: ImagePayload;
  /** 생성 장수 */
  count?: number;
  /** 긴 변 기준 출력 px */
  size: number;
  /** 사용할 모델. 비우면 기본 모델을 쓴다 (해상도에 따라 호출부가 정한다) */
  model?: string;
  /** mock 결과 라벨링용 힌트 */
  hint?: { room: string; style: string; mode: string };
}

export interface GeneratedImage {
  data: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

/** 결과 이미지 비율 — 원본 앵글을 유지하는 4:3 기준 */
export const OUTPUT_ASPECT_RATIO = "4:3";

const DEFAULT_MODEL = MODEL_FLASH;

export function isMockMode(): boolean {
  return !process.env.GEMINI_API_KEY;
}

/**
 * 사용할 모델을 정한다.
 *
 * 우선순위는 환경변수 > 호출부 지정 > 기본값이다.
 * 환경변수를 두면 장애 상황에서 모델 하나로 전체를 되돌릴 수 있다.
 */
export function imageModel(requested?: string): string {
  return process.env.GEMINI_IMAGE_MODEL || requested || DEFAULT_MODEL;
}

/** 모델에 넘길 출력 크기 등급 */
function imageSizeLabel(px: number): "1K" | "2K" | "4K" {
  if (px >= 4096) return "4K";
  if (px >= 2048) return "2K";
  return "1K";
}

/**
 * N장을 병렬로 요청한다.
 *
 * 한 장이 실패해도 나머지는 돌려준다 — 4장 중 1장만 안전 필터에 걸려도
 * 전체가 실패하던 문제를 막기 위해서다. 모자란 장수만큼의 크레딧은 호출부가 환불한다.
 * 전부 실패했을 때만 예외를 던지며, 이때 메시지는 사용자에게 그대로 보여 줄 수 있는 문장이다.
 */
export async function generateImages(params: GenerateImagesParams): Promise<GeneratedImage[]> {
  const count = params.count ?? IMAGES_PER_JOB;
  if (isMockMode()) return mockGenerate(params, count);

  /*
   * 기본 해상도는 병렬로 던진다. 다만 2K·4K는 한 장에 30~50초가 걸리고 응답도 커서,
   * 네 장을 한꺼번에 던지면 쿼터에 걸리거나 메모리가 튄다. 큰 출력은 하나씩 만든다.
   */
  const sequential = params.size >= 2048;
  const settled: PromiseSettledResult<GeneratedImage>[] = [];

  if (sequential) {
    for (let i = 0; i < count; i += 1) {
      settled.push(
        await generateOne(params, i).then(
          (value) => ({ status: "fulfilled", value }) as const,
          (reason) => ({ status: "rejected", reason }) as const
        )
      );
    }
  } else {
    settled.push(
      ...(await Promise.allSettled(Array.from({ length: count }, (_, i) => generateOne(params, i))))
    );
  }

  const images = settled
    .filter((r): r is PromiseFulfilledResult<GeneratedImage> => r.status === "fulfilled")
    .map((r) => r.value);

  if (images.length === 0) {
    const reasons = settled
      .filter((r): r is PromiseRejectedResult => r.status === "rejected")
      .map((r) => describeImageError(r.reason));
    throw new Error(reasons[0] ?? "이미지를 만들지 못했습니다.");
  }

  return images;
}

/** 잠시 뒤 다시 시도하면 풀릴 수 있는 오류인지 */
function isTransient(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /429|RESOURCE_EXHAUSTED|rate limit|500|502|503|504|UNAVAILABLE|INTERNAL|fetch failed|ETIMEDOUT|ECONNRESET/i.test(
    text
  );
}

/**
 * API 오류를 사용자에게 보여 줄 한국어 문장으로 바꾼다.
 * 원인을 알 수 없을 때만 원문을 덧붙인다.
 */
export function describeImageError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);

  if (/SAFETY|PROHIBITED_CONTENT|IMAGE_SAFETY|blocked/i.test(text)) {
    return "안전 필터에 걸려 이미지를 만들지 못했습니다. 사진을 바꾸거나 추가 요청 문구를 조금 순화해서 다시 시도해 주세요.";
  }
  if (/429|RESOURCE_EXHAUSTED|quota|rate limit/i.test(text)) {
    return "이미지 생성 요청이 몰려 한도를 넘었습니다. 1~2분 뒤에 다시 시도해 주세요.";
  }
  if (/API key|API_KEY_INVALID|PERMISSION_DENIED|401|403/i.test(text)) {
    return "이미지 생성 API 인증에 실패했습니다. 서버 설정(API 키)을 확인해 주세요.";
  }
  if (/500|502|503|504|UNAVAILABLE|INTERNAL/i.test(text)) {
    return "이미지 생성 서버가 일시적으로 응답하지 않았습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (/fetch failed|ETIMEDOUT|ECONNRESET|network|timeout/i.test(text)) {
    return "이미지 생성 서버에 연결하지 못했습니다. 네트워크 상태를 확인하고 다시 시도해 주세요.";
  }
  if (/응답에 이미지가 없습니다|RECITATION|MAX_TOKENS/i.test(text)) {
    return text;
  }
  return `이미지 생성에 실패했습니다. (${text.slice(0, 160)})`;
}

async function generateOne(
  params: GenerateImagesParams,
  index: number,
  attempt = 0
): Promise<GeneratedImage> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const parts: Record<string, unknown>[] = [
    { text: params.prompt },
    { inlineData: { mimeType: params.image.mimeType, data: params.image.data } },
  ];

  if (params.mask) {
    parts.push({
      text: "다음 이미지는 보존 영역 마스크다. 흰색 영역은 원본을 그대로 유지하고 검은색 영역만 편집한다.",
    });
    parts.push({ inlineData: { mimeType: params.mask.mimeType, data: params.mask.data } });
  }

  if (params.reference) {
    parts.push({ text: "다음 이미지는 스타일 참고 이미지다. 컬러와 마감재의 분위기만 참고한다." });
    parts.push({ inlineData: { mimeType: params.reference.mimeType, data: params.reference.data } });
  }

  // 같은 요청을 여러 번 보낼 때 결과가 서로 다르도록 변주 지시를 덧붙인다.
  if (index > 0) {
    parts.push({
      text: `같은 조건에서 가구 배치와 소품 구성만 다른 ${index + 1}번째 대안 시안을 만든다. 구조는 동일하게 유지한다.`,
    });
  }

  // 모델마다 지원하는 config가 달라서(imageSize/aspectRatio 미지원 등) 단계적으로 낮춰 가며 호출한다.
  const configs: Record<string, unknown>[] = [
    {
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio: OUTPUT_ASPECT_RATIO,
        imageSize: imageSizeLabel(params.size),
      },
    },
    { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: OUTPUT_ASPECT_RATIO } },
    { responseModalities: ["IMAGE"] },
    {},
  ];

  let response: unknown;
  let lastError: unknown;

  for (const config of configs) {
    try {
      response = await ai.models.generateContent({
        model: imageModel(params.model),
        contents: [{ role: "user", parts }],
        ...(Object.keys(config).length > 0 ? { config } : {}),
      } as never);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    // 쿼터·일시 장애는 한 번만 더 시도한다. 그 이상은 사용자를 기다리게 하는 쪽이 더 나쁘다.
    if (attempt === 0 && isTransient(lastError)) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return generateOne(params, index, attempt + 1);
    }
    throw new Error(describeImageError(lastError));
  }

  const candidateParts =
    (response as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] })
      .candidates?.[0]?.content?.parts ?? [];

  const inline = candidateParts.find((part) => part?.inlineData?.data)?.inlineData;

  if (!inline?.data) {
    // 안전 필터에 걸리거나 텍스트만 돌아온 경우 — 이유를 응답에서 최대한 끌어낸다.
    const candidate = (response as {
      candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
      promptFeedback?: { blockReason?: string };
    }).candidates?.[0];

    const reason =
      (response as { promptFeedback?: { blockReason?: string } }).promptFeedback?.blockReason ??
      candidate?.finishReason ??
      "";
    const note = candidate?.content?.parts?.find((part) => part?.text)?.text ?? "";

    if (/SAFETY|PROHIBITED|IMAGE_SAFETY|BLOCK/i.test(reason)) {
      throw new Error(
        "안전 필터에 걸려 이미지를 만들지 못했습니다. 사진을 바꾸거나 추가 요청 문구를 조금 순화해서 다시 시도해 주세요."
      );
    }

    throw new Error(
      `이미지 생성 응답에 이미지가 없습니다.${reason ? ` (사유: ${reason})` : ""}${
        note ? ` 모델 응답: ${note.slice(0, 120)}` : ""
      }`
    );
  }

  return finalize(Buffer.from(inline.data, "base64"), inline.mimeType ?? "image/png", params.size);
}

/**
 * 모델이 돌려준 바이트를 저장 가능한 형태로 다듬는다.
 *
 * 두 가지를 바로잡는다.
 * 1) 실제 픽셀 크기를 읽어 기록한다 — 예전에는 "요청한 크기"를 그대로 적어서
 *    1024×768로 기록된 파일이 실제로는 1184×864인 경우가 있었다.
 * 2) PNG 원본은 장당 2MB에 가깝다. WebP로 다시 인코딩해 저장·전송 비용을 줄인다.
 */
async function finalize(
  data: Buffer,
  mimeType: string,
  requestedSize: number
): Promise<GeneratedImage> {
  if (mimeType.includes("svg")) {
    return { data, mimeType, width: requestedSize, height: Math.round((requestedSize * 3) / 4) };
  }

  try {
    const sharp = (await import("sharp")).default;
    // 고해상도 결제분은 화질을 더 남기되, 4K는 파일이 너무 커지지 않게 조인다.
    const quality = requestedSize >= 4096 ? 90 : requestedSize >= 2048 ? 93 : 90;
    const output = await sharp(data).webp({ quality }).toBuffer();
    const meta = await sharp(output).metadata();
    return {
      data: output,
      mimeType: "image/webp",
      width: meta.width ?? requestedSize,
      height: meta.height ?? Math.round((requestedSize * 3) / 4),
    };
  } catch {
    // sharp를 못 쓰는 환경에서도 생성 자체는 실패하지 않아야 한다.
    return { data, mimeType, width: requestedSize, height: Math.round((requestedSize * 3) / 4) };
  }
}

/** 실제 API 없이 파이프라인 전체를 검증하기 위한 플레이스홀더 */
async function mockGenerate(
  params: GenerateImagesParams,
  count: number
): Promise<GeneratedImage[]> {
  // 실제 생성 지연을 흉내 낸다.
  await new Promise((resolve) => setTimeout(resolve, 2200));

  const size = params.size;
  const hint = params.hint;

  return Array.from({ length: count }, (_, i) => {
    const svg = roomSceneSvg({
      width: size,
      height: Math.round((size * 3) / 4),
      tone: "#B79A78",
      seed: `${hint?.room ?? ""}-${hint?.style ?? ""}-${hint?.mode ?? ""}-${i}`,
      caption: [hint?.room, hint?.style].filter(Boolean).join(" · ") || "생성 결과",
      subCaption: `mock 시안 ${i + 1} · ${hint?.mode ?? ""}`,
    });
    return {
      data: Buffer.from(svg, "utf8"),
      mimeType: "image/svg+xml",
      width: size,
      height: Math.round((size * 3) / 4),
    };
  });
}

/* ─────────────────── 가구 한 점 만들기 (텍스트 → 이미지) ─────────────────── */

/**
 * 설명만으로 가구 이미지를 한 장 만든다.
 *
 * 편집기가 이 이미지를 3D 씬에 세워 쓰기 때문에, 방 사진을 만드는 것과 요구가 완전히 다르다.
 *  - 배경이 순백이어야 한다 — 3D에서 흰 픽셀을 지워 실루엣만 남기기 때문이다
 *  - 물체가 잘리지 않고 정면에서 보여야 한다 — 잘린 사진을 세우면 다리가 없는 의자가 된다
 *  - 그림자·바닥면이 없어야 한다 — 3D가 자기 그림자를 따로 만든다
 */
const PRODUCT_PROMPT = [
  "Create a product photograph of a single piece of furniture, described below.",
  "",
  "Strict requirements:",
  "- Pure white background (#FFFFFF), completely uniform, no gradient, no floor, no wall, no room.",
  "- No shadow of any kind, no reflection, no pedestal.",
  "- The entire object must be visible and centred, viewed straight from the front, slightly above eye level.",
  "- Nothing must be cropped — leave a small margin on every side.",
  "- One object only. No props, no people, no text, no watermark, no dimension labels.",
  "- Even, neutral studio lighting so the real colour of the material is visible.",
].join("\n");

/**
 * 만들 가구.
 * 텍스트만 넣으므로 편집 API가 아니라 순수 생성 호출이다 (참조 이미지가 없다).
 */
export async function generateProductImage(description: string, size = 1024): Promise<GeneratedImage> {
  if (isMockMode()) {
    const svg = roomSceneSvg({
      width: size,
      height: size,
      tone: "#B79A78",
      seed: description,
      caption: description.slice(0, 20),
      subCaption: "mock 가구",
    });
    return { data: Buffer.from(svg, "utf8"), mimeType: "image/svg+xml", width: size, height: size };
  }

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const parts = [{ text: `${PRODUCT_PROMPT}\n\nFurniture: ${description}` }];

  // 정사각이라야 3D에서 세울 때 실루엣이 한쪽으로 눌리지 않는다.
  const configs: Record<string, unknown>[] = [
    { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1", imageSize: "1K" } },
    { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "1:1" } },
    { responseModalities: ["IMAGE"] },
  ];

  let lastError = "이미지를 만들지 못했습니다.";

  for (const config of configs) {
    try {
      const response = await ai.models.generateContent({
        model: imageModel(),
        contents: [{ role: "user", parts }],
        config,
      });

      const inline = response.candidates
        ?.flatMap((candidate) => candidate.content?.parts ?? [])
        .find((part) => part.inlineData?.data)?.inlineData;

      if (!inline?.data) {
        lastError = "모델이 이미지를 돌려주지 않았습니다.";
        continue;
      }

      return {
        data: Buffer.from(inline.data, "base64"),
        mimeType: inline.mimeType ?? "image/png",
        width: size,
        height: size,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message.slice(0, 160) : lastError;
    }
  }

  throw new Error(lastError);
}
