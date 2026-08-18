import type { StructuredCommand } from "@/ai/providers/types";
import { findColorByText, findMaterialByText } from "@/models/materials";
import { findStyleByText } from "@/models/styles";
import { searchAssets } from "@/models/assets";

/**
 * AI Router.
 *
 * 사용자의 모든 문장을 image generation으로 보내지 않는다.
 * 먼저 intent와 target object를 판별해서, 가능한 것은 Scene operation으로 처리한다.
 * (재생성보다 훨씬 빠르고, 편집 결과가 보존된다.)
 */

export type Intent =
  | "COLOR_CHANGE"
  | "MATERIAL_CHANGE"
  | "REMOVE_OBJECT"
  | "MOVE_OBJECT"
  | "SCALE_OBJECT"
  | "ROTATE_OBJECT"
  | "REPLACE_OBJECT"
  | "ADD_OBJECT"
  | "STYLE_TRANSFER"
  | "LIGHTING_CHANGE"
  | "ROOM_CHANGE"
  | "OPENING_CHANGE"
  | "RENDER"
  | "MULTI_EDIT"
  | "UNKNOWN";

export interface RouterObject {
  id: string;
  name: string;
  type: string;
  materialId: string | null;
}

export interface RouterWall {
  id: string;
  name: string;
  length: number;
  thickness: number;
  openings: { id: string; name: string; type: string; width: number; height: number }[];
}

export interface RouterRoom {
  dimensions: { width: number; length: number; height: number };
  measured?: boolean;
  walls: RouterWall[];
}

export interface RouterContext {
  objects: RouterObject[];
  lights?: { id: string; name: string; type: string }[];
  room?: RouterRoom;
  selectedObjectId?: string | null;
}

/** 객체 타입을 가리키는 한국어/영어 키워드 */
const TYPE_KEYWORDS: { type: string; keywords: string[] }[] = [
  { type: "sofa", keywords: ["소파", "쇼파", "sofa", "couch"] },
  { type: "chair", keywords: ["의자", "체어", "chair", "라운지체어", "스툴"] },
  { type: "table", keywords: ["테이블", "탁자", "table", "협탁", "아일랜드"] },
  { type: "bed", keywords: ["침대", "bed"] },
  { type: "cabinet", keywords: ["수납장", "장식장", "캐비닛", "cabinet", "옷장", "책장", "선반"] },
  { type: "lamp", keywords: ["램프", "조명", "lamp", "스탠드", "펜던트"] },
  { type: "plant", keywords: ["식물", "화분", "plant", "그린"] },
  { type: "rug", keywords: ["러그", "카펫", "rug", "carpet"] },
  { type: "tv", keywords: ["tv", "티비", "텔레비전"] },
  { type: "window", keywords: ["창문", "창", "window"] },
  { type: "wall", keywords: ["벽", "wall", "벽면"] },
  { type: "floor", keywords: ["바닥", "floor", "마루"] },
  { type: "ceiling", keywords: ["천장", "ceiling"] },
  { type: "appliance", keywords: ["가전", "냉장고", "appliance"] },
  { type: "decoration", keywords: ["액자", "거울", "장식", "소품"] },
];

const DELETE_WORDS = ["삭제", "지워", "지우고", "제거", "없애", "빼줘", "빼고", "remove", "delete"];
const ADD_WORDS = ["추가", "놓아", "놔줘", "넣어", "배치해", "add", "put"];
const REPLACE_WORDS = ["교체", "바꿔서", "다른 것으로", "다른걸로", "replace", "새로운"];
const SCALE_UP_WORDS = ["크게", "키워", "확대", "bigger", "larger"];
const SCALE_DOWN_WORDS = ["작게", "줄여", "축소", "smaller"];
const ROTATE_WORDS = ["회전", "돌려", "rotate", "틀어"];
const RENDER_WORDS = ["렌더", "render", "출력해"];
/** 조명 자체를 조정하는 표현 — 객체 이름이 함께 나와도 조명 명령으로 본다 */
const LIGHT_ADJUST_WORDS = [
  "밝게",
  "어둡게",
  "밝기",
  "환하게",
  "brighter",
  "darker",
  "따뜻하게",
  "차갑게",
];
const MATERIAL_WORDS = [
  "재질",
  "마감",
  "소재",
  "material",
  "가죽",
  "패브릭",
  "우드",
  "대리석",
  "타일",
  "콘크리트",
];
const COLOR_WORDS = ["색", "컬러", "color", "색상"];

