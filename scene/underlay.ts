import type { RoomSpec, Underlay } from "@/scene/types";

/**
 * 평면 편집기 밑그림 — 원본 도면 이미지를 평면 좌표에 겹쳐 놓는 계산.
 *
 * AI 추출이 아무리 좋아져도 마지막 조정은 사람이 한다. 모든 CAD 가 그렇다 —
 * 스캔한 도면을 뒤에 깔고, 두 점을 찍어 축척을 맞추고, 그 위에서 벽을 끌어 맞춘다.
 * 우리가 읽어 낸 것이 틀렸을 때 사용자가 고칠 방법이 없으면 그 도면은 못 쓴다.
 *
 * ── 좌표 약속 ──
 *
 * `originMm` 은 **이미지 픽셀 (0,0) 이 놓이는 평면 좌표**다. 이미지 픽셀은 왼쪽 위가
 * (0,0) 이고 아래로 갈수록 y 가 커지는데, 평면은 아래가 0 이고 위로 갈수록 커진다.
 * 그래서 originMm 은 이미지의 **왼쪽 위** 모서리이고, y 는 빼면서 내려간다.
 * 이 뒤집기를 한 곳에 모아 두지 않으면 화면·스냅·캘리브레이션이 제각각 뒤집힌다.
 *
 * 회전은 여기 계산에 넣지 않는다. 스캔이 기울었을 때 ±0.5° 씩 눈으로 맞추는 용도라
 * 그리는 쪽에서 transform 으로만 쓰고, 좌표 계산은 회전 0 을 가정한다 — 0.5° 에서
 * 생기는 어긋남은 벽 두께보다 훨씬 작고, 넣으면 이 파일이 두 배로 복잡해진다.
 */

/** 밑그림을 처음 켤 때의 값 */
export const UNDERLAY_DEFAULTS = {
  rotation: 0,
  opacity: 0.35,
  visible: true,
  locked: false,
} as const;

/** 투명도는 이 범위를 벗어나지 않는다 — 0 이면 켠 줄 모르고, 1 이면 도면이 안 보인다 */
export const OPACITY_RANGE = { min: 0.1, max: 0.8 };

/** 벽 끝점이 이 거리 안에 오면 격자선에 붙인다 (화면 px) */
export const GRID_SNAP_PX = 10;

/** 이미지 크기 (픽셀) */
export interface ImageSize {
  width: number;
  height: number;
}

/* ───────────────────── 좌표 변환 ───────────────────── */

/** 이미지 픽셀 → 평면 mm */
export function planFromPixel(
  underlay: Pick<Underlay, "originMm" | "mmPerPixel">,
  px: number,
  py: number
): [number, number] {
  return [
    underlay.originMm[0] + px * underlay.mmPerPixel,
    underlay.originMm[1] - py * underlay.mmPerPixel,
  ];
}

/** 평면 mm → 이미지 픽셀 */
export function pixelFromPlan(
  underlay: Pick<Underlay, "originMm" | "mmPerPixel">,
  x: number,
  y: number
): [number, number] {
  return [
    (x - underlay.originMm[0]) / underlay.mmPerPixel,
    (underlay.originMm[1] - y) / underlay.mmPerPixel,
  ];
}

/** 밑그림이 평면에서 차지하는 사각형 (왼쪽 위 기준 + 크기) */
export function underlayRect(
  underlay: Pick<Underlay, "originMm" | "mmPerPixel">,
  image: ImageSize
) {
  return {
    x: underlay.originMm[0],
    y: underlay.originMm[1],
    widthMm: image.width * underlay.mmPerPixel,
    heightMm: image.height * underlay.mmPerPixel,
  };
}

/** 평면의 이 점이 밑그림 위인가 — 빈 곳 드래그로 밑그림을 잡을 때 쓴다 */
export function insideUnderlay(
  underlay: Pick<Underlay, "originMm" | "mmPerPixel">,
  image: ImageSize,
  point: [number, number]
): boolean {
  const rect = underlayRect(underlay, image);
  return (
    point[0] >= rect.x &&
    point[0] <= rect.x + rect.widthMm &&
    point[1] <= rect.y &&
    point[1] >= rect.y - rect.heightMm
  );
}

/* ───────────────────── 축척 맞추기 ───────────────────── */

/** 픽셀 거리와 실제 길이로 픽셀당 mm 를 구한다 */
export function mmPerPixelFrom(pixelDistance: number, actualMm: number): number | null {
  if (!Number.isFinite(pixelDistance) || pixelDistance < 1) return null;
  if (!Number.isFinite(actualMm) || actualMm < 10 || actualMm > 200_000) return null;
  return actualMm / pixelDistance;
}

