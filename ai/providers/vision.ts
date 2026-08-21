import type { DetectedObject, ImageRef, RoomAnalysis, VisionProvider } from "./types";
import type { SceneObject } from "@/scene/types";

/**
 * Gemini 기반 공간 분석.
 *
 * 생성된 시안 사진 한 장에서 "이 방이 어떻게 생겼는가"를 구조화된 값으로 받아 온다.
 * 지금까지는 mock이 정해진 배치를 돌려줬기 때문에, 사진을 아무리 바꿔도 평면도·측면도·3D가
 * 늘 같은 방을 그렸다. 이 provider가 그 자리를 대신한다.
 *
 * 모델에게 "그림을 그려 달라"가 아니라 "치수를 재 달라"고 요청하는 것이라,
 * 이미지 생성 모델이 아니라 일반 멀티모달 모델(gemini-3-flash 계열)을 쓴다.
 *
 * ⚠ 반환값은 어디까지나 사진에서 읽은 추정치다. 실측이 아니며 사용자가 실측값을
 *   입력하면 그 값이 우선한다.
 */

/*
 * 사용할 모델 후보.
 *
 * 앞에서부터 시도하고 실패하면 다음으로 넘어간다. 최신 모델은 "high demand"로
 * 503을 자주 돌려주는데, 한 모델만 박아 두면 그때마다 분석이 통째로 죽는다.
 * (실제로 존재하지 않는 모델 이름을 박아 두는 바람에 분석이 늘 mock으로
 *  떨어지고 있었다 — 그래서 사진을 바꿔도 도면이 그대로였다.)
 */
const MODEL_CANDIDATES = [
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
];

/** 모델이 돌려줄 수 있는 객체 종류 — Scene 타입과 1:1로 맞춘다 */
const OBJECT_TYPES: SceneObject["type"][] = [
  "window",
  "door",
  "sofa",
  "chair",
  "table",
  "cabinet",
  "bed",
  "lamp",
  "plant",
  "rug",
  "tv",
  "appliance",
  "decoration",
];

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    roomType: { type: "string" },
    roomWidthMm: { type: "number" },
    roomLengthMm: { type: "number" },
    roomHeightMm: { type: "number" },
    styleGuess: { type: "string" },
    lightFrom: { type: "string", enum: ["left", "right", "front", "back", "top"] },
    objects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: OBJECT_TYPES },
          name: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
          depthRatio: { type: "number" },
          widthMm: { type: "number" },
          heightMm: { type: "number" },
          depthMm: { type: "number" },
          color: { type: "string" },
          material: { type: "string" },
          confidence: { type: "number" },
        },
        // 치수를 필수로 두지 않으면 모델이 자주 비워 보낸다 — 도면에는 mm가 있어야 한다.
        required: [
          "type",
          "name",
          "x",
          "y",
          "width",
          "height",
          "depthRatio",
          "widthMm",
          "heightMm",
          "depthMm",
        ],
      },
    },
  },
  required: ["roomType", "roomWidthMm", "roomLengthMm", "roomHeightMm", "objects"],
} as const;

const PROMPT = [
  "이 실내 사진을 보고 공간을 측량하듯 분석한다.",
  "",
  "1) 방의 크기를 추정한다 (mm). 한국 주거 기준으로 문 높이 2100mm, 천장 2300~2600mm,",
  "   창 하단 800~1000mm 같은 일반적인 치수를 기준자로 삼아 역산한다.",
  "2) 사진에 보이는 창문·문·가구를 모두 찾는다. 벽에 붙은 붙박이장도 cabinet으로 넣는다.",
  "3) 각 객체마다 다음을 준다.",
  "   - x, y, width, height: 사진 안에서의 위치와 크기 (0~1 비율, 좌상단 원점)",
  "   - depthRatio: 카메라에서 먼 정도 (0=가장 앞, 1=가장 안쪽 벽)",
  "   - widthMm, heightMm, depthMm: 실제 크기 추정 (mm)",
  "   - color: 대표 색 (#RRGGBB), material: 마감 재질을 한 단어로",
  "",
  "주의할 점:",
  "- 창문과 문은 반드시 빠뜨리지 않는다. 평면도와 입면도에서 가장 중요한 요소다.",
  "- 벽에 걸린 TV나 액자는 벽면 높이를 알 수 있게 y 값을 정확히 준다.",
  "- 사진에 없는 것을 지어내지 않는다. 확신이 없으면 confidence를 낮게 준다.",
  "- 이름은 한국어로 짧게 쓴다 (예: 3인용 소파, 좌측 창문, 방문).",
].join("\n");

interface RawObject {
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depthRatio: number;
  widthMm?: number;
  heightMm?: number;
  depthMm?: number;
  color?: string;
  material?: string;
  confidence?: number;
}

interface RawAnalysis {
  roomType: string;
  roomWidthMm: number;
  roomLengthMm: number;
  roomHeightMm: number;
  styleGuess?: string;
  lightFrom?: string;
  objects: RawObject[];
}

