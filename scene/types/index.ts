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
  /** 속한 층. 없으면 기준층 */
  levelId?: string;
  category: string;
  transform: Transform;
  dimensions: Dimensions;
  /** 2.5D 캔버스 배치 */
  screen: ScreenRect;
  assetId: string | null;
  /** 외부 3D 모델(glTF/GLB) URL — 없으면 primitive로 그린다 */
  modelUrl?: string | null;
  /**
   * AI가 만들어 낸 가구 이미지.
   *
   * 메시가 없는 가구를 3D에 세울 때 쓴다 — 흰 배경을 지운 실루엣을 판으로 세운다.
   * modelUrl(진짜 메시)이 있으면 그쪽이 우선이다.
   */
  imageUrl?: string | null;
  /** CC-BY 등 저작자 표시가 필요한 모델의 표기 문구 */
  attribution?: string | null;
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

/**
 * 층.
 *
 * 복층·다락처럼 위아래로 겹치는 공간을 다루려면 벽과 실이 "몇 층의 것인지" 알아야 한다.
 * 평면도는 한 층만 진하게 그리고 아래층을 옅게 비춰 주며, 3D는 높이만큼 쌓아 올린다.
 *
 * elevation은 바닥 레벨(mm)이고, height는 그 층의 천장고다.
 * 기존 데이터에는 층이 없으므로, levelId가 없는 요소는 모두 기준층에 속한 것으로 본다.
 */
export interface Level {
  id: string;
  name: string;
  /** 기준면에서 이 층 바닥까지 (mm) */
  elevation: number;
  /** 이 층의 천장고 (mm) */
  height: number;
  /** 평면도·3D에서 감출지 */
  visible?: boolean;
}

/** 문 종류 — 평면도 기호가 달라진다 */
export type DoorType = "hinged" | "sliding" | "folding" | "opening";

/** 경첩이 벽의 어느 쪽에 달리는지 (벽 start 기준) */
export type DoorHinge = "start" | "end";

/** 문이 열리는 쪽 — 평면상 벽 법선 기준으로 안/밖 */
export type DoorSwing = "in" | "out";

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
  /** 문일 때만 의미가 있다. 없으면 여닫이·start 경첩·안쪽 열림으로 본다 */
  doorType?: DoorType;
  hinge?: DoorHinge;
  swing?: DoorSwing;
}

/**
 * 전기·통신 설비.
 *
 * 도면에서 시공자가 가장 먼저 확인하는 값이라 위치(어느 벽, 얼마 떨어져)와
 * 바닥에서의 높이를 함께 들고 있어야 한다.
 */
export type ElectricalKind =
  | "outlet"
  | "outlet-aircon"
  | "switch"
  | "switch-3way"
  | "ceiling-light"
  | "wall-light"
  | "data"
  | "tv-jack"
  | "panel";

export interface ElectricalFixture {
  id: string;
  name: string;
  kind: ElectricalKind;
  /** 속한 층. 없으면 기준층 */
  levelId?: string;
  /** 벽에 붙는 설비의 벽 id. 천장 조명처럼 벽이 없으면 null */
  wallId: string | null;
  /** 벽 시작점에서의 거리 (mm). wallId가 있을 때 쓴다 */
  offset: number;
  /** wallId가 null일 때 쓰는 평면 좌표 (mm) */
  point?: [number, number];
  /** 바닥에서의 설치 높이 (mm) */
  height: number;
  /** 회로·용량 등 도면 주기 */
  note?: string;
}

/** 벽 한 장 — 평면상의 선분 + 두께/높이 + 개구부 */
export interface WallSegment {
  id: string;
  name: string;
  /** 속한 층. 없으면 기준층 */
  levelId?: string;
  /** 평면 좌표 (mm), 방 좌측 하단이 원점 */
  start: [number, number];
  end: [number, number];
  /** mm */
  thickness: number;
  height: number;
  openings: WallOpening[];
}

