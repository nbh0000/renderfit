import type {
  DetectedObject,
  ImageRef,
  PlanFurniture,
  PlanOpening,
  PlanPoint,
  PlanRoom,
  PlanWall,
  RoomAnalysis,
  VisionProvider,
} from "./types";
import type { SceneObject } from "@/scene/types";
import { ROOMS, ROOM_MAP, type RoomId } from "@/config/rooms";

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

/**
 * 방 종류는 반드시 우리 id 중 하나여야 한다.
 *
 * 자유 문자열로 두면 모델이 "livingroom"처럼 우리 목록에 없는 값을 돌려주고,
 * 그러면 도면의 실명이 "실"로 떨어지고 타이틀블록에 영문 id가 그대로 찍힌다.
 */
const ROOM_IDS: RoomId[] = ROOMS.map((room) => room.id);

/* ───────────────────── 평면 복원 (도면 좌표로 직접 받는다) ───────────────────── */

const POINT = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" } },
  required: ["x", "y"],
} as const;

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    roomType: { type: "string", enum: ROOM_IDS },
    ceilingHeightMm: { type: "number" },
    cameraWallIndex: { type: "number" },
    styleGuess: { type: "string" },
    lightFrom: { type: "string", enum: ["left", "right", "front", "back", "top"] },
    /*
     * 배치보다 먼저 오는 목록.
     * 구조화 출력은 필드 순서대로 생성되므로, 세는 칸을 앞에 두면 모델이
     * "세고 나서 배치"하게 된다. 이 한 칸으로 검출 수가 눈에 띄게 올라간다.
     */
    inventory: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          type: { type: "string", enum: OBJECT_TYPES },
          count: { type: "number" },
          where: { type: "string" },
        },
        required: ["label", "type", "count", "where"],
      },
    },
    /** 바닥·벽·천장에 실제로 무엇이 발려 있는지 (한국어 한 마디) */
    finishes: {
      type: "object",
      properties: {
        floor: { type: "string" },
        wall: { type: "string" },
        ceiling: { type: "string" },
      },
      required: ["floor", "wall", "ceiling"],
    },
    outline: { type: "array", items: POINT },
    /** 실 목록 — 원룸이면 하나, 아파트면 거실·방·주방·욕실이 각각 */
    rooms: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: ROOM_IDS },
          polygon: { type: "array", items: POINT },
        },
        required: ["name", "type", "polygon"],
      },
    },
    walls: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          start: POINT,
          end: POINT,
          thicknessMm: { type: "number" },
          openings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["door", "window", "glass-partition", "opening"] },
                name: { type: "string" },
                offsetMm: { type: "number" },
                widthMm: { type: "number" },
                heightMm: { type: "number" },
                sillMm: { type: "number" },
              },
              required: ["kind", "name", "offsetMm", "widthMm", "heightMm", "sillMm"],
            },
          },
        },
        required: ["name", "start", "end", "thicknessMm", "openings"],
      },
    },
    furniture: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: OBJECT_TYPES },
          name: { type: "string" },
          xMm: { type: "number" },
          yMm: { type: "number" },
          rotationDeg: { type: "number" },
          widthMm: { type: "number" },
          depthMm: { type: "number" },
          heightMm: { type: "number" },
          elevationMm: { type: "number" },
          mountedOn: { type: "string", enum: ["floor", "wall", "ceiling"] },
          material: { type: "string" },
          color: { type: "string" },
        },
        required: [
          "type",
          "name",
          "xMm",
          "yMm",
          "rotationDeg",
          "widthMm",
          "depthMm",
          "heightMm",
          "elevationMm",
          "mountedOn",
        ],
      },
    },
  },
  required: [
    "roomType",
    "ceilingHeightMm",
    "cameraWallIndex",
    "inventory",
    "finishes",
    "outline",
    "rooms",
    "walls",
    "furniture",
  ],
} as const;

