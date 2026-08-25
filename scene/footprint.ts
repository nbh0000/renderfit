/**
 * 가구가 평면에서 실제로 차지하는 모양.
 *
 * 지금까지 가구는 x·y·폭·깊이·회전 다섯 숫자뿐이었다. 그래서 도면에 ㄱ자 책상이
 * 그려져 있어도 우리 평면도에는 네모가 앉았다. 등받이 있는 의자도, 원형 식탁도,
 * 카우치가 달린 소파도 전부 같은 네모였다 — 받는 쪽에서 아무리 잘 그려도 다섯 숫자
 * 안에 모양이 없으니 네모밖에 나올 수 없다.
 *
 * 그래서 모양을 따로 들고 다닌다. 좌표는 가구 자기 좌표계다 — 가로·세로 모두
 * -0.5 ~ 0.5 이고, 부르는 쪽이 실제 폭·깊이를 곱하고 회전을 입힌다. planSymbols 와
 * 같은 규칙이라 기호와 윤곽이 어긋나지 않는다.
 *
 * y 가 작은 쪽(-0.5)이 가구의 뒤다. 회전 0도는 정면이 도면 아래를 보는 상태이므로
 * (scene/placement 의 규칙), 책상의 앉는 자리와 소파 등받이 방향이 여기서 정해진다.
 */

export type FootprintPoint = [number, number];

/**
 * 이름이 붙은 흔한 모양들.
 *
 * 모양은 어디까지나 **점 목록이 먼저**다. 실제 도면에는 우리가 미리 정해 둘 수 없는
 * 형태가 얼마든지 나오므로, 모델이 외곽선을 그려 보내면 그대로 쓴다.
 *
 * 이 목록은 그 외곽선이 오지 않았을 때 쓰는 뒷받침이다 — "ㄱ자 책상"이라고 이름만
 * 알려 줘도 최소한 ㄱ자로는 앉게 한다. 아무것도 없으면 네모로 돌아가는데, 그게 바로
 * 고치려는 상태였다.
 */
export type FootprintShape =
  | "rect"
  | "rounded"
  | "circle"
  | "l-shape"
  | "l-shape-mirrored"
  | "u-shape"
  | "chaise-left"
  | "chaise-right"
  | "corner"
  | "custom";

export const FOOTPRINT_SHAPES: FootprintShape[] = [
  "rect",
  "rounded",
  "circle",
  "l-shape",
  "l-shape-mirrored",
  "u-shape",
  "chaise-left",
  "chaise-right",
  "corner",
  "custom",
];

/** 0~1 비율을 -0.5~0.5 좌표로 */
const u = (value: number): number => Number((value - 0.5).toFixed(4));

/** 0~1 비율 목록을 좌표 목록으로 */
function poly(pairs: [number, number][]): FootprintPoint[] {
  return pairs.map(([x, y]) => [u(x), u(y)] as FootprintPoint);
}

/** 모서리를 둥글린 사각형 — 꼭짓점마다 몇 점씩 찍어 다각형으로 만든다 */
function roundedRect(radius: number, perCorner = 4): FootprintPoint[] {
  const r = Math.min(0.45, Math.max(0.02, radius));
  const points: FootprintPoint[] = [];

  /** 원의 한 조각 (중심, 시작 각도) */
  const arc = (cx: number, cy: number, from: number) => {
    for (let i = 0; i <= perCorner; i += 1) {
      const angle = from + (Math.PI / 2) * (i / perCorner);
      points.push([
        Number((cx + r * Math.cos(angle)).toFixed(4)),
        Number((cy + r * Math.sin(angle)).toFixed(4)),
      ]);
    }
  };

  const inner = 0.5 - r;
  arc(inner, inner, 0); // 오른쪽 아래
  arc(-inner, inner, Math.PI / 2); // 왼쪽 아래
  arc(-inner, -inner, Math.PI); // 왼쪽 위
  arc(inner, -inner, (3 * Math.PI) / 2); // 오른쪽 위

  return points;
}

/** 원 — 타원으로 늘어나도 되도록 점을 고르게 찍는다 */
function circle(segments = 24): FootprintPoint[] {
  return Array.from({ length: segments }, (_, i) => {
    const angle = (Math.PI * 2 * i) / segments;
    return [
      Number((0.5 * Math.cos(angle)).toFixed(4)),
      Number((0.5 * Math.sin(angle)).toFixed(4)),
    ] as FootprintPoint;
  });
}

/**
 * 모양별 기본 다각형.
 *
 * ㄱ자·ㄷ자의 다리 두께는 0.42 로 잡았다. 실제 사무용 ㄱ자 책상이 대체로 상판 폭의
 * 40% 안팎이고, 이보다 얇으면 도면에서 선처럼 보이고 두꺼우면 네모와 구분이 안 된다.
 */
