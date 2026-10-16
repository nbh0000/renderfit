import { recordApiCall } from "@/lib/api-usage";
import type { SceneObject } from "@/scene/types";
import { DETERMINISTIC, OBJECT_TYPES, isFatalApiError } from "./geminiCommon";

/**
 * 설명 → 가구의 실제 크기.
 *
 * ── 이것은 "그림에서 좌표를 읽는" 코드가 아니다 ──
 *
 * 도면의 기하를 LLM 이 만들던 구조는 폐기했다. 여기 남은 것은 **글 한 줄에서 규격을
 * 묻는 일**이라 성격이 다르다 — 사용자가 "우드 원형 4인 식탁" 이라고 적어 에셋을
 * 만들 때, 생성된 그림은 크기를 알려 주지 않는다. 그런데 평면도에 발자국을 그리려면
 * mm 가 있어야 한다.
 *
 * 짐작한 값이라는 사실은 숨기지 않는다. 사용자가 편집기에서 언제든 고칠 수 있고,
 * 도면에서 잰 값과 섞이지 않는다 — 이 함수는 도면을 보지 않는다.
 */

/** 환경변수로 고정하면 그 모델만 쓴다 */
const MODEL_CANDIDATES = [
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
];

function models(): string[] {
  const pinned = process.env.GEMINI_VISION_MODEL;
  return pinned ? [pinned] : MODEL_CANDIDATES;
}

const SIZE_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: OBJECT_TYPES },
    name: { type: "string" },
    widthMm: { type: "number" },
    heightMm: { type: "number" },
    depthMm: { type: "number" },
  },
  required: ["type", "name", "widthMm", "heightMm", "depthMm"],
} as const;

export interface EstimatedFurniture {
  type: SceneObject["type"];
  name: string;
  dimensions: { width: number; height: number; depth: number };
}

/** 돌아온 값이 말이 되는 범위인지 확인하고 다듬는다 */
function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * "우드 원형 4인 식탁" 같은 설명에서 종류와 실제 크기를 읽는다.
 *
 * 텍스트 한 번이라 비용이 거의 들지 않고, 키가 없으면 기본값으로 조용히 넘어간다 —
 * 크기를 못 물어봤다고 에셋 만들기가 통째로 실패하면 안 된다.
 */
export async function estimateFurniture(description: string): Promise<EstimatedFurniture> {
  const fallback: EstimatedFurniture = {
    type: "custom",
    name: description.slice(0, 20) || "가구",
    dimensions: { width: 800, height: 800, depth: 600 },
  };

  if (!process.env.GEMINI_API_KEY) return fallback;

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const prompt = [
    "아래 가구의 종류와 실제 크기를 한국 유통 규격 기준으로 추정한다.",
    "widthMm는 정면에서 본 가로, depthMm는 앞뒤, heightMm는 바닥에서의 높이다.",
    "",
    `가구: ${description}`,
  ].join("\n");

  for (const model of models()) {
    const startedAt = Date.now();
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          ...DETERMINISTIC,
          responseMimeType: "application/json",
          responseSchema: SIZE_SCHEMA as never,
        },
      });
      recordApiCall({ model, kind: "furniture_estimate", ok: true, durationMs: Date.now() - startedAt });

      const text = response.text;
      if (!text) continue;

      const raw = JSON.parse(text) as {
        type?: string;
        name?: string;
        widthMm?: number;
        heightMm?: number;
        depthMm?: number;
      };

      return {
        type: OBJECT_TYPES.includes(raw.type as SceneObject["type"])
          ? (raw.type as SceneObject["type"])
          : "custom",
        name: raw.name?.trim() || fallback.name,
        dimensions: {
          width: Math.round(clamp(raw.widthMm ?? 0, 50, 6000, 800)),
          height: Math.round(clamp(raw.heightMm ?? 0, 20, 3000, 800)),
          depth: Math.round(clamp(raw.depthMm ?? 0, 50, 3000, 600)),
        },
      };
    } catch (error) {
      // 키·한도 문제라면 다음 모델도 똑같이 거절당한다.
      if (isFatalApiError(error)) break;
    }
  }

  return fallback;
}