const PLAN_PROMPT = [
  "이 실내 사진 한 장을 보고 이 공간의 평면도를 복원한다. 결과는 도면 좌표(mm)로만 답한다.",
  "",
  "■ 1단계 — 먼저 센다 (inventory)",
  "배치를 정하기 전에, 사진에 보이는 것을 종류별로 빠짐없이 센다.",
  "- 화면을 왼쪽에서 오른쪽으로, 가까운 것에서 먼 것으로 훑으며 하나씩 센다.",
  "- 일부만 보이거나 다른 물건에 가려진 것도 센다. 화면 가장자리에 걸친 것도 센다.",
  "- 같은 것이 여러 개면 반드시 그 개수만큼 센다. 뭉뚱그리지 않는다.",
  "- 식당·카페라면 테이블 수와 테이블당 의자 수를 각각 세어 곱한다.",
  "- where에는 어디에 있는지 짧게 적는다 (예: 왼쪽 벽 앞, 중앙, 출입문 옆).",
  "",
  "■ 2단계 — 평면을 세운다",
  "좌표계",
  "- 원점(0,0)은 방의 좌측 하단. x는 오른쪽(+), y는 안쪽(+). 단위는 mm, 정수.",
  "- outline: 바닥 외곽선 꼭짓점을 반시계 방향으로. 직사각형이면 4점, 꺾인 방이면 그 모양대로.",
  "- 카메라가 등지고 있는 벽이 반드시 첫 번째 변이 되게 한다 —",
  "  즉 outline[0]=(0,0), outline[1]=(가로,0)이고 cameraWallIndex는 0이다.",
  "  이렇게 해야 도면의 위쪽이 사진의 안쪽과 맞는다.",
  "- rooms: 공간을 실 단위로 나눈다. 원룸·방 한 칸이면 하나, 아파트면 거실·방·주방·욕실을",
  "  각각 폴리곤으로 준다. 실 이름은 도면에 그대로 찍히므로 한국어로 쓴다.",
  "- ★ 실명은 표준 한국어 실명으로 적는다: 거실, 안방, 침실, 주방, 욕실, 화장실, 현관,",
  "  발코니, 드레스룸, 다용도실, 서재, 팬트리. 같은 종류가 여럿이면 뒤에 번호를 붙인다(침실1).",
  "  도면 글자가 흐리거나 오타로 보이면(욧실, 침틸, 발로니) 가장 가까운 표준 실명으로 고쳐 적는다 —",
  "  도면에 잘못된 글자를 그대로 옮기면 산출물이 그대로 잘못된 도면이 된다.",
  "- walls: 외벽과 내벽을 통틀어 선분 목록으로 준다. 각 벽은 start·end 좌표를 직접 갖는다.",
  "  방과 방 사이를 가르는 내벽을 빠뜨리지 않는다 — 이게 없으면 아파트가 원룸으로 그려진다.",
  "- 개구부 offsetMm은 그 벽의 start에서 개구부 왼쪽 끝까지의 거리.",
  "",
  `- roomType은 다음 중 하나만 고른다: ${ROOM_IDS.join(", ")}.`,
  "",
  "크기 판단",
  "- 바닥 타일·마루 줄눈, 천장 마감(600×600 텍스 등), 문 높이 2100mm, 천장 2300~2900mm를",
  "  자로 삼아 역산한다. 사람이 서 있으면 1700mm로 본다.",
  "- 바닥 타일이 보이면 타일 장수를 세어 방 크기를 잰다. 가장 정확한 방법이다.",
  "",
  "실 나누기",
  "- 사진 한 장에는 보통 방 하나만 담기므로 rooms는 하나면 된다.",
  "- 다만 유리 칸막이나 벽으로 나뉜 구역이 함께 보이면 각각 실로 나눈다.",
  "",
  "마감재 (finishes)",
  "- 바닥·벽·천장에 실제로 무엇이 마감돼 있는지 한국어 한 마디로 적는다.",
  "  예: 바닥은 회색 포세린 타일, 벽은 화이트 도장, 천장은 흰색 텍스.",
  "",
  "벽과 개구부",
  "- 창문과 문은 절대 빠뜨리지 않는다. 평면도·입면도에서 가장 중요한 요소다.",
  "- 유리 칸막이벽·커튼월은 kind=glass-partition으로, 그 벽 길이의 대부분을 차지하도록 넓게 잡는다.",
  "- 문틀만 있고 문짝이 없는 통로는 kind=opening.",
  "- 카메라 뒤쪽처럼 사진에 안 보이는 벽도 방이 닫히도록 추정해서 넣는다(개구부는 비워 둔다).",
  "",
  "가구",
  "- ★ furniture 배열의 항목 수는 1단계 inventory의 count 합계와 정확히 같아야 한다.",
  "  10개를 셌으면 10개를 배치한다. 하나라도 빠뜨리면 안 된다.",
  "- 평면상의 중심 좌표(xMm, yMm)와 회전각으로 준다.",
  "- ★ 회전 0도는 가구의 정면이 사진을 찍은 카메라 쪽(y가 작아지는 방향)을 향하는 상태다.",
  "  안쪽 벽에 등을 대고 카메라를 바라보는 소파가 0도, 그 반대로 놓인 소파가 180도,",
  "  왼쪽 벽에 등을 댄 가구가 90도다.",
  "- 같은 것이 여러 개면 하나씩 따로, 실제로 놓인 자리에 각각 배치한다.",
  "  겹쳐 놓지 말고 사진에서 보이는 간격 그대로 벌려 놓는다.",
  "- 의자는 자기 테이블 주위에 둘러 놓고, 각각 테이블을 바라보도록 회전시킨다.",
  "- elevationMm은 바닥에서 물체 아래쪽까지의 높이다. 바닥에 놓인 것은 0,",
  "  천장등·환기 덕트는 (천장고 − 물체 높이), 벽에 걸린 것은 실제로 걸린 높이.",
  "- 천장등·환기 덕트·후드는 mountedOn=ceiling, 벽에 걸린 TV·액자·메뉴판은 wall, 나머지는 floor.",
  "- 사진에 없는 것을 지어내지 않는다. 빈 방이면 furniture는 비워 둔다.",
  "- 이름은 한국어로 짧게 쓴다 (예: 고기 테이블 1, 좌측 유리 칸막이, 방문).",
].join("\n");