const DIRECTIONS: { keywords: string[]; dx: number; dy: number; label: string }[] = [
  { keywords: ["왼쪽", "좌측", "left"], dx: -0.08, dy: 0, label: "왼쪽" },
  { keywords: ["오른쪽", "우측", "right"], dx: 0.08, dy: 0, label: "오른쪽" },
  { keywords: ["위로", "위쪽", "up"], dx: 0, dy: -0.06, label: "위" },
  { keywords: ["아래로", "아래쪽", "down"], dx: 0, dy: 0.06, label: "아래" },
  { keywords: ["앞으로", "앞쪽", "forward"], dx: 0, dy: 0.06, label: "앞" },
  { keywords: ["뒤로", "뒤쪽", "back"], dx: 0, dy: -0.06, label: "뒤" },
];

const NUMBER_WORDS: Record<string, number> = {
  한: 1,
  하나: 1,
  두: 2,
  둘: 2,
  세: 3,
  셋: 3,
  네: 4,
  넷: 4,
  다섯: 5,
};

function includesAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

function detectType(text: string): string | null {
  const normalized = text.toLowerCase();
  for (const entry of TYPE_KEYWORDS) {
    if (entry.keywords.some((keyword) => normalized.includes(keyword.toLowerCase()))) {
      return entry.type;
    }
  }
  return null;
}

function detectCount(text: string): number {
  const digit = /(\d+)\s*(개|two|개의)?/.exec(text);
  if (digit) {
    const value = Number(digit[1]);
    if (Number.isFinite(value) && value > 0 && value <= 10) return value;
  }
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (text.includes(`${word} 개`) || text.includes(`${word}개`)) return value;
  }
  return 1;
}

/** 문장에서 대상 객체를 찾는다. 없으면 선택된 객체를 쓴다. */
function resolveTarget(text: string, context: RouterContext): RouterObject | null {
  const normalized = text.toLowerCase();

  // 이름 직접 일치 우선
  const byName = context.objects.find(
    (object) => object.name && normalized.includes(object.name.toLowerCase())
  );
  if (byName) return byName;

  const type = detectType(text);
  if (type) {
    const byType = context.objects.find((object) => object.type === type);
    if (byType) return byType;
  }

  if (
    context.selectedObjectId &&
    (includesAny(normalized, ["이거", "이것", "선택", "얘", "this", "it"]) || !type)
  ) {
    return context.objects.find((object) => object.id === context.selectedObjectId) ?? null;
  }

  return null;
}

/* ─────────────────── 방 치수 · 벽 · 개구부 ─────────────────── */

const DOOR_WORDS = ["문", "도어", "출입문", "현관문", "door"];
const WINDOW_WORDS = ["창문", "창", "window"];
const OPENING_ADD_WORDS = ["내줘", "내고", "만들", "추가", "달아", "넣어", "뚫어", "설치"];

/**
 * 문·창을 가리키는지 판별한다.
 * '창문'에는 '문'이 들어 있으므로 창을 먼저 걷어 내고 문을 찾는다.
 */
function detectOpeningType(text: string): "door" | "window" | null {
  const withoutWindow = text.replace(/창문/g, "창");
  if (includesAny(withoutWindow, DOOR_WORDS)) return "door";
  if (includesAny(withoutWindow, WINDOW_WORDS)) return "window";
  return null;
}

/** 방 치수 필드 — 키워드가 먼저 나오고 뒤에 숫자가 오는 형태를 본다 */
const ROOM_FIELDS: { key: "width" | "length" | "height"; keywords: string[]; label: string }[] = [
  { key: "height", keywords: ["천장 높이", "층고", "천고", "천장", "높이"], label: "높이" },
  { key: "width", keywords: ["가로", "폭", "너비"], label: "가로" },
  { key: "length", keywords: ["세로", "길이", "깊이"], label: "세로" },
];

/** 숫자 + 단위를 mm로 환산한다 (단위가 없으면 m 단위 소수만 m로 본다) */
function toMillimeters(value: number, unit?: string): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;

  const normalized = (unit ?? "").toLowerCase();
  if (normalized === "mm" || normalized === "밀리") return value;
  if (normalized === "cm" || normalized === "센티") return value * 10;
  if (normalized === "m" || normalized === "미터") return value * 1000;

  // 단위가 없으면 "2.4" 같은 소수는 미터, "2400"은 밀리미터로 해석한다.
  return value < 100 ? value * 1000 : value;
}

