import type { PlanFurniture, PlanPoint, PlanRoom, RoomPlan } from "@/ai/providers/types";
import { pointInPolygon } from "@/scene/geometry";

/**
 * 모델이 읽어 온 평면을 사람이 그린 도면처럼 다듬는다.
 *
 * 도면을 스캔하면 벽과 실은 꽤 정확하게 나오는데 가구가 무너진다. 실제로 겪은 것들이다.
 *
 *  - 2.45×2.52m 방에 폭 2.4m짜리 침대가 들어와 방을 가득 메웠다.
 *  - 침대가 90도 돌아가 머리판이 옆벽을 보고 누웠다.
 *  - 식탁 의자 넷이 식탁과 같은 좌표에 겹쳐 쌓였다.
 *
 * 프롬프트로 아무리 당부해도 이런 것은 남는다. 그래서 돌려받은 값을 그대로 쓰지 않고,
 * 가구의 표준 규격·방의 크기·서로 간의 간격이라는 세 가지 상식으로 고쳐 앉힌다.
 * 여기 있는 규칙은 모두 순수 계산이라 AI 없이도 그대로 검증된다.
 */

/** 가구를 벽에서 이만큼은 띄운다 (mm) */
const WALL_GAP = 50;
/** 방 경계에서 이만큼은 안쪽에 둔다 (mm) */
const ROOM_MARGIN = 80;
/** 이만큼보다 가까우면 그 벽에 붙이려던 것으로 본다 (mm) */
const SNAP_RANGE = 900;

/**
 * 치수선이 그림과 이 배율 안에서 맞아떨어져야 그 실의 치수로 인정한다.
 *
 * 치수선은 도면에서 가장 믿을 만한 숫자지만, 어느 실의 것인지를 틀리는 일이 있다 —
 * 모델이 도면 전체의 6500×4530을 거실 치수선이라고 옮겨 적어 평면이 세로로 늘어났다.
 * 숫자 자체를 잘못 읽는 일은 드물고 붙일 곳을 헷갈리는 일이 잦으니, 모델이 그린
 * 폴리곤과 크게 어긋나면 남의 치수를 가져온 것으로 보고 버린다.
 */
const PRINTED_TRUST = { min: 0.6, max: 1.7 };

type Size = { width: number; depth: number };

/**
 * 종류별 표준 규격 (mm).
 *
 * min/max는 "이 범위를 벗어나면 잘못 읽은 것"이라는 뜻이고, 벗어나면 typical로 되돌린다.
 * 범위 안이면 도면에서 읽은 값을 그대로 존중한다 — 실측을 우리 표준으로 덮으면 안 된다.
 */
const STANDARD: Record<string, { typical: Size; min: Size; max: Size }> = {
  bed: {
    typical: { width: 1500, depth: 2000 },
    min: { width: 900, depth: 1800 },
    max: { width: 2000, depth: 2300 },
  },
  chair: {
    typical: { width: 450, depth: 500 },
    min: { width: 300, depth: 300 },
    max: { width: 900, depth: 900 },
  },
  table: {
    typical: { width: 1400, depth: 800 },
    min: { width: 400, depth: 350 },
    max: { width: 3600, depth: 1600 },
  },
  sofa: {
    typical: { width: 2000, depth: 900 },
    min: { width: 700, depth: 700 },
    max: { width: 3600, depth: 2000 },
  },
  cabinet: {
    typical: { width: 1200, depth: 600 },
    min: { width: 300, depth: 250 },
    max: { width: 4000, depth: 900 },
  },
  appliance: {
    typical: { width: 800, depth: 700 },
    min: { width: 300, depth: 300 },
    max: { width: 1400, depth: 1000 },
  },
  tv: {
    typical: { width: 1300, depth: 80 },
    min: { width: 500, depth: 40 },
    max: { width: 2400, depth: 400 },
  },
  lamp: {
    typical: { width: 400, depth: 400 },
    min: { width: 100, depth: 100 },
    max: { width: 1200, depth: 1200 },
  },
  plant: {
    typical: { width: 500, depth: 500 },
    min: { width: 150, depth: 150 },
    max: { width: 1500, depth: 1500 },
  },
};

/**
 * 이름에서 규격을 더 좁힌다.
 *
 * 도면에는 "퀸 침대", "3인 소파"처럼 규격이 이름에 적혀 있는 일이 많다. 그 말이
 * 치수보다 믿을 만하다 — 모델은 선 길이를 재다 틀려도 글자는 제대로 읽는다.
 */