/**
 * 2D 도면을 올렸을 때 갈아 끼우는 앞머리.
 *
 * 도면은 사진보다 쉽다 — 벽 선과 치수가 이미 그려져 있어 원근에서 역산할 필요가 없다.
 * 다만 "카메라"가 없으므로 시점 규칙을 다르게 줘야 하고, 도면 기호를 읽을 줄 알아야 한다.
 */
const FLOORPLAN_HEAD = [
  "이 이미지는 실내 공간의 2D 평면도(또는 3D 모델링 스크린샷)다. 이것을 도면 데이터로 옮긴다.",
  "",
  "■ 도면 읽는 법",
  "- 도면에 치수가 적혀 있으면 그 숫자를 그대로 쓴다. 추정하지 않는다.",
  "- 치수가 없으면 축척 막대나 문 폭(900mm)을 자로 삼아 잰다.",
  "- 두 줄로 그려진 굵은 선이 벽이다. 벽이 끊긴 곳이 개구부다.",
  "- 호(arc)가 그려진 개구부는 여닫이문, 두 줄 평행선은 미닫이문, 얇은 이중선은 창이다.",
  "- 도면의 위쪽을 y가 커지는 방향(안쪽)으로 잡고, cameraWallIndex는 0으로 둔다.",
  "- 가구 기호가 그려져 있으면 그 종류·위치·방향을 그대로 옮긴다.",
  "- 선 도면에는 마감재 정보가 없다. 도면에 재료명이 적혀 있지 않으면 finishes는 빈 문자열로 둔다.",
  "  흑백 선 그림을 보고 벽지 색을 지어내면 3D가 엉뚱한 방으로 그려진다.",
  "- ★ 도면에 적힌 실명(거실·안방·주방·욕실·현관 등)을 하나도 빠뜨리지 말고 rooms에 넣는다.",
  "  방을 가르는 내벽도 전부 walls에 넣는다. 한국 아파트는 보통 실이 5~8개다.",
  "- roomType(전체)은 가장 넓은 실의 종류로 정한다.",
  "",
].join("\n");

/** 올린 것이 사진인지 도면인지에 따라 프롬프트를 고른다 */
function promptFor(kind: ImageRef["kind"]): string {
  if (kind !== "floorplan") return PLAN_PROMPT;
  // 세는 단계·좌표 규칙은 그대로 쓰고, 첫 줄(사진 안내)만 도면용으로 바꾼다.
  return FLOORPLAN_HEAD + PLAN_PROMPT.split("\n").slice(1).join("\n");
}


/* ───────────── 예전 방식 (화면 bbox) — mock 폴백과의 호환을 위해 남긴다 ───────────── */

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    roomType: { type: "string", enum: ROOM_IDS },
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
  `0) roomType은 다음 중 하나만 고른다: ${ROOM_IDS.join(", ")}.`,
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