/** 사진에서 읽은 값이 말이 되는 범위인지 확인하고 다듬는다 */
function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1, 0.5);
}

/** 조명 방향 문자열 → 3D 벡터 */
function lightVector(from: string | undefined): [number, number, number] {
  switch (from) {
    case "left":
      return [-1, 0.8, 0.4];
    case "right":
      return [1, 0.8, 0.4];
    case "back":
      return [0, 0.8, -1];
    case "top":
      return [0, 1, 0];
    default:
      return [0, 0.9, 1];
  }
}

/** 환경변수로 고정하면 그 모델만 쓴다 */
export function visionModels(): string[] {
  const pinned = process.env.GEMINI_VISION_MODEL;
  return pinned ? [pinned] : MODEL_CANDIDATES;
}

export class GeminiVisionProvider implements VisionProvider {
  readonly name = "gemini-vision";

  constructor(private readonly fallback: VisionProvider) {}

  async analyzeRoom(image: ImageRef): Promise<RoomAnalysis> {
    const payload = await loadImage(image.url);
    if (!payload) {
      console.warn("[vision] 이미지를 읽지 못해 기본 배치로 대체합니다:", image.url);
      return this.fallback.analyzeRoom(image);
    }

    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

    const errors: string[] = [];

    for (const model of visionModels()) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                { text: PROMPT },
                { inlineData: { mimeType: payload.mimeType, data: payload.data } },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA as never,
          },
        });

        const text = response.text;
        if (!text) {
          errors.push(`${model}: 빈 응답`);
          continue;
        }

        const analysis = toAnalysis(JSON.parse(text) as RawAnalysis);
        console.info(
          `[vision] ${model}로 분석했습니다 — ${analysis.roomType} ${analysis.roomDimensions.width}×${analysis.roomDimensions.length}mm, 객체 ${analysis.objects.length}개`
        );
        return analysis;
      } catch (error) {
        errors.push(`${model}: ${error instanceof Error ? error.message.slice(0, 120) : "실패"}`);
      }
    }

    /*
     * 여기까지 왔다는 건 모든 모델이 실패했다는 뜻이다.
     * 조용히 넘어가면 "사진을 바꿔도 도면이 그대로"인 상태가 그대로 유지되므로
     * 반드시 로그로 남긴다.
     */
    console.error(
      "[vision] 공간 분석 실패 — 기본 배치로 대체합니다.\n  " + errors.join("\n  ")
    );
    return this.fallback.analyzeRoom(image);
  }
}

function toAnalysis(raw: RawAnalysis): RoomAnalysis {
  const width = clamp(raw.roomWidthMm, 1500, 20000, 4000);
  const length = clamp(raw.roomLengthMm, 1500, 20000, 5000);
  const height = clamp(raw.roomHeightMm, 2000, 4500, 2400);

  const objects: DetectedObject[] = (raw.objects ?? [])
    .filter((item) => OBJECT_TYPES.includes(item.type as SceneObject["type"]))
    .map((item) => ({
      type: item.type as SceneObject["type"],
      name: item.name?.trim() || "객체",
      bbox: [
        clamp01(item.x),
        clamp01(item.y),
        clamp(item.width, 0.01, 1, 0.2),
        clamp(item.height, 0.01, 1, 0.2),
      ],
      maskUrl: null,
      depth: clamp01(item.depthRatio),
      material: item.material?.trim() || null,
      color: /^#[0-9a-f]{6}$/i.test(item.color ?? "") ? item.color! : null,
      confidence: clamp(item.confidence ?? 0.7, 0, 1, 0.7),
      dimensions: {
        width: clamp(item.widthMm ?? 0, 50, 6000, 800),
        height: clamp(item.heightMm ?? 0, 50, 3000, 800),
        depth: clamp(item.depthMm ?? 0, 50, 3000, 600),
      },
    }));

  return {
    roomType: raw.roomType || "living_room",
    roomDimensions: { width, length, height },
    objects,
    styleGuess: raw.styleGuess?.trim() || null,
    lightDirection: lightVector(raw.lightFrom),
  };
}

/** 이미지 URL을 base64로 읽는다 (로컬 스토리지 경로와 원격 URL 모두 지원) */
async function loadImage(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    if (url.startsWith("data:")) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(url);
      return match ? { mimeType: match[1], data: match[2] } : null;
    }

    if (url.startsWith("/")) {
      const { getStorage } = await import("@/lib/storage");
      const key = url.replace(/^\/api\/files\//, "");
      const buffer = await getStorage().download(key);
      return { data: buffer.toString("base64"), mimeType: guessMime(url) };
    }

    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      data: buffer.toString("base64"),
      mimeType: response.headers.get("content-type") ?? guessMime(url),
    };
  } catch {
    return null;
  }
}

function guessMime(url: string): string {
  if (url.endsWith(".png")) return "image/png";
  if (url.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