const BY_NAME: { match: RegExp; size: Size; types?: string[] }[] = [
  /*
   * types를 적으면 그 종류일 때만 쓰고, 대신 종류별 상식 범위를 건너뛴다.
   *
   * 두 가지를 한꺼번에 막는다. "식탁 의자 1"은 이름에 식탁이 들어 있어 식탁 규격
   * 1500×900을 물려받았고 — 그렇게 커진 의자 여섯이 거실을 메웠다. 반대로 욕조는
   * 실제로 1700mm 깊이라 가전 범위(최대 1000)를 넘는데, 범위로 자르면 750mm짜리
   * 반신욕조가 된다. 이름이 종류와 아귀가 맞으면 그 이름을 끝까지 믿는다.
   */
  {
    match: /의자|체어|스툴/,
    size: { width: 450, depth: 500 },
    types: ["chair"],
  },

  {
    match: /슈퍼s*싱글|ss/i,
    size: { width: 1100, depth: 2000 },
    types: ["bed"],
  },
  { match: /싱글/, size: { width: 1000, depth: 2000 }, types: ["bed"] },
  {
    match: /라지s*킹|라지킹/,
    size: { width: 1800, depth: 2000 },
    types: ["bed"],
  },
  { match: /킹/, size: { width: 1600, depth: 2000 }, types: ["bed"] },
  { match: /퀸/, size: { width: 1500, depth: 2000 }, types: ["bed"] },
  { match: /더블/, size: { width: 1400, depth: 2000 }, types: ["bed"] },
  {
    match: /2s*층s*침대|이층s*침대|벙커/,
    size: { width: 1100, depth: 2000 },
    types: ["bed"],
  },
  {
    match: /유아용?s*침대|아기s*침대|크립/,
    size: { width: 700, depth: 1300 },
    types: ["bed"],
  },

  {
    match: /코너s*소파|ㄱ자s*소파/,
    size: { width: 2600, depth: 1700 },
    types: ["sofa"],
  },
  { match: /4s*인s*소파/, size: { width: 2600, depth: 900 }, types: ["sofa"] },
  { match: /3s*인s*소파/, size: { width: 2100, depth: 900 }, types: ["sofa"] },
  { match: /2s*인s*소파/, size: { width: 1600, depth: 900 }, types: ["sofa"] },
  {
    match: /1s*인s*소파|암체어/,
    size: { width: 900, depth: 900 },
    types: ["sofa"],
  },

  { match: /책상|데스크/, size: { width: 1400, depth: 700 }, types: ["table"] },
  { match: /식탁|다이닝/, size: { width: 1500, depth: 900 }, types: ["table"] },
  {
    match: /소파s*테이블|커피s*테이블|거실s*테이블/,
    size: { width: 1100, depth: 600 },
    types: ["table"],
  },
  {
    match: /협탁|사이드s*테이블|나이트s*스탠드/,
    size: { width: 450, depth: 400 },
    types: ["table", "cabinet"],
  },

  {
    match: /붙박이장|옷장|드레스/,
    size: { width: 1800, depth: 600 },
    types: ["cabinet"],
  },
  { match: /신발장/, size: { width: 900, depth: 350 }, types: ["cabinet"] },
  {
    match: /거실장|tvs*장/i,
    size: { width: 1800, depth: 450 },
    types: ["cabinet"],
  },

  {
    match: /냉장고/,
    size: { width: 900, depth: 800 },
    types: ["appliance", "cabinet"],
  },
  {
    match: /세탁기|건조기/,
    size: { width: 600, depth: 650 },
    types: ["appliance", "cabinet"],
  },
  {
    match: /가스s*레인지|쿡탑|인덕션/,
    size: { width: 760, depth: 600 },
    types: ["appliance", "cabinet"],
  },

  // 위생기구는 가전 범위를 넘나든다 — 욕조는 1700mm 깊이가 정상이다
  // chair를 넣어 둔다 — 모델이 변기를 앉는 것으로 보고 chair로 분류해 오는 일이 있다
  {
    match: /변기|양변기/,
    size: { width: 400, depth: 700 },
    types: ["appliance", "cabinet", "decoration", "chair"],
  },
  {
    match: /세면대|세면기/,
    size: { width: 600, depth: 500 },
    types: ["appliance", "cabinet", "decoration"],
  },
  {
    match: /욕조/,
    size: { width: 800, depth: 1700 },
    types: ["appliance", "cabinet", "decoration"],
  },
  {
    match: /샤워s*부스/,
    size: { width: 900, depth: 900 },
    types: ["appliance", "cabinet", "decoration"],
  },
];

/** 등을 벽에 대고 놓는 가구 — 도면에서 이런 것이 방 한가운데 떠 있으면 잘못 읽은 것이다 */
const WALL_BACKED = new Set(["bed", "sofa", "cabinet", "appliance", "tv"]);

/** 자리를 다투지 않는 것 — 깔개는 가구 밑에 들어가고, 벽·천장에 붙은 것은 바닥을 차지하지 않는다 */
function occupiesFloor(item: PlanFurniture): boolean {
  return item.mountedOn === "floor" && item.type !== "rug";
}

/** 회전을 0·90·180·270 중 가장 가까운 값으로 (도면 가구는 이 넷 중 하나다) */
function quarter(degrees: number): 0 | 90 | 180 | 270 {
  const normalized = (((degrees % 360) + 360) % 360) / 90;
  return ((Math.round(normalized) % 4) * 90) as 0 | 90 | 180 | 270;
}

/** 돌려 놓은 뒤 평면에서 차지하는 가로·세로 */
function extent(item: { widthMm: number; depthMm: number; rotationDeg: number }): Size {
  const turned = quarter(item.rotationDeg) % 180 !== 0;
  return turned
    ? { width: item.depthMm, depth: item.widthMm }
    : { width: item.widthMm, depth: item.depthMm };
}

type Box = { x0: number; y0: number; x1: number; y1: number };