/**
 * 모델이 목록 밖의 이름을 돌려줬을 때 우리 id로 되돌린다.
 * 스키마 enum이 대부분 막아 주지만, 구형 모델이나 폴백 경로까지 지켜 준다.
 */
const ROOM_ALIASES: Record<string, RoomId> = {
  living_room: "living-room",
  livingroom: "living-room",
  living: "living-room",
  bed_room: "bedroom",
  kids_room: "kids-room",
  kidsroom: "kids-room",
  home_office: "home-office",
  homeoffice: "home-office",
  office: "home-office",
  study: "home-office",
  dressing_room: "dressing-room",
  dressingroom: "dressing-room",
  one_room: "studio",
  oneroom: "studio",
  toilet: "bathroom",
  veranda: "balcony",
  shop: "retail",
  store: "retail",
};

export function normalizeRoomType(value: string | undefined): RoomId {
  const key = (value ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (ROOM_IDS.includes(key as RoomId)) return key as RoomId;
  return ROOM_ALIASES[key] ?? "living-room";
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

/**
 * 같은 사진에는 같은 도면이 나와야 한다.
 *
 * 기본값(temperature ~1)으로 두면 같은 사진을 두 번 분석했을 때 방 면적이
 * 60㎡와 81㎡로 갈리고 의자 수가 8개와 17개로 갈렸다. 정확도 이전에 신뢰의 문제다 —
 * 다시 눌러서 값이 바뀌면 사용자는 어느 쪽도 믿지 않는다.
 * 측량은 창작이 아니므로 무작위성을 완전히 끈다.
 */
const DETERMINISTIC = { temperature: 0, topP: 1, seed: 7 } as const;

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
                { text: promptFor(image.kind) },
                { inlineData: { mimeType: payload.mimeType, data: payload.data } },
              ],
            },
          ],
          config: {
            ...DETERMINISTIC,
            responseMimeType: "application/json",
            responseSchema: PLAN_SCHEMA as never,
          },
        });

        const text = response.text;
        if (!text) {
          errors.push(`${model}: 빈 응답`);
          continue;
        }

        const analysis = toPlanAnalysis(JSON.parse(text) as RawPlan);
        if (!analysis) {
          errors.push(`${model}: 평면이 성립하지 않음`);
          continue;
        }

        const { width, length } = analysis.roomDimensions;
        const openings = (analysis.plan?.walls ?? []).reduce(
          (sum, wall) => sum + wall.openings.length,
          0
        );
        console.info(
          `[vision] ${model} — ${analysis.roomType} ${width}×${length}mm, ` +
            `벽 ${analysis.plan?.walls.length ?? 0}개(개구부 ${openings}), ` +
            `가구 ${analysis.plan?.furniture.length ?? 0}개`
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

/* ─────────────────── 평면 응답 → RoomAnalysis ─────────────────── */

interface RawPlan {
  roomType?: string;
  inventory?: { label?: string; type?: string; count?: number; where?: string }[];
  finishes?: { floor?: string; wall?: string; ceiling?: string };
  ceilingHeightMm?: number;
  cameraWallIndex?: number;
  styleGuess?: string;
  lightFrom?: string;
  outline?: { x?: number; y?: number }[];
  rooms?: { name?: string; type?: string; polygon?: { x?: number; y?: number }[] }[];
  walls?: {
    name?: string;
    start?: { x?: number; y?: number };
    end?: { x?: number; y?: number };
    thicknessMm?: number;
    openings?: {
      kind?: string;
      name?: string;
      offsetMm?: number;
      widthMm?: number;
      heightMm?: number;
      sillMm?: number;
    }[];
  }[];
  furniture?: {
    type?: string;
    name?: string;
    xMm?: number;
    yMm?: number;
    rotationDeg?: number;
    widthMm?: number;
    depthMm?: number;
    heightMm?: number;
    elevationMm?: number;
    mountedOn?: string;
    material?: string;
    color?: string;
  }[];
}

const OPENING_KINDS = new Set<PlanOpening["kind"]>(["door", "window", "glass-partition", "opening"]);

/** 벽 하나에 개구부가 들어갈 자리가 있는지 확인하고 벽 안으로 밀어 넣는다 */
function fitOpening(raw: NonNullable<RawPlan["walls"]>[number]["openings"], wallLengthMm: number) {
  const openings: PlanOpening[] = [];

  for (const item of raw ?? []) {
    const kind = OPENING_KINDS.has(item.kind as PlanOpening["kind"])
      ? (item.kind as PlanOpening["kind"])
      : "window";

    // 벽보다 긴 개구부는 벽을 무너뜨린다 — 양쪽에 최소한의 벽체를 남긴다.
    const width = clamp(item.widthMm ?? 0, 200, Math.max(200, wallLengthMm - 200), 900);
    const offset = clamp(item.offsetMm ?? 0, 0, Math.max(0, wallLengthMm - width), 0);

    openings.push({
      kind,
      name: item.name?.trim() || (kind === "door" ? "문" : "창문"),
      offsetMm: Math.round(offset),
      widthMm: Math.round(width),
      heightMm: Math.round(clamp(item.heightMm ?? 0, 200, 4000, 1200)),
      sillMm: Math.round(clamp(item.sillMm ?? 0, 0, 3000, kind === "door" ? 0 : 900)),
    });
  }

  return openings;
}


/* ─────────────── 실 경계에서 벽을 계산한다 ─────────────── */

/** 방향을 무시한 선분 열쇠 — (a,b)와 (b,a)를 같은 벽으로 본다 */
function edgeKey(a: PlanPoint, b: PlanPoint): string {
  const one = `${a.x},${a.y}`;
  const two = `${b.x},${b.y}`;
  return one < two ? `${one}|${two}` : `${two}|${one}`;
}

/** 선분의 중점이 다른 선분 위(±허용오차)에 있고 방향이 나란한지 */
function sameWall(a: PlanWall, b: PlanWall, toleranceMm = 400): boolean {
  const dir = (w: PlanWall) => {
    const dx = w.end.x - w.start.x;
    const dy = w.end.y - w.start.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  };
  const da = dir(a);
  const db = dir(b);
  // 나란하지 않으면 다른 벽 (반대 방향도 같은 벽으로 본다)
  if (Math.abs(da.x * db.x + da.y * db.y) < 0.95) return false;

  const mid = { x: (b.start.x + b.end.x) / 2, y: (b.start.y + b.end.y) / 2 };
  const t =
    ((mid.x - a.start.x) * da.x + (mid.y - a.start.y) * da.y) /
    (Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y) || 1);
  const clamped = Math.min(1, Math.max(0, t));
  const near = {
    x: a.start.x + (a.end.x - a.start.x) * clamped,
    y: a.start.y + (a.end.y - a.start.y) * clamped,
  };
  return Math.hypot(mid.x - near.x, mid.y - near.y) <= toleranceMm;
}

