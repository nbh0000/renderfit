/**
 * Scene 데이터 모델.
 *
 * 이 프로젝트의 결과물은 "이미지 한 장"이 아니라 편집 가능한 Scene이다.
 * Image + Segmentation + Depth + Objects + Transforms + Materials + Assets + Camera + Lighting
 * 을 하나의 Scene Graph로 들고 있으며, 2.5D에서 3D로 확장할 수 있도록 단위를 통일한다.
 *
 * 단위 규칙
 *  - dimensions: mm (밀리미터, 정수)
 *  - transform.position: m (미터, 월드 좌표)
 *  - transform.rotation: degree
 *  - screen(2.5D) 좌표: 0~1 정규화 (이미지 크기와 무관하게 유지)
 */

export type Vec3 = [number, number, number];

export type ObjectType =
  | "wall"
  | "floor"
  | "ceiling"
  | "window"
  | "door"
  | "sofa"
  | "chair"
  | "table"
  | "cabinet"
  | "bed"
  | "lamp"
  | "plant"
  | "rug"
  | "tv"
  | "appliance"
  | "decoration"
  | "custom";

/** Scene Graph 상의 큰 분류 (Layers 패널 그룹) */
export type ObjectGroup = "room" | "furniture" | "lighting" | "decoration" | "appliance";

export const OBJECT_GROUP_OF: Record<ObjectType, ObjectGroup> = {
  wall: "room",
  floor: "room",
  ceiling: "room",
  window: "room",
  door: "room",
  sofa: "furniture",
  chair: "furniture",
  table: "furniture",
  cabinet: "furniture",
  bed: "furniture",
  lamp: "lighting",
  plant: "decoration",
  rug: "decoration",
  tv: "appliance",
  appliance: "appliance",
  decoration: "decoration",
  custom: "furniture",
};

export interface Transform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface Dimensions {
  /** mm */
  width: number;
  height: number;
  depth: number;
}

/** 2.5D 편집용 화면 배치 정보 (0~1 정규화) */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** degree, 화면 평면 기준 회전 */
  rotation: number;
}

export interface ObjectMask {
  /** 마스크 이미지 URL (흑백 PNG) 또는 data URL */
  url?: string;
  /** 폴리곤 근사 (0~1 정규화 좌표) — 렌더/히트테스트 fallback */
  polygon?: [number, number][];
}

export interface SceneObject {
  id: string;
  name: string;
  type: ObjectType;
  category: string;
  transform: Transform;
  dimensions: Dimensions;
  /** 2.5D 캔버스 배치 */
  screen: ScreenRect;
  assetId: string | null;
  materialId: string | null;
  visibility: boolean;
  locked: boolean;
  mask: ObjectMask | null;
  /** 0(가까움)~1(멈) 정규화 깊이 — depth map 평균값 */
  depth: number;
  /** vision 모델 신뢰도 0~1 */
  confidence: number;
  source: "vision_model" | "user" | "ai_command" | "seed";
  /** 레이어 정렬 순서 (클수록 앞) */
  order: number;
  metadata: Record<string, unknown>;
}

/** 문·창 등 벽에 뚫리는 개구부 */
export interface WallOpening {
  id: string;
  name: string;
  type: "door" | "window";
  /** 벽 시작점에서 개구부 좌측까지의 거리 (mm) */
  offset: number;
  /** mm */
  width: number;
  height: number;
  /** 바닥에서 개구부 하단까지 (문은 0, 창은 보통 900) */
  sillHeight: number;
}

/** 벽 한 장 — 평면상의 선분 + 두께/높이 + 개구부 */
export interface WallSegment {
  id: string;
  name: string;
  /** 평면 좌표 (mm), 방 좌측 하단이 원점 */
  start: [number, number];
  end: [number, number];
  /** mm */
  thickness: number;
  height: number;
  openings: WallOpening[];
}

export interface RoomSpec {
  type: string;
  /** mm */
  dimensions: { width: number; length: number; height: number };
  /** 벽 배치. 없으면 dimensions로부터 직사각형을 만든다 */
  walls?: WallSegment[];
  /** 사용자가 실측값으로 확정했는지 — 도면 고지 문구가 달라진다 */
  measured?: boolean;
  /** 실측 메모 (측정일·측정자 등) */
  measuredNote?: string;
}

