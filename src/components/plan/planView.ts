import type { FloorPlanDoc, Point } from "@renderfit/plan-schema";

/**
 * 검수 화면의 좌표 변환.
 *
 * 도면은 mm 이고 y 가 **위로** 커진다. 화면은 픽셀이고 y 가 아래로 커진다. 이 둘을
 * 오가는 계산을 여기 하나로 모아 둔다 — 흩어지면 어딘가에서 한 번 뒤집는 것을
 * 빠뜨리고, 도면이 위아래로 뒤집힌 채 검수를 통과한다.
 */

export interface View {
  /** 화면 픽셀 / mm */
  scale: number;
  /** 화면 왼쪽 위가 도면의 어느 mm 인가 */
  originX: number;
  originY: number;
}

export function toScreen(view: View, point: Point): [number, number] {
  return [(point[0] - view.originX) * view.scale, (view.originY - point[1]) * view.scale];
}

export function toPlan(view: View, x: number, y: number): Point {
  return [x / view.scale + view.originX, view.originY - y / view.scale];
}

/** 도면 전체가 화면에 들어오게 맞춘다 */
export function fitView(doc: FloorPlanDoc, width: number, height: number, padding = 40): View {
  const w = Math.max(doc.bounds.w, 1000);
  const h = Math.max(doc.bounds.h, 1000);

  const scale = Math.min((width - padding * 2) / w, (height - padding * 2) / h);
  const safe = Number.isFinite(scale) && scale > 0 ? scale : 0.02;

  return {
    scale: safe,
    /* 남는 자리를 반씩 나눠 가운데에 놓는다 */
    originX: -(width / safe - w) / 2,
    originY: h + (height / safe - h) / 2,
  };
}

/** 어떤 자리를 화면 한가운데로 */
export function centerOn(view: View, point: Point, width: number, height: number): View {
  return {
    ...view,
    originX: point[0] - width / view.scale / 2,
    originY: point[1] + height / view.scale / 2,
  };
}

/** 마우스 자리를 붙잡고 확대·축소한다 — 그래야 보던 곳이 달아나지 않는다 */
export function zoomAt(view: View, factor: number, x: number, y: number): View {
  const before = toPlan(view, x, y);
  const scale = Math.max(0.002, Math.min(2, view.scale * factor));
  const after = { ...view, scale };
  const moved = toPlan(after, x, y);

  return {
    scale,
    originX: after.originX + (before[0] - moved[0]),
    originY: after.originY + (before[1] - moved[1]),
  };
}

/* ───────────────────────── 지적 문구 ───────────────────────── */

/**
 * 지적 이유를 사람 말로.
 *
 * 파서가 남기는 값은 `low-confidence-wall` 같은 짧은 말이다. 검수하는 사람에게는
 * **무엇을 봐야 하는지**를 알려 줘야 한다.
 */
const REASONS: Record<string, string> = {
  "low-confidence-wall": "이 벽을 확실하게 읽지 못했습니다. 자리와 두께를 봐 주세요.",
  "low-confidence-opening": "문·창을 확실하게 읽지 못했습니다. 자리와 폭을 봐 주세요.",
  "low-confidence-room": "이 방의 모양을 확실하게 읽지 못했습니다.",
  "thickness-guessed": "벽 두께를 도면에서 읽지 못해 기본값(100mm)을 넣었습니다.",
  "opening-unattached": "어느 벽에도 닿지 않는 문·창이 있어 버렸습니다.",
  "fixture-placeholder-size": "도면에서 잰 크기가 아니라 표준 규격입니다. 자리와 크기를 봐 주세요.",
  "no-room-name": "방 이름을 정하지 못했습니다. 직접 적어 주세요.",
  "ambiguous-room-name": "방 안에 이름 후보가 여럿입니다. 하나를 골라 주세요.",
  "tables-not-placed": "테이블 개수만 세었습니다. 자리는 직접 놓아 주세요.",
  "no-dimension-text": "치수 글자를 읽지 못해 축척을 정하지 못했습니다. 두 점을 찍어 재 주세요.",
  "low-resolution":
    "그림이 너무 작아 치수 글자를 읽을 수 없습니다. " +
    "DXF·DWG 원본이 있으면 그것을 올려 주세요. 없으면 300dpi 이상으로 다시 떠 주세요.",
  "scale-mismatch": "가로와 세로에서 나온 축척이 어긋납니다. 두 점을 찍어 재 주세요.",
  "few-dimension-text":
    "치수 글자를 몇 개밖에 읽지 못해 축척을 믿기 어렵습니다. 두 점을 찍어 재 주세요.",
  "scale-one-axis": "한 방향 치수만 읽었습니다. 축척을 확인해 주세요.",
  "unclosed-walls": "벽이 닫히지 않아 방을 만들지 못했습니다.",
  "no-walls": "벽을 하나도 읽지 못했습니다.",
  "unpaired-wall": "짝이 없는 벽선이라 얇은 칸막이로 두었습니다.",
  "meaningless-block": "이름 없는 블록이라 종류를 정하지 못했습니다.",
};

export function reasonText(reason: string): string {
  return REASONS[reason] ?? reason;
}

/** 지적이 무엇에 대한 것인가 — 목록에 종류를 함께 보여 준다 */
export function targetLabel(doc: FloorPlanDoc, target: string): string {
  if (target === "scale") return "축척";
  if (target === "doc") return "도면 전체";

  if (doc.walls.some((item) => item.id === target)) return "벽";
  if (doc.openings.some((item) => item.id === target)) return "문·창";
  if (doc.fixtures.some((item) => item.id === target)) return "설비";

  const room = doc.rooms.find((item) => item.id === target);
  if (room) return room.name ?? "방";

  return "항목";
}

/** ㎡ 로 보기 좋게 */
export function squareMetres(areaMm2: number): string {
  return `${(areaMm2 / 1_000_000).toFixed(1)}㎡`;
}