function boxOf(item: PlanFurniture): Box {
  const { width, depth } = extent(item);
  return {
    x0: item.xMm - width / 2,
    y0: item.yMm - depth / 2,
    x1: item.xMm + width / 2,
    y1: item.yMm + depth / 2,
  };
}

function boundsOf(polygon: PlanPoint[]): Box {
  return {
    x0: Math.min(...polygon.map((p) => p.x)),
    y0: Math.min(...polygon.map((p) => p.y)),
    x1: Math.max(...polygon.map((p) => p.x)),
    y1: Math.max(...polygon.map((p) => p.y)),
  };
}

function overlap(a: Box, b: Box, slack = 0): number {
  const x = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) - slack;
  const y = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) - slack;
  return x > 0 && y > 0 ? x * y : 0;
}

/**
 * 이 가구가 들어 있는 실.
 *
 * 이름이 먼저다. 모델은 "욕실 변기", "주방 싱크대", "침실1 침대"처럼 실 이름을 붙여
 * 돌려주는데, 정작 좌표는 엉뚱한 방에 찍어 놓는 일이 있다 — 변기가 식탁 옆에 놓였다.
 * 글자가 좌표보다 믿을 만하니 이름에 적힌 실로 보낸다. 뒤에서 fitToRoom이 그 실
 * 안으로 들여놓는다.
 *
 * 이름에 실이 없으면 좌표가 들어 있는 실, 그것도 없으면 가장 가까운 실로 본다.
 */
function roomOf(item: PlanFurniture, rooms: PlanRoom[]): PlanRoom | null {
  if (rooms.length === 0) return null;

  // 같은 이름이 겹칠 수 있으니 긴 이름부터 본다 (침실1이 침실보다 앞선다)
  const named = [...rooms]
    .sort((a, b) => b.name.length - a.name.length)
    .find((room) => room.name.length >= 2 && item.name.includes(room.name));
  if (named) return named;

  const inside = rooms.find((room) =>
    pointInPolygon(
      [item.xMm, item.yMm],
      room.polygon.map((p) => [p.x, p.y] as [number, number]),
    ),
  );
  if (inside) return inside;

  let best = rooms[0];
  let bestDistance = Infinity;
  for (const room of rooms) {
    const box = boundsOf(room.polygon);
    const cx = Math.min(Math.max(item.xMm, box.x0), box.x1);
    const cy = Math.min(Math.max(item.yMm, box.y0), box.y1);
    const distance = Math.hypot(item.xMm - cx, item.yMm - cy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = room;
    }
  }
  return best;
}

/** 표준 규격에서 벗어난 치수를 되돌린다 */
function resize(item: PlanFurniture): PlanFurniture {
  const standard = STANDARD[item.type];

  /*
   * 이름 규칙은 종류와 아귀가 맞을 때만 쓴다.
   *
   * "식탁 의자 1"은 이름에 식탁이 들어 있어 식탁 규격(1500×900)을 물려받았고,
   * 그렇게 커진 의자 여섯 개가 거실을 가득 메웠다. 규칙이 준 규격이 그 종류의
   * 상식 범위를 벗어나면 이름을 잘못 짚은 것으로 본다.
   */
  const named = BY_NAME.find((rule) => {
    if (!rule.match.test(item.name)) return false;
    // 종류를 못 박은 규칙은 그 종류일 때만 쓰고, 대신 범위를 따지지 않는다
    if (rule.types) return rule.types.includes(item.type);
    if (!standard) return true;
    return (
      rule.size.width >= standard.min.width &&
      rule.size.width <= standard.max.width &&
      rule.size.depth >= standard.min.depth &&
      rule.size.depth <= standard.max.depth
    );
  });

  if (!named && !standard) return item;

  const typical = named?.size ?? standard.typical;
  const widen = (bound: Size, side: "min" | "max"): Size =>
    side === "min"
      ? {
          width: Math.min(bound.width, typical.width),
          depth: Math.min(bound.depth, typical.depth),
        }
      : {
          width: Math.max(bound.width, typical.width),
          depth: Math.max(bound.depth, typical.depth),
        };

  const min = widen(
    standard?.min ?? { width: typical.width * 0.6, depth: typical.depth * 0.6 },
    "min",
  );
  const max = widen(
    standard?.max ?? { width: typical.width * 1.6, depth: typical.depth * 1.6 },
    "max",
  );

  /*
   * 이름으로 규격을 알아낸 경우, 읽어 온 치수가 그 규격에서 25% 넘게 벗어나면 규격을 믿는다.
   * "퀸 침대"라고 적어 놓고 폭 2400mm을 준 것은 도면의 치수선을 잘못 짚은 것이다.
   */
  const trust = (value: number, want: number, lo: number, hi: number) => {
    if (!Number.isFinite(value) || value <= 0) return want;
    if (value < lo || value > hi) return want;
    if (named && Math.abs(value - want) / want > 0.25) return want;
    return Math.round(value);
  };

  return {
    ...item,
    widthMm: trust(item.widthMm, typical.width, min.width, max.width),
    depthMm: trust(item.depthMm, typical.depth, min.depth, max.depth),
  };
}