/**
 * 두 점을 찍고 그 사이 실제 길이를 넣어 축척을 맞춘다.
 *
 * **첫 점은 제자리에 남는다.** 축척만 바꾸면 이미지가 왼쪽 위 모서리를 축으로 커져서,
 * 방금 맞춘 자리가 화면 밖으로 달아난다. 사용자가 기준으로 삼은 점(첫 점)을 고정축으로
 * 두면 그 자리는 그대로 있고 나머지가 그 점을 중심으로 늘어난다 — 두 번째 점만
 * 확인하면 되므로 몇 번 반복해도 헤매지 않는다.
 *
 * 두 점은 평면 좌표(mm)로 받는다. 화면에서 찍은 점을 이미 평면으로 옮겨 놓았기
 * 때문이고, 지금 축척으로 나누면 픽셀 거리가 된다.
 */
export function calibrateUnderlay(
  underlay: Underlay,
  from: [number, number],
  to: [number, number],
  actualMm: number
): Underlay | null {
  const planDistance = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (underlay.mmPerPixel <= 0) return null;

  const pixelDistance = planDistance / underlay.mmPerPixel;
  const next = mmPerPixelFrom(pixelDistance, actualMm);
  if (next === null) return null;

  const k = next / underlay.mmPerPixel;

  return {
    ...underlay,
    mmPerPixel: next,
    originMm: [
      Math.round(from[0] - (from[0] - underlay.originMm[0]) * k),
      Math.round(from[1] - (from[1] - underlay.originMm[1]) * k),
    ],
  };
}

/* ───────────────────── 격자 스냅 ───────────────────── */

/**
 * 값이 격자선 가까이에 있으면 그 선에 붙인다.
 *
 * 밑그림의 격자선은 1단계에서 치수 체인으로 읽어 낸 칸 경계다. 도면에 실제로 그어진
 * 선이므로, 여기에 붙는다는 것은 "도면에 맞춘다"는 뜻이다. 격자가 없으면(치수 없는
 * 스케치) 아무 일도 하지 않는다 — 없는 선에 붙이면 그건 도면을 고치는 것이다.
 */
export function snapToGrid(value: number, cuts: number[] | undefined, rangeMm: number): number {
  if (!cuts || cuts.length === 0 || rangeMm <= 0) return value;

  let best = value;
  /*
   * 처음 문턱을 범위로 두고, 더 가까운 선이 나올 때만 갈아탄다.
   *
   * 예전에는 `<=` 라서 같은 거리에 있는 두 선 중 **나중에 나온 것**이 이겼다.
   * 정확히 두 격자선 한가운데를 찍으면 왼쪽·오른쪽이 배열 순서에 따라 갈렸다 —
   * 같은 자리를 두 번 찍었는데 다른 데로 붙는 것처럼 보인다.
   */
  let bestGap = rangeMm + 1;

  for (const cut of cuts) {
    const gap = Math.abs(cut - value);
    if (gap <= rangeMm && gap < bestGap) {
      best = cut;
      bestGap = gap;
    }
  }

  return best;
}

/** 두 축을 함께 붙인다. 붙은 축을 함께 알려 준다 — 화면에 스냅 표시를 그려야 한다 */
export function snapPointToGrid(
  point: [number, number],
  grid: Underlay["gridMm"] | undefined,
  rangeMm: number
): { point: [number, number]; snappedX: boolean; snappedY: boolean } {
  if (!grid) return { point, snappedX: false, snappedY: false };

  const x = snapToGrid(point[0], grid.x, rangeMm);
  const y = snapToGrid(point[1], grid.y, rangeMm);

  return { point: [x, y], snappedX: x !== point[0], snappedY: y !== point[1] };
}

/* ───────────────────── 초기 정합 ───────────────────── */

/** 호출 A 가 함께 읽어 온 치수 체인의 이미지상 위치 (0~1 비율) */
export interface ChainPixels {
  /** 가로 체인 왼쪽 끝 / 오른쪽 끝의 x 비율 */
  leftRatio?: number;
  rightRatio?: number;
  /** 세로 체인 위 끝 / 아래 끝의 y 비율 */
  topRatio?: number;
  bottomRatio?: number;
}

const believableRatio = (value: unknown): number | null => {
  const ratio = Number(value);
  return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : null;
};

/**
 * 치수 체인이 이미지 어디에 그어져 있는지로 밑그림을 앉힌다.
 *
 * 격자 경로에서만 쓸 수 있다. 체인의 양 끝이 평면의 0 과 전체 폭에 해당한다는 것을
 * 이미 알고 있으므로, 그 두 쌍만 맞추면 축척과 위치가 한 번에 정해진다 — 사용자가
 * 두 점을 찍기 전에 이미 거의 맞아 있다.
 *
 * 가로·세로에서 나온 축척이 서로 다르면 평균을 쓴다. 이미지는 비율이 고정이라 축척이
 * 하나뿐인데, 모델이 읽은 두 비율이 조금씩 어긋나는 것은 흔하다. 어느 한쪽만 믿으면
 * 다른 축이 그만큼 밀리므로 반씩 나눠 진다.
 */
