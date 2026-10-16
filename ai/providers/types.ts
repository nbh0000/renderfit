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
  /** 사진인지 2D 도면인지 — 공간 분석 프롬프트가 갈린다 */
  kind?: "photo" | "floorplan";
}

/*
 * ── Vision provider 는 없앴다 ──
 *
 * 그림을 비전 모델에 넣어 좌표 JSON(RoomAnalysis·RoomPlan)을 받던 구조를 폐기했다.
 * 비전 LLM 은 기하를 측정하지 못하고 추측한다 — 방이 빠지고, 면적이 뒤바뀌고, 벽이
 * 끊기고, 설비가 사라졌다.
 *
 * 지금은 기하를 DXF 파서와 전용 벡터화 모델만 만들고(services/plan-ingest), 결과는
 * FloorPlanDoc(packages/plan-schema) 하나로 수렴한다. LLM 은 확정된 기하 위에 실
 * 이름과 설비 종류만 붙인다.
 */

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

/** 3D/2.5D 뷰포트를 캡처한 이미지 — 있으면 이걸 기준으로 실사 변환한다 */
export interface RenderOptions {
  viewportImage?: ImageRef;
  prompt?: string;
}

export interface RenderingProvider {
  readonly name: string;
  preview(scene: Scene, options?: RenderOptions): Promise<RenderResult>;
  finalRender(scene: Scene, options?: RenderOptions): Promise<RenderResult>;
}

/* ── Registry ── */

export interface AIProviders {
  segmentation: SegmentationProvider;
  depth: DepthProvider;
  generation: GenerationProvider;
  embedding: EmbeddingProvider;
  llm: LLMProvider;
  rendering: RenderingProvider;
}