/**
 * 도면 주석.
 *
 * 치수선·텍스트·폴리라인은 벽이나 가구가 아니라 "도면에만 존재하는 표기"다.
 * 시공 도면에서 실제로 필요한 세 가지라 Scene에 함께 저장한다.
 * 좌표는 벽과 같은 평면 좌표(mm, 방 좌측 하단이 원점)를 쓴다.
 */
export type AnnotationType = "dimension" | "text" | "polyline";

export interface Annotation {
  id: string;
  type: AnnotationType;
  /** 속한 층. 없으면 기준층 */
  levelId?: string;
  /** 치수선은 두 점, 텍스트는 한 점, 폴리라인은 두 점 이상 */
  points: [number, number][];
  /** 텍스트 내용. 치수선은 비우면 실제 길이를 자동으로 쓴다 */
  text?: string;
  /** 치수선을 선에서 얼마나 띄울지 (mm, 음수면 반대쪽) */
  offset?: number;
  /** 글자 크기 (mm 기준 도면 좌표) */
  fontSize?: number;
  /** 폴리라인 두께 (mm) */
  thickness?: number;
  /** 점선 여부 */
  dashed?: boolean;
}

/**
 * 실(방) 영역.
 *
 * 벽은 "구조"를, 실은 "쓰임"을 나타낸다. 거실·주방·방1처럼 이름과 면적이 붙는 단위라
 * 평면도에 실명과 면적을 적고 바닥재를 따로 주려면 폴리곤으로 따로 들고 있어야 한다.
 * 좌표는 벽과 같은 평면 좌표(mm, 좌측 하단 원점)를 쓴다.
 */
export interface RoomArea {
  id: string;
  name: string;
  /** 속한 층. 없으면 기준층 */
  levelId?: string;
  /** 실 경계 폴리곤. 시계/반시계 어느 쪽이든 면적은 절댓값으로 센다 */
  points: [number, number][];
  /** 바닥 마감 (materials의 id 또는 자유 표기) */
  floorMaterialId?: string | null;
  /** 평면도에서 실을 칠하는 색 */
  color?: string;
  /** 평면도에 면적을 적을지 */
  showArea?: boolean;
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
  /** 전기·통신 설비 배치 */
  electrical?: ElectricalFixture[];
  /** 치수선·텍스트·폴리라인 등 도면 주석 */
  annotations?: Annotation[];
  /** 실(방) 영역 — 거실·주방처럼 이름과 면적이 붙는 단위 */
  areas?: RoomArea[];
  /** 층 목록. 비어 있으면 기준층 하나만 있는 것으로 본다 */
  levels?: Level[];
  /**
   * 면 마감재 (바닥·벽·천장).
   *
   * 예전에는 Scene에 담긴 재질 중 "floor" 태그가 붙은 것을 아무거나 골라 썼다.
   * 그래서 벽지를 바꾸면 바닥이 같이 바뀌기도 했다. 어느 면에 무엇을 발랐는지
   * 여기에 분명히 적어 둔다.
   */
  finishes?: { floor?: string | null; wall?: string | null; ceiling?: string | null };
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
  /** AO·거칠기·금속감이 한 장에 든 맵 (R=AO, G=roughness, B=metallic) */
  armMapUrl?: string | null;
  /** 텍스처 반복 스케일 */
  scale: number;
  tags: string[];
}

export interface RenderSettings {
  resolution: [number, number];
  quality: "preview" | "final";
}

/** 올린 원본이 무엇인지 — 분석 방식이 달라진다 */
export type SourceKind = "photo" | "floorplan";

/** 업로드 원본 + AI 분석 산출물 */
export interface SceneSource {
  imageUrl: string | null;
  /**
   * 사진인지 도면인지.
   *
   * 공간 분석 프롬프트가 완전히 달라진다 — 사진은 원근에서 치수를 역산해야 하지만
   * 도면은 벽 선과 치수가 이미 그려져 있어 그대로 읽으면 된다. 없으면 사진으로 본다.
   */
  kind?: SourceKind;
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