/** 키워드 뒤에 오는 첫 숫자를 mm로 뽑는다 */
function lengthAfter(text: string, keyword: string): number | null {
  const index = text.indexOf(keyword);
  if (index < 0) return null;

  const rest = text.slice(index + keyword.length, index + keyword.length + 24);
  const match = /(\d+(?:\.\d+)?)\s*(mm|cm|m|밀리|센티|미터)?/.exec(rest);
  if (!match) return null;

  return toMillimeters(Number(match[1]), match[2]);
}

/** "3600x4200" 처럼 가로·세로를 한 번에 말한 경우 */
function parseDimensionPair(text: string): { width: number; length: number } | null {
  const match =
    /(\d+(?:\.\d+)?)\s*(mm|cm|m|미터)?\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(mm|cm|m|미터)?/.exec(text);
  if (!match) return null;

  const width = toMillimeters(Number(match[1]), match[2] ?? match[4]);
  const length = toMillimeters(Number(match[3]), match[4] ?? match[2]);
  if (width === null || length === null) return null;

  return { width, length };
}

/** 문장에서 대상 벽을 찾는다. 못 찾으면 첫 번째 벽(보통 남측 벽)을 쓴다. */
function resolveWall(text: string, room: RouterRoom): RouterWall | null {
  if (room.walls.length === 0) return null;

  const byName = room.walls.find((wall) => wall.name && text.includes(wall.name));
  if (byName) return byName;

  const bearings: [string[], string][] = [
    [["남측", "남쪽", "남"], "남"],
    [["동측", "동쪽", "동"], "동"],
    [["북측", "북쪽", "북"], "북"],
    [["서측", "서쪽", "서"], "서"],
  ];
  for (const [keywords, bearing] of bearings) {
    if (includesAny(text, keywords)) {
      const wall = room.walls.find((candidate) => candidate.name.startsWith(bearing));
      if (wall) return wall;
    }
  }

  return room.walls[0];
}

/** 문장에서 대상 개구부를 찾는다 */
function resolveOpening(
  text: string,
  room: RouterRoom,
  type?: "door" | "window"
): { wall: RouterWall; opening: RouterWall["openings"][number] } | null {
  for (const wall of room.walls) {
    for (const opening of wall.openings) {
      if (opening.name && text.includes(opening.name)) return { wall, opening };
    }
  }

  if (!type) return null;

  for (const wall of room.walls) {
    const opening = wall.openings.find((candidate) => candidate.type === type);
    if (opening) return { wall, opening };
  }
  return null;
}

/** 방 치수 명령: "천장 높이 2400으로", "가로 3.6m", "방 3600x4200" */
function routeRoomDimensions(text: string): StructuredCommand[] | null {
  // "문 폭 1000" 처럼 개구부 치수를 말한 경우는 방 치수가 아니다.
  if (detectOpeningType(text)) return null;

  const args: Record<string, number | boolean> = {};
  const labels: string[] = [];

  const pair = parseDimensionPair(text);
  if (pair && includesAny(text, ["방", "공간", "크기", "치수", "실측", "가로", "면적"])) {
    args.width = pair.width;
    args.length = pair.length;
    labels.push(`가로 ${Math.round(pair.width)}mm`, `세로 ${Math.round(pair.length)}mm`);
  }

  for (const field of ROOM_FIELDS) {
    if (args[field.key] !== undefined) continue;
    for (const keyword of field.keywords) {
      const value = lengthAfter(text, keyword);
      if (value === null) continue;
      // 방 치수로 보기 어려운 값은 무시한다 (문·창 치수와 섞이지 않게)
      if (value < 500 || value > 50000) continue;
      args[field.key] = value;
      labels.push(`${field.label} ${Math.round(value)}mm`);
      break;
    }
  }

  if (labels.length === 0) return null;

  if (includesAny(text, ["실측", "실제 치수", "재서", "측정"])) args.measured = true;

  return [
    {
      tool: "set_room",
      arguments: args,
      explanation: `방 치수를 ${labels.join(", ")}로 바꿉니다.`,
      confidence: 0.88,
    },
  ];
}

