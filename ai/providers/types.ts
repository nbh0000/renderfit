import type { Scene, SceneObject } from "@/scene/types";

/**
 * AI Provider 추상화.
 *
 * 모든 AI 기능은 이 인터페이스를 통해서만 호출한다. 특정 모델/벤더에 종속되지 않으며,
 * API key가 없으면 Mock provider가 같은 인터페이스로 동작해 앱 전체가 살아 있다.
 */

export interface ImageRef {
  /** 공개 URL 또는 data URL */
  url: string;
  width?: number;
  height?: number;
}

/* ── Vision ── */

export interface DetectedObject {
  type: SceneObject["type"];
  name: string;
  /** 0~1 정규화 [x, y, width, height] */
  bbox: [number, number, number, number];
  maskUrl: string | null;
  depth: number;
  material: string | null;
  color: string | null;
  confidence: number;
  /** mm 추정 치수 */
  dimensions?: { width: number; height: number; depth: number };
}

export interface RoomAnalysis {
  roomType: string;
  /** mm */
  roomDimensions: { width: number; length: number; height: number };
  objects: DetectedObject[];
  styleGuess: string | null;
  /** 조명 방향 추정 */
  lightDirection: [number, number, number];
}

export interface VisionProvider {
  readonly name: string;
  analyzeRoom(image: ImageRef): Promise<RoomAnalysis>;
}

/* ── Segmentation ── */

export interface SegmentationResult {
  /** 전체 세그멘테이션 맵 URL */
  segmentationUrl: string;
  masks: { label: string; maskUrl: string; bbox: [number, number, number, number] }[];
}

export interface SegmentationProvider {
  readonly name: string;
  segment(image: ImageRef, hints?: { labels?: string[] }): Promise<SegmentationResult>;
}

/* ── Depth ── */

export interface DepthResult {
  depthMapUrl: string;
  /** 0(가까움)~1(멈) */
  min: number;
  max: number;
}

export interface DepthProvider {
  readonly name: string;
  estimateDepth(image: ImageRef): Promise<DepthResult>;
}

/* ── Generation ── */

export interface GenerationParams {
  image: ImageRef;
  prompt: string;
  /** ControlNet 계열 조건 입력 */
  depthMap?: ImageRef | null;
  segmentation?: ImageRef | null;
  referenceImage?: ImageRef | null;
  styleId?: string | null;
  seed?: number;
  size?: number;
  /** 캐시 키 계산에 포함되는 추가 설정 */
  settings?: Record<string, unknown>;
}

export interface InpaintParams extends GenerationParams {
  /** 편집 대상 영역 (흰색=편집) */
  mask: ImageRef;
}

export interface GenerationResult {
  imageUrl: string;
  seed: number;
  provider: string;
  /** 동일 입력 재요청 시 캐시 히트 여부 */
  cached: boolean;
}

export interface GenerationProvider {
  readonly name: string;
  generate(params: GenerationParams): Promise<GenerationResult>;
  inpaint(params: InpaintParams): Promise<GenerationResult>;
}

/* ── Embedding ── */

export interface EmbeddingProvider {
  readonly name: string;
  embed(text: string): Promise<number[]>;
}

/* ── LLM ── */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface StructuredCommand {
  tool: string;
  arguments: Record<string, unknown>;
  /** 사용자에게 보여줄 설명 */
  explanation: string;
  confidence: number;
}

export interface LLMProvider {
  readonly name: string;
  chat(messages: ChatMessage[]): Promise<string>;
  /** 자연어 명령 → 실행 가능한 tool call 목록 */
  structuredCommand(input: {
    instruction: string;
    tools: ToolDefinition[];
    context: unknown;
  }): Promise<StructuredCommand[]>;
}

/* ── Rendering ── */

export interface RenderResult {
  imageUrl: string;
  quality: "preview" | "final";
  durationMs: number;
  provider: string;
}

export interface RenderingProvider {
  readonly name: string;
  preview(scene: Scene): Promise<RenderResult>;
  finalRender(scene: Scene): Promise<RenderResult>;
}

/* ── Registry ── */

export interface AIProviders {
  vision: VisionProvider;
  segmentation: SegmentationProvider;
  depth: DepthProvider;
  generation: GenerationProvider;
  embedding: EmbeddingProvider;
  llm: LLMProvider;
  rendering: RenderingProvider;
}
