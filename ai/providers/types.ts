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

/* ── 사진에서 복원한 평면 ── */

/**
 * 사진 한 장에서 읽어 낸 평면도.
 *
 * 예전에는 화면 좌표 bbox와 depthRatio 하나만 받아서 우리가 평면으로 되돌렸는데,
 * 그 역투영이 원리적으로 불가능했다 — 카메라에서 멀어지며 늘어선 유리 칸막이벽은
 * 사진 속 폭이 실제 길이와 아무 상관이 없고, 깊이 하나로는 깊게 뻗은 물체를 못 담는다.
 * 그래서 모델에게 처음부터 "도면 좌표(mm)"로 답하게 한다.
 *
 * 좌표: 원점은 방의 좌측 하단, x는 오른쪽(+), y는 안쪽(+), 단위는 mm.
 */
export interface PlanPoint {
  x: number;
  y: number;
}

export interface PlanOpening {
  kind: "door" | "window" | "glass-partition" | "opening";
  name: string;
  /** 벽 시작점에서 개구부 왼쪽 끝까지 (mm) */
  offsetMm: number;
  widthMm: number;
  heightMm: number;
  /** 바닥에서 개구부 아래쪽까지 (mm) */
  sillMm: number;
}

/**
 * 벽 한 장.
 *
 * 예전에는 외곽선의 변과 1:1이라 방을 하나밖에 못 그렸다. 아파트를 담으려면
 * 거실과 방 사이를 가르는 내벽이 있어야 하므로, 벽을 외곽선에서 떼어 내
 * 좌표를 직접 갖는 선분으로 둔다.
 */
export interface PlanWall {
  name: string;
  start: PlanPoint;
  end: PlanPoint;
  thicknessMm: number;
  openings: PlanOpening[];
}

/** 실(방) 하나 — 이름과 경계 폴리곤 */
export interface PlanRoom {
  name: string;
  type: string;
  polygon: PlanPoint[];
  /**
   * 도면에 글자로 적혀 있던 면적 (㎡).
   *
   * 폴리곤에서 계산한 면적과 다를 수 있다 — 모델은 글자는 잘 읽지만 선 길이는 자주 틀린다.
   * 그래서 이 값을 폴리곤을 되맞추는 기준으로 쓴다. 도면에 없으면 null.
   */
  areaSqm?: number | null;
}

export interface PlanFurniture {
  type: SceneObject["type"];
  name: string;
  /** 평면상의 중심 (mm) */
  xMm: number;
  yMm: number;
  /** 0도는 정면이 카메라 쪽(y가 작아지는 방향)을 보는 상태 — placement의 ROTATION_BY_SIDE와 같은 규칙 */
  rotationDeg: number;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  /** 바닥에서 물체 아래쪽까지 (mm) — 천장등·벽걸이의 높이 */
  elevationMm: number;
  mountedOn: "floor" | "wall" | "ceiling";
  material: string | null;
  color: string | null;
}

export interface RoomPlan {
  roomType: string;
  ceilingHeightMm: number;
  /** 사진에서 읽은 바닥·벽·천장 마감 (한국어 한 마디). 카탈로그 재질로 옮겨 붙인다 */
  finishes?: { floor: string | null; wall: string | null; ceiling: string | null };
  /** 사진을 찍은 카메라가 등지고 있는 벽 번호 — 0이어야 도면 방향이 사진과 맞는다 */
  cameraWallIndex: number;
  /** 전체 바닥 외곽선 (반시계). 방 여러 개를 통틀어 감싸는 경계다 */
  outline: PlanPoint[];
  /** 실 목록. 원룸이면 하나, 아파트면 거실·방·주방·욕실이 각각 들어온다 */
  rooms: PlanRoom[];
  /** 외벽과 내벽을 통틀어. 좌표를 직접 갖는 선분이다 */
  walls: PlanWall[];
  furniture: PlanFurniture[];
}

export interface RoomAnalysis {
  roomType: string;
  /** mm */
  roomDimensions: { width: number; length: number; height: number };
  objects: DetectedObject[];
  styleGuess: string | null;
  /** 조명 방향 추정 */
  lightDirection: [number, number, number];
  /** 사진에서 복원한 평면. 있으면 이 값으로 방을 세운다 (없으면 objects로 물러난다) */
  plan?: RoomPlan | null;
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
  vision: VisionProvider;
  segmentation: SegmentationProvider;
  depth: DepthProvider;
  generation: GenerationProvider;
  embedding: EmbeddingProvider;
  llm: LLMProvider;
  rendering: RenderingProvider;
}