const SHAPES: Record<Exclude<FootprintShape, "custom">, () => FootprintPoint[]> = {
  rect: () =>
    poly([
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]),

  rounded: () => roundedRect(0.12),

  circle: () => circle(),

  /* ㄱ자 — 긴 변이 위(뒤)에 붙고 짧은 다리가 왼쪽으로 내려온다 */
  "l-shape": () =>
    poly([
      [0, 0],
      [1, 0],
      [1, 0.42],
      [0.42, 0.42],
      [0.42, 1],
      [0, 1],
    ]),

  /* ㄱ자를 좌우로 뒤집은 것 — 다리가 오른쪽으로 내려온다 */
  "l-shape-mirrored": () =>
    poly([
      [0, 0],
      [1, 0],
      [1, 1],
      [0.58, 1],
      [0.58, 0.42],
      [0, 0.42],
    ]),

  /* ㄷ자 — 가운데가 파인 작업대·주방 */
  "u-shape": () =>
    poly([
      [0, 0],
      [1, 0],
      [1, 1],
      [0.7, 1],
      [0.7, 0.35],
      [0.3, 0.35],
      [0.3, 1],
      [0, 1],
    ]),

  /* 카우치가 왼쪽으로 길게 빠진 소파 */
  "chaise-left": () =>
    poly([
      [0, 0],
      [1, 0],
      [1, 0.62],
      [0.38, 0.62],
      [0.38, 1],
      [0, 1],
    ]),

  "chaise-right": () =>
    poly([
      [0, 0],
      [1, 0],
      [1, 1],
      [0.62, 1],
      [0.62, 0.62],
      [0, 0.62],
    ]),

  /* 코너장 — 두 벽이 만나는 자리에 앉는 삼각 형태 */
  corner: () =>
    poly([
      [0, 0],
      [1, 0],
      [1, 0.3],
      [0.3, 1],
      [0, 1],
    ]),
};

/** 이 모양의 기본 다각형 (custom 은 스스로 점을 줘야 하므로 사각형으로 물러난다) */
export function shapePolygon(shape: FootprintShape): FootprintPoint[] {
  return shape === "custom" ? SHAPES.rect() : SHAPES[shape]();
}

/**
 * 모델이 준 점들을 쓸 만한 다각형으로 다듬는다.
 *
 * 그대로 믿으면 도면이 더 이상해진다 — 점이 두 개뿐이거나, 좌표가 범위를 벗어나거나,
 * 같은 점이 스무 번 반복되는 답이 실제로 온다. 그래서 이렇게 거른다.
 *
 *   · 숫자가 아닌 점은 버린다
 *   · 바로 앞 점과 사실상 같은 점은 버린다 (선이 되지 않는다)
 *   · 3점 미만이면 다각형이 아니므로 없는 것으로 본다
 *   · 아주 많은 점은 잘라 낸다 — 도면에서 구분되지도 않고 장면 파일만 커진다
 *   · 받은 좌표를 -0.5~0.5 에 꽉 차게 다시 맞춘다 (모델이 어떤 축척으로 주든 상관없게)
 *
 * 모양 자체는 가리지 않는다. 오목하든, 계단처럼 꺾이든, 둥글든 그대로 받는다 —
 * 실제 도면에는 우리가 미리 정해 둘 수 없는 형태가 얼마든지 나온다.
 */
/** 다각형 한 개가 가질 수 있는 점 수 — 이보다 촘촘해도 도면에서 구분되지 않는다 */
export const MAX_POINTS = 64;

export function normalizeFootprint(points: unknown): FootprintPoint[] | null {
  if (!Array.isArray(points)) return null;

  const cleaned: FootprintPoint[] = [];

  for (const raw of points) {
    const x = Array.isArray(raw) ? raw[0] : (raw as { x?: unknown })?.x;
    const y = Array.isArray(raw) ? raw[1] : (raw as { y?: unknown })?.y;
    if (typeof x !== "number" || typeof y !== "number") continue;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    const last = cleaned[cleaned.length - 1];
    if (last && Math.abs(last[0] - x) < 1e-4 && Math.abs(last[1] - y) < 1e-4) continue;

    cleaned.push([x, y]);
    if (cleaned.length >= MAX_POINTS) break;
  }

  // 마지막 점이 첫 점과 같으면 닫힌 것이니 하나 뺀다 (우리는 늘 닫힌 것으로 다룬다)
  const first = cleaned[0];
  const last = cleaned[cleaned.length - 1];
  if (cleaned.length > 3 && first && last && Math.abs(first[0] - last[0]) < 1e-4 && Math.abs(first[1] - last[1]) < 1e-4) {
    cleaned.pop();
  }

  if (cleaned.length < 3) return null;

  const xs = cleaned.map(([x]) => x);
  const ys = cleaned.map(([, y]) => y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);

  // 한 방향으로 납작하면 다각형이 아니라 선이다
  if (spanX < 1e-3 || spanY < 1e-3) return null;

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);

  return cleaned.map(([x, y]) => [
    Number(((x - minX) / spanX - 0.5).toFixed(4)),
    Number(((y - minY) / spanY - 0.5).toFixed(4)),
  ]);
}

/**
 * 모양 이름과 (있으면) 점 목록에서 최종 다각형을 정한다.
 *
 * 점이 쓸 만하면 그것을 쓰고, 아니면 이름이 가리키는 기본 모양으로 간다.
 * 사각형은 굳이 점을 들고 다니지 않는다 — 대부분의 가구가 사각형이라, 전부 다각형으로
 * 저장하면 장면 파일만 몇 배로 커지고 얻는 것이 없다.
 */
export function resolveFootprint(
  shape: FootprintShape | string | undefined,
  outline?: unknown
): FootprintPoint[] | null {
  const custom = normalizeFootprint(outline);
  if (custom) return custom;

  const known = FOOTPRINT_SHAPES.includes(shape as FootprintShape)
    ? (shape as FootprintShape)
    : "rect";

  if (known === "rect" || known === "custom") return null;
  return shapePolygon(known);
}

/** SVG path 의 d 속성으로 (평면도·편집기가 같은 문자열을 쓴다) */
export function footprintPath(points: FootprintPoint[]): string {
  if (points.length < 3) return "";
  const [head, ...rest] = points;
  return `M${head[0]} ${head[1]}${rest.map(([x, y]) => `L${x} ${y}`).join("")}Z`;
}

/** 다각형이 실제로 차지하는 넓이 비율 (사각형이면 1) — 겹침 판정에 쓴다 */
export function footprintArea(points: FootprintPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}
