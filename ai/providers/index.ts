import type { Scene } from "@/scene/types";
import type {
  AIProviders,
  ChatMessage,
  GenerationParams,
  GenerationProvider,
  GenerationResult,
  InpaintParams,
  LLMProvider,
  StructuredCommand,
  ToolDefinition,
} from "./types";
import {
  MockDepthProvider,
  MockEmbeddingProvider,
  MockGenerationProvider,
  MockLLMProvider,
  MockRenderingProvider,
  MockSegmentationProvider,
  MockVisionProvider,
  generationHash,
} from "./mock";
import { getStorage } from "@/lib/storage";
import { generateImages, isMockMode } from "@/lib/image-api";
import { TOOL_DEFINITIONS } from "@/ai/tools";
import { GeminiRenderingProvider } from "./rendering";
import { GeminiVisionProvider } from "./vision";
import { routeCommand } from "@/ai/router";

/**
 * Provider 팩토리.
 *
 * 환경변수로 provider를 고르고, key가 없으면 자동으로 Mock으로 폴백한다.
 * 앱은 어떤 경우에도 실행 가능해야 한다.
 */

export interface ProviderContext {
  /** 현재 편집 중인 Scene을 mock provider에 넘겨 결과가 Scene을 반영하도록 한다 */
  getScene?: () => Scene | null;
}

/* ───────────────────── 실제 이미지 생성 (Gemini) ───────────────────── */

async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    if (url.startsWith("data:")) {
      const match = /^data:([^;]+);base64,(.+)$/.exec(url);
      return match ? { mimeType: match[1], data: match[2] } : null;
    }

    if (url.startsWith("/")) {
      // 로컬 스토리지 경로 (/api/files/...) 는 직접 읽는다.
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
  if (url.endsWith(".svg")) return "image/svg+xml";
  return "image/jpeg";
}

const realGenerationCache = new Map<string, string>();

/** Gemini 이미지 편집 API 기반 생성 provider */
export class GeminiGenerationProvider implements GenerationProvider {
  readonly name = "gemini";

  private async run(params: GenerationParams & { mask?: { url: string } }): Promise<GenerationResult> {
    const key = generationHash(params as GenerationParams);
    const cached = realGenerationCache.get(key);
    if (cached) return { imageUrl: cached, seed: params.seed ?? 0, provider: this.name, cached: true };

    const image = await fetchAsBase64(params.image.url);
    if (!image) throw new Error("원본 이미지를 불러오지 못했습니다.");

    const mask = params.mask ? await fetchAsBase64(params.mask.url) : null;
    const reference = params.referenceImage
      ? await fetchAsBase64(params.referenceImage.url)
      : null;

    const [result] = await generateImages({
      prompt: params.prompt,
      image,
      mask: mask ?? undefined,
      reference: reference ?? undefined,
      count: 1,
      size: params.size ?? 1024,
    });

    const extension = result.mimeType.includes("svg") ? "svg" : "png";
    const url = await getStorage().upload(
      `generated/${key}.${extension}`,
      result.data,
      result.mimeType
    );
    realGenerationCache.set(key, url);

    return { imageUrl: url, seed: params.seed ?? 0, provider: this.name, cached: false };
  }

  generate(params: GenerationParams): Promise<GenerationResult> {
    return this.run(params);
  }

  inpaint(params: InpaintParams): Promise<GenerationResult> {
    return this.run({ ...params, mask: params.mask });
  }
}

/* ───────────────────── 실제 LLM (Anthropic Messages API) ───────────────────── */

/**
 * Anthropic Messages API를 fetch로 직접 호출한다 (SDK 의존성 없음).
 * ANTHROPIC_API_KEY가 있을 때만 팩토리가 이 provider를 선택한다.
 */
export class AnthropicLLMProvider implements LLMProvider {
  readonly name = "anthropic";

  constructor(
    private apiKey: string,
    private model = process.env.LLM_MODEL || "claude-sonnet-5"
  ) {}

