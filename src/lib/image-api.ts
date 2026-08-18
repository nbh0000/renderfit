import { IMAGES_PER_JOB } from "@/config/plans";
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

const DEFAULT_MODEL = "gemini-2.5-flash-image";

export function isMockMode(): boolean {
  return !process.env.GEMINI_API_KEY;
}

export function imageModel(): string {
  // TODO: Nano Banana Pro 등 상위 모델로 교체할 때 환경변수만 바꾸면 되도록 분리해 둔다.
  return process.env.GEMINI_IMAGE_MODEL || DEFAULT_MODEL;
}

export async function generateImages(params: GenerateImagesParams): Promise<GeneratedImage[]> {
  const count = params.count ?? IMAGES_PER_JOB;
  if (isMockMode()) return mockGenerate(params, count);

  // 같은 프롬프트로 N장을 병렬 요청한다. 한 장이라도 실패하면 상위에서 환불 처리한다.
  const images = await Promise.all(
    Array.from({ length: count }, (_, i) => generateOne(params, i))
  );
  return images;
}

async function generateOne(params: GenerateImagesParams, index: number): Promise<GeneratedImage> {
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
        imageSize: params.size >= 2048 ? "2K" : "1K",
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
        model: imageModel(),
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
    throw new Error(
      `이미지 생성 API 호출에 실패했습니다: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }

  const candidateParts =
    (response as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] })
      .candidates?.[0]?.content?.parts ?? [];

  const inline = candidateParts.find((part) => part?.inlineData?.data)?.inlineData;

  if (!inline?.data) {
    // 안전 필터에 걸리거나 텍스트만 돌아온 경우
    throw new Error("이미지 생성 응답에 이미지가 없습니다.");
  }

  return {
    data: Buffer.from(inline.data, "base64"),
    mimeType: inline.mimeType ?? "image/png",
    width: params.size,
    height: Math.round((params.size * 3) / 4),
  };
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