/** 벽·개구부 명령 */
function routeWallAndOpening(text: string, room: RouterRoom): StructuredCommand[] | null {
  const type = detectOpeningType(text);

  // 벽 두께 — "벽 두께 200으로"
  if (text.includes("벽") && includesAny(text, ["두께", "두껍", "얇"])) {
    const thickness = lengthAfter(text, "두께");
    const wall = resolveWall(text, room);
    if (thickness !== null && wall) {
      return [
        {
          tool: "update_wall",
          arguments: { wallId: wall.id, thickness },
          explanation: `${wall.name} 두께를 ${Math.round(thickness)}mm로 바꿉니다.`,
          confidence: 0.85,
        },
      ];
    }
  }

  if (!type) return null;

  // 삭제 — "문 없애줘"
  if (includesAny(text, DELETE_WORDS)) {
    const found = resolveOpening(text, room, type);
    if (!found) {
      return [unknownCommand(`지울 ${type === "door" ? "문" : "창문"}을 찾지 못했습니다.`)];
    }
    return [
      {
        tool: "delete_opening",
        arguments: { wallId: found.wall.id, openingId: found.opening.id },
        explanation: `${found.wall.name}의 ${found.opening.name}을(를) 없앱니다.`,
        confidence: 0.9,
      },
    ];
  }

  // 크기 변경 — "창문 폭 1800으로", "문 높이 2200"
  const widthValue = lengthAfter(text, "폭") ?? lengthAfter(text, "너비");
  const heightValue = lengthAfter(text, "높이");
  const sillValue = lengthAfter(text, "하부") ?? lengthAfter(text, "창대");

  if (widthValue !== null || heightValue !== null || sillValue !== null) {
    const found = resolveOpening(text, room, type);
    if (found) {
      const args: Record<string, unknown> = {
        wallId: found.wall.id,
        openingId: found.opening.id,
      };
      const labels: string[] = [];
      if (widthValue !== null) {
        args.width = widthValue;
        labels.push(`폭 ${Math.round(widthValue)}mm`);
      }
      if (heightValue !== null) {
        args.height = heightValue;
        labels.push(`높이 ${Math.round(heightValue)}mm`);
      }
      if (sillValue !== null) {
        args.sillHeight = sillValue;
        labels.push(`하부 ${Math.round(sillValue)}mm`);
      }

      return [
        {
          tool: "update_opening",
          arguments: args,
          explanation: `${found.opening.name}을(를) ${labels.join(", ")}로 바꿉니다.`,
          confidence: 0.87,
        },
      ];
    }
  }

  // 추가 — "이 벽에 문 내줘", "창문 하나 달아줘"
  if (includesAny(text, OPENING_ADD_WORDS) || includesAny(text, ADD_WORDS)) {
    const wall = resolveWall(text, room);
    if (!wall) return [unknownCommand("벽 정보를 찾지 못했습니다.")];

    const args: Record<string, unknown> = { wallId: wall.id, type };
    if (widthValue !== null) args.width = widthValue;
    if (heightValue !== null) args.height = heightValue;

    const named = room.walls.some((candidate) => text.includes(candidate.name));
    return [
      {
        tool: "add_opening",
        arguments: args,
        explanation: `${wall.name}에 ${type === "door" ? "문" : "창문"}을 냅니다.${
          named ? "" : " (다른 벽이면 '동측 벽에 문 내줘'처럼 벽 이름을 말해 주세요.)"
        }`,
        confidence: named ? 0.88 : 0.7,
      },
    ];
  }

  return null;
}

/**
 * 절 구분 규칙.
 *  - 접속어: 그리고 / 쉼표 / 후에
 *  - 연결어미 '-고': "옮기고", "삭제하고" 처럼 동사 어간 뒤에 올 때만 쪼갠다.
 *    ('냉장고', '창고' 같은 명사가 잘리지 않도록 어간 목록으로 제한한다)
 */
const CLAUSE_SPLIT =
  /\s*(?:그리고|,|、|\.\s|후에)\s*|(?<=(?:옮기|지우|바꾸|바꿔|넣|빼|키우|줄이|돌리|놓|만들|추가하|삭제하|제거하|배치하|교체하|변경하)고)\s+/;