/**
 * 방 안에 들어가게 만든다.
 *
 * 돌려 놓은 채로 안 들어가면 먼저 90도 돌려 본다 — 폭과 깊이가 뒤바뀐 것뿐인 일이 흔하다.
 * 그래도 안 들어가면 방에 맞게 줄인다. 방보다 큰 가구를 그대로 두면 도면이 못 쓰게 된다.
 */
function fitToRoom(item: PlanFurniture, room: Box): PlanFurniture {
  const roomWidth = room.x1 - room.x0 - ROOM_MARGIN * 2;
  const roomDepth = room.y1 - room.y0 - ROOM_MARGIN * 2;
  if (roomWidth <= 0 || roomDepth <= 0) return item;

  const fits = (size: Size) => size.width <= roomWidth && size.depth <= roomDepth;

  let next = item;
  if (!fits(extent(next))) {
    const turned = { ...next, rotationDeg: quarter(next.rotationDeg + 90) };
    if (fits(extent(turned))) next = turned;
  }

  const size = extent(next);
  if (!fits(size)) {
    const scale = Math.min(roomWidth / size.width, roomDepth / size.depth, 1);
    next = {
      ...next,
      widthMm: Math.round(next.widthMm * scale),
      depthMm: Math.round(next.depthMm * scale),
    };
  }

  // 중심을 방 안으로 들여놓는다
  const placed = extent(next);
  return {
    ...next,
    xMm: Math.round(
      Math.min(
        Math.max(next.xMm, room.x0 + ROOM_MARGIN + placed.width / 2),
        room.x1 - ROOM_MARGIN - placed.width / 2,
      ),
    ),
    yMm: Math.round(
      Math.min(
        Math.max(next.yMm, room.y0 + ROOM_MARGIN + placed.depth / 2),
        room.y1 - ROOM_MARGIN - placed.depth / 2,
      ),
    ),
  };
}

/**
 * 벽을 등지게 세운다.
 *
 * 침대·소파·장은 벽에 등을 대고 놓인다. 그런데 도면에서 읽으면 90도씩 어긋나거나
 * 벽에서 몇백 mm 떠 있는 채로 들어오기 일쑤다. 이미 어느 벽 가까이에 있으면 —
 * 즉 그 벽에 붙이려던 것이 분명하면 — 그 벽 쪽으로 돌리고 딱 붙인다.
 *
 * 회전 규칙은 평면 전체와 같다. 0도는 정면이 y가 작아지는 쪽(도면 아래)을 보는 상태이므로
 * 등은 위쪽 벽에 닿는다.
 */
function backToWall(item: PlanFurniture, room: Box): PlanFurniture {
  if (!WALL_BACKED.has(item.type)) return item;

  const box = boxOf(item);
  const gaps = [
    { side: "north" as const, gap: room.y1 - box.y1, rotation: 0 as const },
    { side: "south" as const, gap: box.y0 - room.y0, rotation: 180 as const },
    { side: "west" as const, gap: box.x0 - room.x0, rotation: 90 as const },
    { side: "east" as const, gap: room.x1 - box.x1, rotation: 270 as const },
  ].sort((a, b) => a.gap - b.gap);

  const nearest = gaps[0];
  if (nearest.gap > SNAP_RANGE) return item;

  const turned = { ...item, rotationDeg: nearest.rotation };
  const size = extent(turned);

  // 돌리고 나서 방을 넘치면 벽 붙이기를 포기한다 (넘치는 것보다 떠 있는 편이 낫다)
  if (size.width > room.x1 - room.x0 || size.depth > room.y1 - room.y0) return item;

  if (nearest.side === "north") turned.yMm = Math.round(room.y1 - WALL_GAP - size.depth / 2);
  if (nearest.side === "south") turned.yMm = Math.round(room.y0 + WALL_GAP + size.depth / 2);
  if (nearest.side === "west") turned.xMm = Math.round(room.x0 + WALL_GAP + size.width / 2);
  if (nearest.side === "east") turned.xMm = Math.round(room.x1 - WALL_GAP - size.width / 2);

  return turned;
}

/**
 * 의자를 자기 테이블 둘레에 앉힌다.
 *
 * 모델은 의자를 테이블과 같은 좌표에 쌓아 놓는 일이 잦다. 도면에서는 의자가 겹쳐
 * 있으면 몇 인용 식탁인지 읽을 수 없으므로, 테이블에 겹친 의자만 골라 긴 변부터
 * 번갈아 둘러 앉힌다.
 */
