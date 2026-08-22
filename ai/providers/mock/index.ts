import { createHash } from "node:crypto";
import type {
  DepthProvider,
  DepthResult,
  DetectedObject,
  EmbeddingProvider,
  GenerationParams,
  GenerationProvider,
  GenerationResult,
  ImageRef,
  InpaintParams,
  LLMProvider,
  RenderResult,
  RenderingProvider,
  RoomAnalysis,
  SegmentationProvider,
  SegmentationResult,
  StructuredCommand,
  ChatMessage,
} from "../types";
import type { Scene } from "@/scene/types";
import { getStorage } from "@/lib/storage";
import { renderDepthMapSvg, renderSceneToSvg, renderSegmentationSvg } from "./sceneRaster";
import { routeCommand } from "@/ai/router";

/**
 * Mock Provider 모음.
 *
 * API key 없이도 제품 전체 workflow가 끝까지 동작하도록 만든다.
 * 인터페이스는 실제 provider와 동일하므로 나중에 교체만 하면 된다.
 */

function hash(input: string): number {
  const digest = createHash("sha1").update(input).digest();
  return digest.readUInt32BE(0);
}

function pseudoRandom(seed: number, index: number): number {
  const x = Math.sin(seed + index * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

async function storeSvg(key: string, svg: string): Promise<string> {
  return getStorage().upload(key, svg, "image/svg+xml");
}

/* ─────────────────────────── Vision ─────────────────────────── */

interface Blueprint {
  type: DetectedObject["type"];
  name: string;
  bbox: [number, number, number, number];
  depth: number;
  material: string;
  color: string;
  dimensions: [number, number, number];
}

/** 방 종류별 기본 객체 배치. 실제 vision 모델이 붙기 전까지 이 배치를 사용한다. */
const ROOM_BLUEPRINTS: Record<string, Blueprint[]> = {
  living_room: [
    { type: "window", name: "창문", bbox: [0.05, 0.14, 0.24, 0.36], depth: 0.9, material: "mat_white_paint", color: "#eef2f5", dimensions: [1800, 2000, 120] },
    { type: "rug", name: "러그", bbox: [0.22, 0.72, 0.5, 0.16], depth: 0.5, material: "mat_beige_fabric", color: "#d8c8b2", dimensions: [2400, 20, 1700] },
    { type: "sofa", name: "소파", bbox: [0.18, 0.52, 0.36, 0.2], depth: 0.45, material: "mat_beige_fabric", color: "#d8c8b2", dimensions: [2200, 850, 950] },
    { type: "table", name: "커피 테이블", bbox: [0.42, 0.66, 0.18, 0.1], depth: 0.35, material: "mat_oak", color: "#c9a173", dimensions: [1100, 400, 600] },
    { type: "cabinet", name: "TV 수납장", bbox: [0.62, 0.6, 0.26, 0.12], depth: 0.7, material: "mat_walnut", color: "#6b4a34", dimensions: [1800, 450, 400] },
    { type: "tv", name: "TV", bbox: [0.66, 0.42, 0.2, 0.16], depth: 0.75, material: "mat_black_steel", color: "#2f2d2b", dimensions: [1450, 850, 60] },
    { type: "lamp", name: "플로어 램프", bbox: [0.88, 0.36, 0.06, 0.3], depth: 0.6, material: "mat_black_steel", color: "#2f2d2b", dimensions: [400, 1650, 400] },
    { type: "plant", name: "화분", bbox: [0.06, 0.55, 0.09, 0.22], depth: 0.55, material: "mat_green_plant", color: "#5c7a52", dimensions: [700, 1600, 700] },
  ],
  bedroom: [
    { type: "window", name: "창문", bbox: [0.06, 0.16, 0.22, 0.32], depth: 0.9, material: "mat_white_paint", color: "#eef2f5", dimensions: [1500, 1800, 120] },
    { type: "bed", name: "침대", bbox: [0.24, 0.52, 0.42, 0.28], depth: 0.5, material: "mat_linen", color: "#e7e0d3", dimensions: [1600, 1000, 2100] },
    { type: "table", name: "협탁", bbox: [0.68, 0.58, 0.1, 0.1], depth: 0.55, material: "mat_oak", color: "#c9a173", dimensions: [450, 550, 450] },
    { type: "lamp", name: "테이블 램프", bbox: [0.7, 0.48, 0.06, 0.1], depth: 0.5, material: "mat_brass", color: "#b08d4e", dimensions: [300, 550, 300] },
    { type: "cabinet", name: "옷장", bbox: [0.8, 0.28, 0.16, 0.44], depth: 0.8, material: "mat_walnut", color: "#6b4a34", dimensions: [1200, 2200, 600] },
    { type: "rug", name: "러그", bbox: [0.28, 0.78, 0.4, 0.12], depth: 0.4, material: "mat_beige_fabric", color: "#d8c8b2", dimensions: [2000, 20, 1400] },
  ],
  kitchen: [
    { type: "cabinet", name: "상부장", bbox: [0.1, 0.16, 0.5, 0.16], depth: 0.85, material: "mat_white_paint", color: "#f4f2ef", dimensions: [3000, 700, 350] },
    { type: "cabinet", name: "하부장", bbox: [0.1, 0.52, 0.5, 0.2], depth: 0.8, material: "mat_light_oak", color: "#dcc19a", dimensions: [3000, 850, 600] },
    { type: "appliance", name: "냉장고", bbox: [0.66, 0.24, 0.16, 0.48], depth: 0.75, material: "mat_black_steel", color: "#2f2d2b", dimensions: [900, 1900, 750] },
    { type: "table", name: "아일랜드", bbox: [0.3, 0.66, 0.34, 0.14], depth: 0.4, material: "mat_marble", color: "#eceae6", dimensions: [1800, 900, 900] },
  ],
};

export class MockVisionProvider implements VisionProviderShape {
  readonly name = "mock-vision";

  async analyzeRoom(image: ImageRef): Promise<RoomAnalysis> {
    await delay(700);

    const seed = hash(image.url);
    const roomTypes = ["living-room", "bedroom", "kitchen"] as const;
    // 이미지 URL이 방 종류 힌트를 담고 있으면 우선한다.
    const hinted = roomTypes.find((type) => image.url.includes(type));
    const roomType = hinted ?? roomTypes[seed % roomTypes.length];
    const blueprint = ROOM_BLUEPRINTS[roomType] ?? ROOM_BLUEPRINTS.living_room;

    const objects: DetectedObject[] = blueprint.map((item, index) => {
      const jitter = (pseudoRandom(seed, index) - 0.5) * 0.02;
      return {
        type: item.type,
        name: item.name,
        bbox: [
          clamp01(item.bbox[0] + jitter),
          clamp01(item.bbox[1] + jitter),
          item.bbox[2],
          item.bbox[3],
        ],
        maskUrl: null,
        depth: item.depth,
        material: item.material,
        color: item.color,
        confidence: 0.78 + pseudoRandom(seed, index + 50) * 0.2,
        dimensions: {
          width: item.dimensions[0],
          height: item.dimensions[1],
          depth: item.dimensions[2],
        },
      };
    });

    return {
      roomType,
      roomDimensions: { width: 5000, length: 6000, height: 2700 },
      objects,
      styleGuess: ["modern", "scandinavian", "warm"][seed % 3],
      lightDirection: [0.4, 0.8, 0.3],
    };
  }
}

// 순환 참조를 피하기 위한 최소 형태 선언
interface VisionProviderShape {
  readonly name: string;
  analyzeRoom(image: ImageRef): Promise<RoomAnalysis>;
}

/* ─────────────────────── Segmentation / Depth ─────────────────────── */

export class MockSegmentationProvider implements SegmentationProvider {
  readonly name = "mock-segmentation";

  constructor(private sceneProvider?: () => Scene | null) {}

  async segment(image: ImageRef): Promise<SegmentationResult> {
    await delay(400);
    const scene = this.sceneProvider?.();
    const svg = scene
      ? renderSegmentationSvg(scene)
      : `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#111"/></svg>`;
    const key = `segmentation/${hash(image.url).toString(36)}.svg`;
    const url = await storeSvg(key, svg);
    return { segmentationUrl: url, masks: [] };
  }
}

export class MockDepthProvider implements DepthProvider {
  readonly name = "mock-depth";

  constructor(private sceneProvider?: () => Scene | null) {}

  async estimateDepth(image: ImageRef): Promise<DepthResult> {
    await delay(400);
    const scene = this.sceneProvider?.();
    const svg = scene
      ? renderDepthMapSvg(scene)
      : `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#333"/></svg>`;
    const key = `depth/${hash(image.url).toString(36)}.svg`;
    const url = await storeSvg(key, svg);
    return { depthMapUrl: url, min: 0, max: 1 };
  }
}

/* ─────────────────────────── Generation ─────────────────────────── */

/** 동일 입력 재요청은 캐시로 응답한다 (48번 요구사항) */
const generationCache = new Map<string, string>();

export function generationHash(params: GenerationParams & { mask?: ImageRef }): string {
  return createHash("sha1")
    .update(
      JSON.stringify({
        image: params.image.url,
        prompt: params.prompt,
        style: params.styleId ?? null,
        seed: params.seed ?? 0,
        mask: params.mask?.url ?? null,
        settings: params.settings ?? null,
      })
    )
    .digest("hex")
    .slice(0, 16);
}

export class MockGenerationProvider implements GenerationProvider {
  readonly name = "mock-generation";

  constructor(private sceneProvider?: () => Scene | null) {}

  private async render(params: GenerationParams, label: string): Promise<GenerationResult> {
    const key = generationHash(params);
    const cachedUrl = generationCache.get(key);
    if (cachedUrl) {
      return { imageUrl: cachedUrl, seed: params.seed ?? 0, provider: this.name, cached: true };
    }

    await delay(1200);

    const scene = this.sceneProvider?.();
    const svg = scene
      ? renderSceneToSvg(scene, { styleId: params.styleId ?? scene.styleId, caption: label })
      : `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="960"><rect width="1280" height="960" fill="#e8e3da"/></svg>`;

    const url = await storeSvg(`generated/${key}.svg`, svg);
    generationCache.set(key, url);

    return { imageUrl: url, seed: params.seed ?? hash(key) % 100000, provider: this.name, cached: false };
  }

  generate(params: GenerationParams): Promise<GenerationResult> {
    return this.render(params, "AI 생성 (mock)");
  }

  inpaint(params: InpaintParams): Promise<GenerationResult> {
    return this.render(params, "AI 인페인팅 (mock)");
  }
}

/* ─────────────────────────── Embedding ─────────────────────────── */

export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly name = "mock-embedding";

  /** 결정적 해시 임베딩. pgvector 도입 전까지 키워드 검색의 보조로만 쓴다. */
  async embed(text: string): Promise<number[]> {
    const digest = createHash("sha256").update(text.toLowerCase()).digest();
    return Array.from({ length: 32 }, (_, i) => (digest[i] - 128) / 128);
  }
}

/* ─────────────────────────── LLM ─────────────────────────── */

export class MockLLMProvider implements LLMProvider {
  readonly name = "mock-llm";

  async chat(messages: ChatMessage[]): Promise<string> {
    const last = messages[messages.length - 1]?.content ?? "";
    return `요청을 확인했습니다: ${last.slice(0, 80)}`;
  }

  /**
   * 규칙 기반 라우터로 tool call을 만든다.
   * 실제 LLM provider로 교체하면 같은 형식의 StructuredCommand[]를 돌려주기만 하면 된다.
   */
  async structuredCommand(input: {
    instruction: string;
    context: unknown;
  }): Promise<StructuredCommand[]> {
    await delay(300);
    return routeCommand(input.instruction, input.context as never);
  }
}

/* ─────────────────────────── Rendering ─────────────────────────── */

export class MockRenderingProvider implements RenderingProvider {
  readonly name = "mock-rendering";

  private async render(scene: Scene, quality: "preview" | "final"): Promise<RenderResult> {
    const started = Date.now();
    await delay(quality === "final" ? 1500 : 500);

    const [w, h] = scene.renderSettings.resolution;
    const scale = quality === "final" ? 1 : 0.6;
    const svg = renderSceneToSvg(scene, {
      width: Math.round(w * scale),
      height: Math.round(h * scale),
      caption: quality === "final" ? "Final render (mock)" : undefined,
    });

    const key = `renders/${scene.sceneId}_${quality}_${Date.now().toString(36)}.svg`;
    const url = await storeSvg(key, svg);

    return { imageUrl: url, quality, durationMs: Date.now() - started, provider: this.name };
  }

  preview(scene: Scene): Promise<RenderResult> {
    return this.render(scene, "preview");
  }

  finalRender(scene: Scene): Promise<RenderResult> {
    return this.render(scene, "final");
  }
}

/* ─────────────────────────── utils ─────────────────────────── */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