export function underlayFromChains(
  pixels: ChainPixels,
  image: ImageSize,
  plan: { widthMm: number; heightMm: number }
): Underlay | null {
  if (image.width <= 0 || image.height <= 0) return null;

  const left = believableRatio(pixels.leftRatio);
  const right = believableRatio(pixels.rightRatio);
  const top = believableRatio(pixels.topRatio);
  const bottom = believableRatio(pixels.bottomRatio);

  const horizontal =
    left !== null && right !== null && right - left > 0.05 && plan.widthMm > 0
      ? plan.widthMm / ((right - left) * image.width)
      : null;

  const vertical =
    top !== null && bottom !== null && bottom - top > 0.05 && plan.heightMm > 0
      ? plan.heightMm / ((bottom - top) * image.height)
      : null;

  const scales = [horizontal, vertical].filter((value): value is number => value !== null);
  if (scales.length === 0) return null;

  const mmPerPixel = scales.reduce((sum, value) => sum + value, 0) / scales.length;
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0) return null;

  /*
   * 체인 왼쪽 끝이 평면 x=0, 체인 아래 끝이 평면 y=0 이다.
   * 그 두 점을 이미지 픽셀로 되돌려 originMm 을 역산한다.
   */
  const originX = left !== null ? -left * image.width * mmPerPixel : 0;
  const originY =
    top !== null
      ? plan.heightMm + top * image.height * mmPerPixel
      : image.height * mmPerPixel;

  return {
    ...UNDERLAY_DEFAULTS,
    originMm: [Math.round(originX), Math.round(originY)],
    mmPerPixel,
  };
}

/**
 * 치수 체인이 없을 때 — 이미지를 방 크기에 대충 맞춰 놓는다.
 *
 * 여기서 맞는 값이 나올 리 없다. 사용자가 두 점을 찍어 맞출 출발점일 뿐이라, 화면
 * 어딘가에 보이기만 하면 된다. 아무 데도 안 보이면 "밑그림이 안 켜진다"고 읽힌다.
 */
export function underlayFitToRoom(
  image: ImageSize,
  dimensions: RoomSpec["dimensions"]
): Underlay | null {
  if (image.width <= 0 || image.height <= 0) return null;
  if (dimensions.width <= 0 || dimensions.length <= 0) return null;

  const mmPerPixel = Math.min(
    dimensions.width / image.width,
    dimensions.length / image.height
  );

  return {
    ...UNDERLAY_DEFAULTS,
    originMm: [
      Math.round((dimensions.width - image.width * mmPerPixel) / 2),
      Math.round((dimensions.length + image.height * mmPerPixel) / 2),
    ],
    mmPerPixel,
  };
}

/* ───────────────────── 값 다듬기 ───────────────────── */

/**
 * 부분 수정을 받아 온전한 밑그림 값으로 만든다.
 *
 * 편집기·AI 도구·서버가 모두 이 함수를 지나게 해서 말이 안 되는 값이 Scene 에
 * 저장되지 않게 한다 — 투명도 0 이나 mmPerPixel 0 이 한 번 저장되면 그 프로젝트는
 * 밑그림을 켜도 아무것도 안 보인다.
 */
export function normalizeUnderlay(
  patch: Partial<Underlay>,
  current: Underlay | null | undefined
): Underlay | null {
  const base: Underlay = current ?? {
    ...UNDERLAY_DEFAULTS,
    originMm: [0, 0],
    mmPerPixel: 1,
  };

  const merged: Underlay = { ...base, ...patch };

  const mmPerPixel = Number(merged.mmPerPixel);
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0) return null;

  const [x, y] = merged.originMm ?? [0, 0];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const opacity = Number.isFinite(merged.opacity) ? merged.opacity : UNDERLAY_DEFAULTS.opacity;
  const rotation = Number.isFinite(merged.rotation) ? merged.rotation : 0;

  return {
    originMm: [Math.round(x), Math.round(y)],
    mmPerPixel,
    // 기울어진 스캔을 눈으로 맞추는 용도라 ±5° 면 충분하다
    rotation: Math.min(Math.PI / 36, Math.max(-Math.PI / 36, rotation)),
    opacity: Math.min(OPACITY_RANGE.max, Math.max(OPACITY_RANGE.min, opacity)),
    visible: merged.visible !== false,
    locked: merged.locked === true,
    /*
     * 격자는 null 을 넣어 지울 수 있어야 한다.
     *
     * truthy 일 때만 담으면 { gridMm: null } 로 지우려 해도 예전 격자가 그대로 살아
     * 남는다. 축척을 다시 맞춘 뒤에는 예전 격자선이 더 이상 도면 위에 있지 않으므로
     * 지울 길이 있어야 한다.
     */
    ...(merged.gridMm === undefined ? {} : { gridMm: merged.gridMm }),
  };
}