function seatChairs(items: PlanFurniture[], rooms: PlanRoom[]): PlanFurniture[] {
  const tables = items.filter((item) => item.type === "table" && occupiesFloor(item));
  if (tables.length === 0) return items;

  const next = [...items];

  /*
   * 의자마다 가장 가까운 테이블을 주인으로 삼는다.
   *
   * 거리로 자르면 모델이 멀찍이 흩뿌려 놓은 의자가 어느 테이블에도 안 붙어 그대로
   * 남는다 — 실제로 식탁 의자 여섯 중 셋이 그렇게 남아 서로 겹쳤다.
   */
  const owner = new Map<number, PlanFurniture>();
  next.forEach((item, index) => {
    if (item.type !== "chair" || !occupiesFloor(item)) return;

    /*
     * 같은 실 안의 테이블만 주인이 될 수 있다.
     *
     * 실 검사가 없었을 때, 모델이 변기를 chair로 분류해 놓는 바람에 변기가 거실
     * 식탁에 끌려가 의자 사이에 앉았다. 방을 건너뛰어 의자를 옮기는 일은 없어야 한다.
     */
    const home = roomOf(item, rooms);

    let best: PlanFurniture | null = null;
    let bestDistance = Infinity;
    for (const table of tables) {
      if (roomOf(table, rooms) !== home) continue;
      const distance = Math.hypot(item.xMm - table.xMm, item.yMm - table.yMm);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = table;
      }
    }
    if (best) owner.set(index, best);
  });

  for (const table of tables) {
    const tableBox = boxOf(table);
    const size = extent(table);

    const seats = next
      .map((item, index) => ({ item, index }))
      .filter(({ index }) => owner.get(index) === table);

    if (seats.length === 0) continue;

    /*
     * 한 자리라도 엉켜 있으면 그 테이블의 의자를 통째로 다시 앉힌다.
     * 몇 개만 옮기면 옮긴 것과 안 옮긴 것이 다시 겹친다.
     */
    const tangled = seats.some(
      ({ item, index }) =>
        overlap(boxOf(item), tableBox) > 0 ||
        seats.some((other) => other.index !== index && overlap(boxOf(item), boxOf(other.item)) > 0),
    );
    if (!tangled) continue;

    /*
     * 긴 변에 먼저 앉힌다. 4인 식탁이면 긴 변에 둘씩, 6인이면 셋씩 —
     * 실제 도면에 그려지는 모양과 같다.
     */
    const longSide = size.width >= size.depth;
    const perSide = Math.ceil(seats.length / 2);
    const seat = seats[0].item;
    const seatDepth = Math.max(extent(seat).depth, 400);

    seats.forEach(({ index }, order) => {
      const first = order < perSide;
      const slot = first ? order : order - perSide;
      const count = first ? Math.min(perSide, seats.length) : seats.length - perSide;
      const step = (position: number, total: number, span: number, from: number) =>
        from + (span * (position + 1)) / (total + 1);

      const chair = { ...next[index] };

      if (longSide) {
        chair.xMm = Math.round(step(slot, Math.max(count, 1), size.width, tableBox.x0));
        chair.yMm = Math.round(
          first ? tableBox.y0 - seatDepth / 2 - 50 : tableBox.y1 + seatDepth / 2 + 50,
        );
        // 아래쪽 의자는 위(테이블)를 보고 앉는다 = 등이 아래쪽 → 180도
        chair.rotationDeg = first ? 180 : 0;
      } else {
        chair.yMm = Math.round(step(slot, Math.max(count, 1), size.depth, tableBox.y0));
        chair.xMm = Math.round(
          first ? tableBox.x0 - seatDepth / 2 - 50 : tableBox.x1 + seatDepth / 2 + 50,
        );
        chair.rotationDeg = first ? 270 : 90;
      }

      next[index] = chair;
    });
  }

  return next;
}

/**
 * 남은 겹침을 푼다.
 *
 * 벽 붙이기와 의자 앉히기로 대부분 풀리지만, 좁은 방에 큰 가구가 둘 이상이면 남는다.
 * 겹친 쪽에서 밀려나는 방향으로 조금씩 밀어 떼어 놓는다 — 완전히 못 풀어도 겹친 넓이는
 * 줄어들고, 도면에서 두 물건이 하나로 보이는 일은 없어진다.
 */