/** 여러 동작이 한 문장에 들어 있으면 절 단위로 쪼갠다 */
export function splitClauses(instruction: string): string[] {
  return instruction
    .split(CLAUSE_SPLIT)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

/** 절 하나를 tool call로 변환 */
function routeClause(clause: string, context: RouterContext): StructuredCommand[] {
  const text = clause.trim();
  const normalized = text.toLowerCase();
  if (!text) return [];

  // 1) 스타일 트랜스퍼 — 전체 공간 대상
  const style = findStyleByText(normalized);
  if (
    style &&
    (includesAny(normalized, ["스타일", "느낌", "분위기", "전체", "공간", "style"]) ||
      !detectType(normalized))
  ) {
    if (!includesAny(normalized, [...DELETE_WORDS, ...ADD_WORDS])) {
      return [
        {
          tool: "change_style",
          arguments: { styleId: style.id },
          explanation: `전체 공간을 ${style.label} 스타일로 바꿉니다.`,
          confidence: 0.9,
        },
      ];
    }
  }

  // 2) 렌더
  if (includesAny(normalized, RENDER_WORDS)) {
    const final = includesAny(normalized, ["최종", "final", "고화질"]);
    return [
      {
        tool: final ? "render_final" : "render_preview",
        arguments: {},
        explanation: final ? "최종 렌더를 시작합니다." : "미리보기 렌더를 시작합니다.",
        confidence: 0.85,
      },
    ];
  }

  // 3) 조명
  if (includesAny(normalized, LIGHT_ADJUST_WORDS)) {
    const brighter = includesAny(normalized, ["밝게", "환하게", "brighter"]);
    const darker = includesAny(normalized, ["어둡게", "darker"]);
    const warmer = includesAny(normalized, ["따뜻하게", "웜", "warm"]);
    const cooler = includesAny(normalized, ["차갑게", "쿨", "cool"]);

    const args: Record<string, unknown> = {};
    if (brighter) args.intensityDelta = 0.35;
    if (darker) args.intensityDelta = -0.3;
    if (warmer) args.temperature = 2900;
    if (cooler) args.temperature = 6000;

    if (Object.keys(args).length > 0) {
      return [
        {
          tool: "change_lighting",
          arguments: args,
          explanation: brighter
            ? "조명을 더 밝게 조정합니다."
            : darker
              ? "조명을 어둡게 조정합니다."
              : warmer
                ? "조명을 따뜻한 색으로 조정합니다."
                : "조명을 차가운 색으로 조정합니다.",
          confidence: 0.8,
        },
      ];
    }
  }

  // 4) 방 실측 치수 · 벽 · 개구부 — 객체 편집보다 먼저 본다
  //    ("창문 넓혀줘"가 창문 객체 스케일 명령으로 새지 않도록)
  if (context.room) {
    const roomCommands = routeRoomDimensions(normalized);
    if (roomCommands) return roomCommands;

    const wallCommands = routeWallAndOpening(normalized, context.room);
    if (wallCommands) return wallCommands;
  }

  const target = resolveTarget(text, context);

  // 5) 삭제
  if (includesAny(normalized, DELETE_WORDS)) {
    if (!target) {
      return [
        unknownCommand("어떤 객체를 삭제할지 찾지 못했습니다. 캔버스에서 객체를 선택해 주세요."),
      ];
    }
    return [
      {
        tool: "delete_object",
        arguments: { objectId: target.id },
        explanation: `${target.name}을(를) 삭제합니다.`,
        confidence: 0.92,
      },
    ];
  }

  // 6) 추가
  if (includesAny(normalized, ADD_WORDS)) {
    const type = detectType(normalized) ?? "decoration";
    const count = detectCount(normalized);
    const [asset] = searchAssets(text, 1);
    return Array.from({ length: count }, (_, index) => ({
      tool: "add_object",
      arguments: {
        type,
        assetId: asset?.id ?? null,
        name: asset?.name ?? type,
        offsetIndex: index,
      },
      explanation: `${asset?.name ?? type}을(를) 추가합니다.${count > 1 ? ` (${index + 1}/${count})` : ""}`,
      confidence: 0.85,
    }));
  }

  // 6) 교체
  if (includesAny(normalized, REPLACE_WORDS) && target) {
    const [asset] = searchAssets(text, 1);
    return [
      {
        tool: "replace_object",
        arguments: { objectId: target.id, assetId: asset?.id ?? null, query: text },
        explanation: `${target.name}을(를) ${asset?.name ?? "다른 가구"}로 교체합니다.`,
        confidence: 0.8,
      },
    ];
  }

  // 7) 이동
  const direction = DIRECTIONS.find((entry) => includesAny(normalized, entry.keywords));
  if (direction && target) {
    return [
      {
        tool: "move_object",
        arguments: { objectId: target.id, dx: direction.dx, dy: direction.dy },
        explanation: `${target.name}을(를) ${direction.label}으로 옮깁니다.`,
        confidence: 0.88,
      },
    ];
  }

  // 8) 크기
  if (includesAny(normalized, SCALE_UP_WORDS) || includesAny(normalized, SCALE_DOWN_WORDS)) {
    if (!target) return [unknownCommand("크기를 바꿀 객체를 찾지 못했습니다.")];
    const up = includesAny(normalized, SCALE_UP_WORDS);
    const subtle = includesAny(normalized, ["조금", "살짝", "약간"]);
    const factor = up ? (subtle ? 1.1 : 1.25) : subtle ? 0.92 : 0.8;
    return [
      {
        tool: "scale_object",
        arguments: { objectId: target.id, factor },
        explanation: `${target.name}의 크기를 ${up ? "키웁니다" : "줄입니다"}.`,
        confidence: 0.86,
      },
    ];
  }

  // 9) 회전
  if (includesAny(normalized, ROTATE_WORDS) && target) {
    const degrees = /(-?\d+)\s*도/.exec(normalized);
    return [
      {
        tool: "rotate_object",
        arguments: { objectId: target.id, degrees: degrees ? Number(degrees[1]) : 15 },
        explanation: `${target.name}을(를) 회전합니다.`,
        confidence: 0.8,
      },
    ];
  }

  const material = findMaterialByText(normalized);
  const color = findColorByText(normalized);

  // 10) 색상 — "…색으로"처럼 색을 명시하면 재질보다 우선한다
  if (color && includesAny(normalized, COLOR_WORDS)) {
    if (!target) return [unknownCommand("색을 바꿀 객체를 찾지 못했습니다.")];
    return [
      {
        tool: "change_color",
        arguments: { objectId: target.id, color: color.hex, label: color.label },
        explanation: `${target.name}을(를) ${color.label} 색으로 바꿉니다.`,
        confidence: 0.9,
      },
    ];
  }

  // 11) 재질
  if (
    material &&
    (includesAny(normalized, MATERIAL_WORDS) || includesAny(normalized, ["으로", "로"]))
  ) {
    if (target) {
      return [
        {
          tool: "change_material",
          arguments: { objectId: target.id, materialId: material.id },
          explanation: `${target.name}의 재질을 ${material.name}(으)로 바꿉니다.`,
          confidence: 0.85,
        },
      ];
    }
  }

  // 12) 색 이름만 언급된 경우
  if (color && target) {
    return [
      {
        tool: "change_color",
        arguments: { objectId: target.id, color: color.hex, label: color.label },
        explanation: `${target.name}을(를) ${color.label} 색으로 바꿉니다.`,
        confidence: 0.82,
      },
    ];
  }

  // 13) 그 외 — 전체 재생성으로 폴백
  return [
    {
      tool: "generate_region",
      arguments: { prompt: text },
      explanation: "직접 편집할 수 없는 요청이라 AI 생성으로 처리합니다.",
      confidence: 0.4,
    },
  ];
}

function unknownCommand(reason: string): StructuredCommand {
  return { tool: "noop", arguments: { reason }, explanation: reason, confidence: 0.2 };
}

/** 자연어 명령 → tool call 목록 */
export function routeCommand(instruction: string, context: RouterContext): StructuredCommand[] {
  const clauses = splitClauses(instruction);
  const commands = clauses.flatMap((clause) => routeClause(clause, context));
  return commands.length > 0 ? commands : [unknownCommand("명령을 이해하지 못했습니다.")];
}

/** 라우팅 결과에서 대표 intent를 뽑는다 (로깅/UI 표시에 사용) */
export function intentOf(commands: StructuredCommand[]): Intent {
  if (commands.length === 0) return "UNKNOWN";
  if (commands.length > 1) return "MULTI_EDIT";

  const tool = commands[0].tool;
  const map: Record<string, Intent> = {
    change_color: "COLOR_CHANGE",
    change_material: "MATERIAL_CHANGE",
    delete_object: "REMOVE_OBJECT",
    move_object: "MOVE_OBJECT",
    scale_object: "SCALE_OBJECT",
    rotate_object: "ROTATE_OBJECT",
    replace_object: "REPLACE_OBJECT",
    add_object: "ADD_OBJECT",
    change_style: "STYLE_TRANSFER",
    change_lighting: "LIGHTING_CHANGE",
    set_room: "ROOM_CHANGE",
    update_wall: "ROOM_CHANGE",
    add_opening: "OPENING_CHANGE",
    update_opening: "OPENING_CHANGE",
    delete_opening: "OPENING_CHANGE",
    render_preview: "RENDER",
    render_final: "RENDER",
  };
  return map[tool] ?? "UNKNOWN";
}
