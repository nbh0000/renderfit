import { createHash } from "node:crypto";
import type {
  DepthProvider,
  DepthResult,
  EmbeddingProvider,
  GenerationParams,
  GenerationProvider,
  GenerationResult,
  ImageRef,
  InpaintParams,
  LLMProvider,
  RenderResult,
  RenderingProvider,
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

async function storeSvg(key: string, svg: string): Promise<string> {
  return getStorage().upload(key, svg, "image/svg+xml");
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