function separate(items: PlanFurniture[], room: Box): PlanFurniture[] {
  const next = [...items];
  const movable = next
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => occupiesFloor(item));

  /*
   * 밀어서 떼어 보고, 그래도 남으면 줄이고, 다시 민다.
   * 한 번만으로는 안 풀린다 — 좁은 욕실에서 욕조를 피해 민 샤워부스가 이번엔 변기와
   * 부딪히고, 그 변기를 줄이면 다시 자리가 생기는 식으로 서로 물려 있기 때문이다.
   */
  for (let pass = 0; pass < 4; pass += 1) {
    for (let round = 0; round < 40; round += 1) {
      let moved = false;

      for (let a = 0; a < movable.length; a += 1) {
        for (let b = a + 1; b < movable.length; b += 1) {
          const one = next[movable[a].index];
          const two = next[movable[b].index];
          const boxA = boxOf(one);
          const boxB = boxOf(two);
          if (overlap(boxA, boxB) <= 0) continue;

          const dx = Math.min(boxA.x1, boxB.x1) - Math.max(boxA.x0, boxB.x0);
          const dy = Math.min(boxA.y1, boxB.y1) - Math.max(boxA.y0, boxB.y0);
          const push = Math.min(dx, dy) / 2 + 10;
          const sign = (value: number) => (value >= 0 ? 1 : -1);

          // 겹친 폭이 좁은 축으로 민다 — 가장 적게 움직여 떼어 놓는 방향이다
          const alongX = dx <= dy;
          const away = alongX ? sign(one.xMm - two.xMm) : sign(one.yMm - two.yMm);

          const shift = (item: PlanFurniture, direction: number) => {
            const size = extent(item);
            const x = alongX ? item.xMm + push * direction : item.xMm;
            const y = alongX ? item.yMm : item.yMm + push * direction;
            return {
              ...item,
              xMm: Math.round(
                Math.min(Math.max(x, room.x0 + size.width / 2), room.x1 - size.width / 2),
              ),
              yMm: Math.round(
                Math.min(Math.max(y, room.y0 + size.depth / 2), room.y1 - size.depth / 2),
              ),
            };
          };

          next[movable[a].index] = shift(one, away);
          next[movable[b].index] = shift(two, -away);
          moved = true;
        }
      }

      if (!moved) break;
    }

    /*
     * 그래도 남는 겹침은 방이 물리적으로 좁아서 생긴 것이다.
     *
     * 2450mm 침실에 폭 1500 침대와 500짜리 협탁 둘을 넣으면 2500이라 애초에 안 들어간다.
     * 실제 도면도 이 자리를 2330으로 적어 놓았다 — 협탁이 그만큼 좁은 것이다.
     * 밀어서 못 풀면 작은 쪽을 겹친 만큼 줄인다. 도면에서 두 물건이 하나로 뭉쳐 보이는
     * 것보다, 협탁이 조금 좁게 그려지는 편이 읽기에 낫다.
     */
    for (let a = 0; a < movable.length; a += 1) {
      for (let b = a + 1; b < movable.length; b += 1) {
        const oneIndex = movable[a].index;
        const twoIndex = movable[b].index;
        const boxA = boxOf(next[oneIndex]);
        const boxB = boxOf(next[twoIndex]);
        if (overlap(boxA, boxB) <= 0) continue;

        const areaA = (boxA.x1 - boxA.x0) * (boxA.y1 - boxA.y0);
        const areaB = (boxB.x1 - boxB.x0) * (boxB.y1 - boxB.y0);
        const index = areaA <= areaB ? oneIndex : twoIndex;
        const item = next[index];

        const dx = Math.min(boxA.x1, boxB.x1) - Math.max(boxA.x0, boxB.x0);
        const dy = Math.min(boxA.y1, boxB.y1) - Math.max(boxA.y0, boxB.y0);
        const alongX = dx <= dy;

        // 평면에서 줄일 축이 회전에 따라 폭인지 깊이인지 달라진다
        const turned = quarter(item.rotationDeg) % 180 !== 0;
        const key = alongX === !turned ? "widthMm" : "depthMm";
        const shrunk = Math.max(
          Math.round(item[key] * 0.6),
          Math.round(item[key] - (alongX ? dx : dy) - 10),
        );

        const moved = { ...item, [key]: shrunk };
        const size = extent(moved);
        next[index] = {
          ...moved,
          xMm: Math.round(
            Math.min(Math.max(moved.xMm, room.x0 + size.width / 2), room.x1 - size.width / 2),
          ),
          yMm: Math.round(
            Math.min(Math.max(moved.yMm, room.y0 + size.depth / 2), room.y1 - size.depth / 2),
          ),
        };
      }
    }
  }

  return next;
}

/* ─────────────────── 도면에 적힌 면적으로 되맞추기 ─────────────────── */

/** 좌표가 이만큼 안쪽이면 같은 칸 경계로 본다 (mm) */
const CUT_TOLERANCE = 120;
/**
 * 한 칸을 이 범위 밖으로는 늘이거나 줄이지 않는다.
 *
 * 처음에는 1.9까지만 열어 뒀는데, 도면이 거실 깊이를 절반 아래로 읽어 온 경우
 * 한계에 걸려 24.1㎡가 18.6㎡에서 멈췄다. 도면에 적힌 숫자를 따라가는 것이므로
 * 지어낸 값이 아니고, 그래서 세 배까지 연다. 그래도 한계를 두는 것은 모델이
 * 면적을 한 자리 잘못 읽었을 때 도면이 통째로 무너지지 않게 하기 위해서다.
 */
const SCALE_LIMIT = { min: 0.4, max: 3 };

/** 좌표들을 칸 경계로 추린다 — 가까운 것끼리는 하나로 본다 */
function cutsFrom(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const cuts: number[] = [];
  for (const value of sorted) {
    if (cuts.length === 0 || value - cuts[cuts.length - 1] > CUT_TOLERANCE) cuts.push(value);
  }
  return cuts;
}

/** 값이 어느 칸에 걸쳐 있는지 (칸 번호 목록) */
function spanOf(cuts: number[], from: number, to: number): number[] {
  const cells: number[] = [];
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const mid = (cuts[i] + cuts[i + 1]) / 2;
    if (mid > from && mid < to) cells.push(i);
  }
  return cells;
}

/** 옛 좌표를 새 좌표로 (칸 경계 사이를 비례로 늘인다) */
function remapper(cuts: number[], scales: number[]) {
  const moved = [cuts[0]];
  for (let i = 0; i < scales.length; i += 1) {
    moved.push(moved[i] + (cuts[i + 1] - cuts[i]) * scales[i]);
  }

  return (value: number) => {
    if (value <= cuts[0]) return Math.round(moved[0] + (value - cuts[0]));
    for (let i = 0; i < scales.length; i += 1) {
      if (value <= cuts[i + 1]) {
        const ratio = (value - cuts[i]) / (cuts[i + 1] - cuts[i] || 1);
        return Math.round(moved[i] + (moved[i + 1] - moved[i]) * ratio);
      }
    }
    return Math.round(moved[moved.length - 1] + (value - cuts[cuts.length - 1]));
  };
}