/**
 * 실 경계선을 모아 벽 네트워크를 만든다.
 *
 * 모델에게 벽을 일일이 세어 달라고 하면 자꾸 빠뜨린다 — 실 11개짜리 아파트 도면에서
 * 벽을 5개만 줬다. 그런데 벽이 어디 있는지는 실 폴리곤이 이미 다 말해 주고 있다:
 * 두 실이 공유하는 변은 내벽이고, 한 실에만 속한 변은 외벽이다. 세는 대신 계산한다.
 *
 * 모델이 준 벽은 개구부(창·문)를 들고 있으므로, 같은 자리의 계산된 벽에 옮겨 붙인다.
 */
function wallsFromRooms(rooms: PlanRoom[], given: PlanWall[]): PlanWall[] {
  const counts = new Map<string, { wall: PlanWall; shared: boolean }>();

  for (const room of rooms) {
    for (let i = 0; i < room.polygon.length; i++) {
      const start = room.polygon[i];
      const end = room.polygon[(i + 1) % room.polygon.length];
      if (Math.hypot(end.x - start.x, end.y - start.y) < 200) continue;

      const key = edgeKey(start, end);
      const seen = counts.get(key);
      if (seen) {
        seen.shared = true;
        continue;
      }
      counts.set(key, {
        shared: false,
        wall: { name: "벽", start, end, thicknessMm: 150, openings: [] },
      });
    }
  }

  const derived = [...counts.values()].map(({ wall, shared }, index) => ({
    ...wall,
    name: shared ? `내벽 ${index + 1}` : `외벽 ${index + 1}`,
    thicknessMm: shared ? 100 : 200,
  }));

  // 모델이 준 개구부를 같은 자리의 벽으로 옮긴다.
  const leftover: PlanWall[] = [];
  for (const wall of given) {
    const match = derived.find((item) => sameWall(item, wall));
    if (match) {
      match.name = wall.name || match.name;
      match.thicknessMm = wall.thicknessMm;
      match.openings = [...match.openings, ...wall.openings];
    } else {
      leftover.push(wall);
    }
  }

  return [...derived, ...leftover];
}