export interface CameraSpec {
  position: Vec3;
  rotation: Vec3;
  fov: number;
  near: number;
  far: number;
  projection: "perspective" | "orthographic";
}

export type LightType = "ambient" | "directional" | "point" | "spot" | "area";

export interface SceneLight {
  id: string;
  name: string;
  type: LightType;
  intensity: number;
  /** hex */
  color: string;
  /** Kelvin */
  temperature: number;
  position: Vec3;
  rotation: Vec3;
  enabled: boolean;
}

export interface Material {
  id: string;
  name: string;
  /** hex */
  baseColor: string;
  roughness: number;
  metallic: number;
  normalMapUrl?: string | null;
  heightMapUrl?: string | null;
  textureUrl?: string | null;
  /** 텍스처 반복 스케일 */
  scale: number;
  tags: string[];
}

export interface RenderSettings {
  resolution: [number, number];
  quality: "preview" | "final";
}

/** 업로드 원본 + AI 분석 산출물 */
export interface SceneSource {
  imageUrl: string | null;
  generatedImageUrl: string | null;
  depthMapUrl: string | null;
  segmentationUrl: string | null;
  width: number;
  height: number;
}

export interface Scene {
  sceneId: string;
  version: number;
  room: RoomSpec;
  camera: CameraSpec;
  source: SceneSource;
  objects: SceneObject[];
  materials: Material[];
  lights: SceneLight[];
  renderSettings: RenderSettings;
  /** 스타일 프리셋 id */
  styleId: string | null;
  updatedAt: string;
}

/* ─────────────────────────── Operations ─────────────────────────── */

export type OperationType =
  | "MOVE_OBJECT"
  | "ROTATE_OBJECT"
  | "SCALE_OBJECT"
  | "DELETE_OBJECT"
  | "ADD_OBJECT"
  | "REPLACE_OBJECT"
  | "DUPLICATE_OBJECT"
  | "CHANGE_MATERIAL"
  | "CHANGE_COLOR"
  | "CHANGE_LIGHT"
  | "CHANGE_VISIBILITY"
  | "CHANGE_LOCK"
  | "RENAME_OBJECT"
  | "REORDER_OBJECT"
  | "CHANGE_CAMERA"
  | "CHANGE_ROOM"
  /** 방 치수 변경 + 밖으로 밀려난 객체 보정을 한 번에 (undo 한 번으로 되돌아가도록) */
  | "RESIZE_ROOM"
  | "CHANGE_DIMENSIONS"
  | "AI_GENERATE"
  | "AI_INPAINT";

/**
 * 모든 변경은 operation으로 기록한다.
 * before/after는 해당 operation을 되돌리거나 다시 적용하기에 충분한 최소 정보만 담는다.
 */
export interface SceneOperation {
  id: string;
  type: OperationType;
  objectId?: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  label: string;
  createdAt: string;
}

export interface SceneVersion {
  id: string;
  version: number;
  label: string;
  createdAt: string;
  scene: Scene;
}

/* ─────────────────────────── Assets ─────────────────────────── */

export interface Asset {
  id: string;
  name: string;
  category: string;
  type: ObjectType;
  style: string[];
  dimensions: Dimensions;
  thumbnailUrl: string | null;
  modelUrl: string | null;
  /** 3D 모델이 없을 때 사용할 primitive */
  primitive: "box" | "cylinder" | "sphere" | "plane";
  materials: string[];
  tags: string[];
  /** pgvector 확장 대비. 현재는 키워드 검색 fallback */
  embedding: number[] | null;
}

/* ─────────────────────────── Project ─────────────────────────── */

export type ProjectStatus = "draft" | "analyzing" | "generating" | "ready";

export interface DesignProject {
  id: string;
  ownerId: string | null;
  name: string;
  status: ProjectStatus;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
  scene: Scene;
  operations: SceneOperation[];
  /** undo로 되돌려 둔 operation (redo 대상) */
  redoStack: SceneOperation[];
  versions: SceneVersion[];
}