  private async call(body: Record<string, unknown>): Promise<{
    content: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[];
  }> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: this.model, max_tokens: 1024, ...body }),
    });

    if (!response.ok) {
      throw new Error(`LLM 호출 실패 (${response.status})`);
    }
    return response.json();
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    const system = messages.find((m) => m.role === "system")?.content;
    const rest = messages.filter((m) => m.role !== "system");
    const data = await this.call({
      system,
      messages: rest.map((m) => ({ role: m.role, content: m.content })),
    });
    return data.content.find((part) => part.type === "text")?.text ?? "";
  }

  async structuredCommand(input: {
    instruction: string;
    tools: ToolDefinition[];
    context: unknown;
  }): Promise<StructuredCommand[]> {
    try {
      const data = await this.call({
        system:
          "너는 인테리어 편집기의 명령 라우터다. 사용자의 자연어 요청을 제공된 tool 호출로만 변환한다. " +
          "Scene JSON을 직접 수정하지 말고, 반드시 tool을 사용한다. 대상 객체는 context.objects의 id로 지정한다.",
        tools: input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: {
            type: "object",
            properties: Object.fromEntries(
              Object.entries(tool.parameters).map(([key]) => [key, { type: "string" }])
            ),
          },
        })),
        messages: [
          {
            role: "user",
            content: `현재 장면: ${JSON.stringify(input.context)}\n\n사용자 요청: ${input.instruction}`,
          },
        ],
      });

      const commands = data.content
        .filter((part) => part.type === "tool_use" && part.name)
        .map((part) => ({
          tool: part.name!,
          arguments: (part.input ?? {}) as Record<string, unknown>,
          explanation: "",
          confidence: 0.9,
        }));

      // LLM이 tool을 고르지 못하면 규칙 기반 라우터로 폴백한다.
      return commands.length > 0 ? commands : routeCommand(input.instruction, input.context as never);
    } catch {
      return routeCommand(input.instruction, input.context as never);
    }
  }
}

/* ─────────────────────────── 팩토리 ─────────────────────────── */

export function createProviders(context: ProviderContext = {}): AIProviders {
  const getScene = context.getScene ?? (() => null);

  const generation: GenerationProvider =
    !isMockMode() && (process.env.GENERATION_PROVIDER ?? "gemini") !== "mock"
      ? new GeminiGenerationProvider()
      : new MockGenerationProvider(getScene);

  const llm: LLMProvider = process.env.ANTHROPIC_API_KEY
    ? new AnthropicLLMProvider(process.env.ANTHROPIC_API_KEY)
    : new MockLLMProvider();

  const mockRendering = new MockRenderingProvider();
  // 생성 모델이 붙어 있으면 3D 뷰포트 캡처를 실사 사진으로 변환한다.
  const rendering = generation.name === "mock-generation"
    ? mockRendering
    : new GeminiRenderingProvider(generation, mockRendering);

  return {
    /*
     * 공간 분석은 실제 모델을 쓴다 — 사진에서 방 크기와 창·문·가구를 읽어야
     * 평면도·측면도·3D가 그 사진의 방을 그린다. 키가 없으면 mock으로 물러난다.
     */
    vision: isMockMode() ? new MockVisionProvider() : new GeminiVisionProvider(new MockVisionProvider()),
    segmentation: new MockSegmentationProvider(getScene),
    depth: new MockDepthProvider(getScene),
    generation,
    embedding: new MockEmbeddingProvider(),
    llm,
    rendering,
  };
}

/** 현재 어떤 provider가 붙어 있는지 (UI 배지/디버깅용) */
export function providerStatus(): Record<string, string> {
  const providers = createProviders();
  return {
    vision: providers.vision.name,
    segmentation: providers.segmentation.name,
    depth: providers.depth.name,
    generation: providers.generation.name,
    embedding: providers.embedding.name,
    llm: providers.llm.name,
    rendering: providers.rendering.name,
    storage: getStorage().name,
  };
}

export const AGENT_TOOLS = TOOL_DEFINITIONS;