/**
 * 도면에 적힌 숫자에 맞게 평면을 늘인다.
 *
 * 모델은 글자는 잘 읽는데 선 길이는 자주 틀린다. 실제로 24.1㎡라고 적힌 거실을
 * 6500×2010(13.1㎡)으로 읽어 왔다 — 소파와 식탁이 겹칠 수밖에 없는 깊이다.
 *
 * 믿는 순서가 있다.
 *
 *  1. 치수선. 도면에 "2.45m"라고 적혀 있으면 그게 답이다.
 *  2. 없으면 그림에서 읽은 폴리곤 그대로 둔다.
 *
 * 한때 실 안에 적힌 면적(24.1㎡ 같은 글자)으로도 되맞춰 봤는데, 그 숫자는 벽 두께를
 * 품기도 해서 같은 도면의 치수선과 어긋났고(2.45×2.52 방에 7.8㎡라고 적혀 있었다),
 * 치수선과 서로 잡아당기며 평면을 일그러뜨렸다. 도면에 그어진 치수선만 믿는다.
 *
 * 실 경계를 세로줄·가로줄로 잘라 칸을 만들고, 각 칸의 폭·높이를 조금씩 조정해
 * 모든 실이 적힌 숫자에 가까워지게 한다. 실이 칸을 나눠 쓰므로 한 번에 풀리지 않아,
 * 실마다 조금씩 당기기를 되풀이해 수렴시킨다. 늘이는 것은 칸의 크기뿐이라 방의 배치와
 * 이웃 관계는 그대로 남는다 — 거실 옆이 주방이던 것이 갑자기 떨어지거나 겹치지 않는다.
 */
export function fitRoomSizes(plan: RoomPlan): RoomPlan {
  /** 그림과 아귀가 맞는 치수선만 남긴다 */
  const believable = (printed: number | null | undefined, drawn: number) => {
    if (!printed || drawn <= 0) return null;
    const ratio = printed / drawn;
    return ratio >= PRINTED_TRUST.min && ratio <= PRINTED_TRUST.max ? printed : null;
  };

  const targets = plan.rooms
    .map((room) => {
      const bounds = boundsOf(room.polygon);
      return {
        bounds,
        width: believable(room.printedWidthMm, bounds.x1 - bounds.x0),
        depth: believable(room.printedDepthMm, bounds.y1 - bounds.y0),
      };
    })
    .filter((entry) => {
      if (!entry.width && !entry.depth) return false;
      return entry.bounds.x1 - entry.bounds.x0 > 0 && entry.bounds.y1 - entry.bounds.y0 > 0;
    });

  if (targets.length === 0) return plan;

  const xCuts = cutsFrom(plan.rooms.flatMap((room) => room.polygon.map((p) => p.x)));
  const yCuts = cutsFrom(plan.rooms.flatMap((room) => room.polygon.map((p) => p.y)));
  if (xCuts.length < 2 || yCuts.length < 2) return plan;

  const xScale = new Array(xCuts.length - 1).fill(1);
  const yScale = new Array(yCuts.length - 1).fill(1);

  const cells = targets.map((entry) => ({
    ...entry,
    columns: spanOf(xCuts, entry.bounds.x0, entry.bounds.x1),
    bands: spanOf(yCuts, entry.bounds.y0, entry.bounds.y1),
  }));

  const measure = (cuts: number[], scales: number[], indexes: number[]) =>
    indexes.reduce((sum, index) => sum + (cuts[index + 1] - cuts[index]) * scales[index], 0);

  const pull = (scales: number[], indexes: number[], step: number) => {
    for (const index of indexes) {
      scales[index] = Math.min(SCALE_LIMIT.max, Math.max(SCALE_LIMIT.min, scales[index] * step));
    }
  };

  /*
   * 치수선끼리 서로 어긋날 때가 있다.
   *
   * 도면 위쪽 "5.70m"는 오른쪽 두 실을 함께 재는 치수인데, 모델이 그것을 거실 폭이라고
   * 옮겨 적는 일이 있었다. 그러면 거실(5700)과 침실1+침실2+욕실(2450+3150+2200=7800)이
   * 같은 칸들을 두고 서로 잡아당긴다.
   *
   * 이럴 때는 칸을 적게 걸치는 쪽을 믿는다. 작은 실 옆에 그어진 치수선은 그 실의 것이
   * 거의 확실하지만, 여러 실을 가로지르는 큰 실의 치수선은 남의 치수를 가져왔을 가능성이
   * 그만큼 크기 때문이다. 그래서 걸친 칸 수로 당기는 힘을 나눈다.
   */
  for (let round = 0; round < 200; round += 1) {
    for (const cell of cells) {
      if (cell.width && cell.columns.length > 0) {
        const width = measure(xCuts, xScale, cell.columns);
        if (width > 0)
          pull(xScale, cell.columns, Math.pow(cell.width / width, 0.5 / cell.columns.length));
      }
      if (cell.depth && cell.bands.length > 0) {
        const depth = measure(yCuts, yScale, cell.bands);
        if (depth > 0)
          pull(yScale, cell.bands, Math.pow(cell.depth / depth, 0.5 / cell.bands.length));
      }
    }
  }

  const mapX = remapper(xCuts, xScale);
  const mapY = remapper(yCuts, yScale);
  const point = (p: PlanPoint): PlanPoint => ({ x: mapX(p.x), y: mapY(p.y) });

  return {
    ...plan,
    outline: plan.outline.map(point),
    rooms: plan.rooms.map((room) => ({
      ...room,
      polygon: room.polygon.map(point),
    })),
    walls: plan.walls.map((wall) => {
      const before = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
      const start = point(wall.start);
      const end = point(wall.end);
      const after = Math.hypot(end.x - start.x, end.y - start.y);
      const stretch = before > 0 ? after / before : 1;

      return {
        ...wall,
        start,
        end,
        // 창·문도 벽과 같은 비율로 따라 움직인다 (안 그러면 벽 밖으로 밀려난다)
        openings: wall.openings.map((opening) => {
          const width = Math.min(Math.round(opening.widthMm * stretch), Math.round(after));
          const offset = Math.min(
            Math.round(opening.offsetMm * stretch),
            Math.round(after) - width,
          );
          return { ...opening, widthMm: width, offsetMm: Math.max(0, offset) };
        }),
      };
    }),
    // 가구는 제품 규격이라 크기를 지키고 자리만 따라간다
    furniture: plan.furniture.map((item) => ({
      ...item,
      xMm: mapX(item.xMm),
      yMm: mapY(item.yMm),
    })),
  };
}