/**
 * 모델이 준 평면을 검증해서 RoomAnalysis로 옮긴다.
 *
 * 외곽선이 성립하지 않으면(점이 3개 미만, 면적이 터무니없음) null을 돌려주고
 * 호출하는 쪽이 다음 모델로 넘어가게 한다 — 반쯤 망가진 도면을 그리는 것보다 낫다.
 */
export function toPlanAnalysis(raw: RawPlan): RoomAnalysis | null {
  const points = (raw.outline ?? [])
    .map((point) => ({ x: Number(point?.x), y: Number(point?.y) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

  if (points.length < 3) return null;

  // 원점을 좌측 하단으로 옮긴다 — 도면·3D 모두 방이 (0,0)에서 시작한다고 본다.
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const outline = points.map((p) => ({ x: Math.round(p.x - minX), y: Math.round(p.y - minY) }));

  const width = Math.max(...outline.map((p) => p.x));
  const length = Math.max(...outline.map((p) => p.y));
  if (width < 1000 || length < 1000 || width > 60000 || length > 60000) return null;

  const height = Math.round(clamp(raw.ceilingHeightMm ?? 0, 2000, 6000, 2400));

  /** 좌표 하나를 도면 안으로 들여놓는다 (원점 이동 + 경계 밖 방지) */
  const shift = (value: unknown, axis: "x" | "y") => {
    const raw = Number(value);
    if (!Number.isFinite(raw)) return null;
    const moved = raw - (axis === "x" ? minX : minY);
    return Math.round(Math.min(Math.max(moved, 0), axis === "x" ? width : length));
  };

  /*
   * 벽.
   *
   * 이제 외곽선의 변이 아니라 좌표를 가진 선분이라, 방과 방 사이의 내벽도 담긴다.
   * 모델이 벽을 아예 안 주거나 다 버려지면 외곽선으로 둘러싸기라도 한다 —
   * 벽이 없는 도면은 아무 쓸모가 없다.
   */
  const walls: PlanWall[] = [];
  for (const [index, source] of (raw.walls ?? []).entries()) {
    /*
     * 좌표를 빠뜨린 벽은 외곽선의 같은 번호 변으로 본다.
     * 예전 형식(벽이 외곽선 변과 1:1)이 그랬고, 모델이 start·end를 흘리는 경우도 있다.
     * 이 폴백이 없으면 그 벽에 달린 창·문이 통째로 사라진다.
     */
    const edgeStart = outline[index];
    const edgeEnd = outline[(index + 1) % outline.length];
    const hasEdge = index < outline.length;

    const sx = shift(source?.start?.x, "x") ?? (hasEdge ? edgeStart.x : null);
    const sy = shift(source?.start?.y, "y") ?? (hasEdge ? edgeStart.y : null);
    const ex = shift(source?.end?.x, "x") ?? (hasEdge ? edgeEnd.x : null);
    const ey = shift(source?.end?.y, "y") ?? (hasEdge ? edgeEnd.y : null);
    if (sx === null || sy === null || ex === null || ey === null) continue;

    const wallLengthMm = Math.hypot(ex - sx, ey - sy);
    if (wallLengthMm < 200) continue; // 점에 가까운 벽은 도면을 어지럽히기만 한다

    walls.push({
      name: source?.name?.trim() || `벽 ${index + 1}`,
      start: { x: sx, y: sy },
      end: { x: ex, y: ey },
      thicknessMm: Math.round(clamp(source?.thicknessMm ?? 0, 50, 500, 150)),
      openings: fitOpening(source?.openings, wallLengthMm),
    });
  }

  if (walls.length < 3) {
    walls.length = 0;
    outline.forEach((start, index) => {
      const end = outline[(index + 1) % outline.length];
      if (Math.hypot(end.x - start.x, end.y - start.y) < 200) return;
      walls.push({
        name: `외벽 ${index + 1}`,
        start,
        end,
        thicknessMm: 150,
        openings: [],
      });
    });
  }

  /*
   * 실(방).
   *
   * 없으면 외곽선 전체를 실 하나로 본다 — 사진 한 장은 대개 방 하나다.
   * 아파트 도면을 넣으면 여기에 거실·안방·주방·욕실이 각각 들어온다.
   */
  const rooms: PlanRoom[] = [];
  for (const source of raw.rooms ?? []) {
    const polygon = (source?.polygon ?? [])
      .map((point) => ({ x: shift(point?.x, "x"), y: shift(point?.y, "y") }))
      .filter((point): point is PlanPoint => point.x !== null && point.y !== null);
    if (polygon.length < 3) continue;

    rooms.push({
      name: source?.name?.trim() || "실",
      type: normalizeRoomType(source?.type),
      polygon,
    });
  }

  if (rooms.length === 0) {
    rooms.push({
      name: ROOM_MAP[normalizeRoomType(raw.roomType)]?.label ?? "실",
      type: normalizeRoomType(raw.roomType),
      polygon: outline,
    });
  }

  const furniture: PlanFurniture[] = (raw.furniture ?? [])
    .filter((item) => OBJECT_TYPES.includes(item.type as SceneObject["type"]))
    .map((item) => {
      const itemHeight = clamp(item.heightMm ?? 0, 20, 3500, 800);
      return {
        type: item.type as SceneObject["type"],
        name: item.name?.trim() || "객체",
        xMm: Math.round(clamp(item.xMm ?? 0, 0, width, width / 2)),
        yMm: Math.round(clamp(item.yMm ?? 0, 0, length, length / 2)),
        rotationDeg: Math.round(((((item.rotationDeg ?? 0) % 360) + 360) % 360) / 15) * 15,
        widthMm: Math.round(clamp(item.widthMm ?? 0, 50, 8000, 800)),
        depthMm: Math.round(clamp(item.depthMm ?? 0, 50, 8000, 600)),
        heightMm: Math.round(itemHeight),
        elevationMm: Math.round(clamp(item.elevationMm ?? 0, 0, Math.max(0, height - itemHeight), 0)),
        mountedOn:
          item.mountedOn === "ceiling" || item.mountedOn === "wall" ? item.mountedOn : "floor",
        material: item.material?.trim() || null,
        color: /^#[0-9a-f]{6}$/i.test(item.color ?? "") ? item.color! : null,
      };
    });

  if (raw.cameraWallIndex !== 0) {
    console.warn(
      `[vision] 카메라 벽이 0번이 아닙니다 (${raw.cameraWallIndex}) — 도면 방향이 사진과 다를 수 있습니다.`
    );
  }

  /*
   * 실이 둘 이상이면 실 경계에서 벽을 다시 짠다.
   * 방 하나짜리 사진은 모델이 준 벽이 이미 충분해서 건드리지 않는다.
   */
  const finalWalls = rooms.length > 1 ? wallsFromRooms(rooms, walls) : walls;

  return {
    roomType: normalizeRoomType(raw.roomType),
    roomDimensions: { width, length, height },
    objects: [],
    styleGuess: raw.styleGuess?.trim() || null,
    lightDirection: lightVector(raw.lightFrom),
    plan: {
      roomType: normalizeRoomType(raw.roomType),
      finishes: {
        floor: raw.finishes?.floor?.trim() || null,
        wall: raw.finishes?.wall?.trim() || null,
        ceiling: raw.finishes?.ceiling?.trim() || null,
      },
      ceilingHeightMm: height,
      cameraWallIndex: raw.cameraWallIndex ?? 0,
      outline,
      rooms,
      walls: finalWalls,
      furniture,
    },
  };
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
    roomType: normalizeRoomType(raw.roomType),
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

/* ─────────────── 설명 → 실제 크기 (AI 가구 생성에 쓴다) ─────────────── */

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

/**
 * "우드 원형 4인 식탁" 같은 설명에서 종류와 실제 크기를 읽는다.
 *
 * 생성한 이미지는 크기를 알려 주지 않는다. 그런데 평면도에 발자국을 그리려면 mm가 있어야
 * 하므로, 이미지와 별개로 치수를 한 번 물어본다 — 사람이 눈대중으로 넣는 것보다 정확하고,
 * 텍스트 한 번이라 비용도 거의 들지 않는다.
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

  for (const model of visionModels()) {
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
    } catch {
      // 다음 모델로
    }
  }

  return fallback;
}