/**
 * 평면 하나를 다듬는다.
 *
 * 먼저 도면에 적힌 면적으로 실 크기를 되맞추고, 그다음 가구를 그 안에 앉힌다.
 * 순서가 중요하다 — 방이 실제보다 얕은 채로 가구를 앉히면 어떻게 놓아도 겹친다.
 */
/**
 * 얼마나 손대도 되는가.
 *
 * 사진과 도면은 정반대다.
 *
 * 사진에는 정답이 없다. 모델이 짐작한 값이라 2.4m 방에 폭 2.4m 침대가 들어오고
 * 식탁 의자 넷이 식탁 위에 쌓인다. 그래서 표준 규격·방 크기·간격으로 다시 앉혀야
 * 쓸 만한 배치가 된다.
 *
 * 도면은 그 자체가 정답이다. 그려진 대로가 맞는 것이고, 우리가 "보기 좋게" 고치면
 * 그건 더 이상 그 도면이 아니다. 현관이 좁게 그려져 있으면 좁은 게 맞고, 책상이
 * 벽에서 떨어져 있으면 떨어져 있는 게 맞다. 도면을 넣는 사람은 예쁜 그림이 아니라
 * 자기 도면을 원한다.
 */
export type RepairMode =
  /** 사진에서 읽은 배치 — 상식으로 앉힌다 */
  | "photo"
  /** 도면을 옮긴 것 — 그린 대로 둔다 */
  | "drawing";

export function repairPlan(plan: RoomPlan, mode: RepairMode = "photo"): RoomPlan {
  const scaled = fitRoomSizes(plan);
  if (scaled.furniture.length === 0) return scaled;

  /*
   * 도면은 여기서 끝낸다.
   *
   * 아래로 내려가면 가구를 표준 규격으로 되돌리고, 벽에 붙이고, 의자를 테이블 둘레에
   * 앉히고, 겹친 것을 밀어낸다. 사진에는 꼭 필요한 일이지만 도면에는 해서는 안 되는
   * 일이다 — 그린 것과 다른 도면이 나온다.
   */
  if (mode === "drawing") return scaled;

  const rooms = scaled.rooms.length > 0 ? scaled.rooms : [];
  const whole = boundsOf(scaled.outline);

  // 1) 규격을 되돌리고, 2) 자기 실 안에 넣고, 3) 벽을 등지게 세운다
  const sized = scaled.furniture.map((item) => {
    const fixed = resize(item);
    if (fixed.mountedOn !== "floor") return fixed;

    const room = roomOf(fixed, rooms);
    const bounds = room ? boundsOf(room.polygon) : whole;
    return backToWall(fitToRoom(fixed, bounds), bounds);
  });

  // 4) 의자를 테이블 둘레에 앉히고, 5) 실마다 남은 겹침을 푼다
  const seated = seatChairs(sized, rooms);

  const byRoom = new Map<PlanRoom | null, number[]>();
  seated.forEach((item, index) => {
    if (!occupiesFloor(item)) return;
    const room = roomOf(item, rooms);
    const bucket = byRoom.get(room);
    if (bucket) bucket.push(index);
    else byRoom.set(room, [index]);
  });

  const result = [...seated];
  for (const [room, indexes] of byRoom) {
    const bounds = room ? boundsOf(room.polygon) : whole;
    const inside = indexes.map((index) => result[index]);
    const spread = separate(inside, bounds);
    indexes.forEach((index, order) => {
      result[index] = spread[order];
    });
  }

  return { ...scaled, furniture: result };
}
