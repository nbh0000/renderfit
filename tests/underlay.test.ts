import { describe, expect, it } from "vitest";
import { SceneEngine } from "@/scene/engine/SceneEngine";
import { rectangleWalls } from "@/scene/geometry";
import { buildPlanSvg, toPlanData } from "@/services/cadExport";
import {
  UNDERLAY_DEFAULTS,
  calibrateUnderlay,
  insideUnderlay,
  mmPerPixelFrom,
  normalizeUnderlay,
  snapPointToGrid,
  snapToGrid,
  underlayFitToRoom,
  underlayFromChains,
} from "@/scene/underlay";
import type { Scene, Underlay } from "@/scene/types";

/**
 * 평면 편집기 밑그림.
 *
 * 우리가 읽어 낸 도면이 원본과 다를 때 사용자가 고칠 방법이다 — 원본을 뒤에 깔고,
 * 두 점으로 축척을 맞추고, 그 위에서 벽을 끌어 맞춘다. 여기 있는 계산이 틀리면
 * 밑그림이 화면 밖으로 날아가거나 축척을 맞출수록 어긋난다.
 */

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    sceneId: "s",
    version: 1,
    room: {
      type: "거실",
      dimensions: { width: 8400, length: 8650, height: 2400 },
      walls: rectangleWalls({ width: 8400, length: 8650, height: 2400 }),
    },
    camera: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      fov: 50,
      near: 0.1,
      far: 100,
      projection: "perspective",
    },
    source: {
      imageUrl: "https://example.test/plan.png",
      kind: "floorplan",
      generatedImageUrl: null,
      depthMapUrl: null,
      segmentationUrl: null,
      width: 1200,
      height: 900,
    },
    objects: [],
    materials: [],
    lights: [],
    renderSettings: { resolution: [1024, 768], quality: "preview" },
    styleId: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const underlay = (patch: Partial<Underlay> = {}): Underlay => ({
  ...UNDERLAY_DEFAULTS,
  originMm: [0, 8650],
  mmPerPixel: 10,
  ...patch,
});

/* ── SceneEngine ── */

describe("setUnderlay — 되돌릴 수 있어야 한다", () => {
  it("깔고, 고치고, 되돌린다", () => {
    const engine = new SceneEngine(scene());

    expect(engine.setUnderlay({ originMm: [100, 8000], mmPerPixel: 8 }).ok).toBe(true);
    expect(engine.getScene().room.underlay?.mmPerPixel).toBe(8);

    /* 부분 수정 — 투명도만 바꿔도 나머지는 그대로다 */
    expect(engine.setUnderlay({ opacity: 0.6 }).ok).toBe(true);
    expect(engine.getScene().room.underlay).toMatchObject({
      originMm: [100, 8000],
      mmPerPixel: 8,
      opacity: 0.6,
    });

    /*
     * 맞추다 잘못 밀었을 때 되돌리기 한 번으로 돌아와야 한다.
     * 맞추는 일은 몇 번이고 다시 하게 되는 작업이라 더 그렇다.
     */
    engine.undo();
    expect(engine.getScene().room.underlay?.opacity).toBe(UNDERLAY_DEFAULTS.opacity);

    engine.undo();
    expect(engine.getScene().room.underlay).toBeUndefined();
  });

  it("걷어 내고 되돌리면 다시 깔린다", () => {
    const engine = new SceneEngine(scene());
    engine.setUnderlay({ originMm: [0, 8650], mmPerPixel: 10 });

    expect(engine.setUnderlay(null).ok).toBe(true);
    expect(engine.getScene().room.underlay).toBeNull();

    engine.undo();
    expect(engine.getScene().room.underlay?.mmPerPixel).toBe(10);
  });

  it("말이 안 되는 값은 저장되지 않는다", () => {
    const engine = new SceneEngine(scene());
    /* mmPerPixel 0 이 한 번 저장되면 그 프로젝트는 켜도 아무것도 안 보인다 */
    expect(engine.setUnderlay({ mmPerPixel: 0 }).ok).toBe(false);
    expect(engine.getScene().room.underlay).toBeUndefined();
  });
});

/* ── 축척 맞추기 ── */

describe("축척 맞추기", () => {
  it("300px 가 3400mm 면 픽셀당 11.33mm 다", () => {
    expect(mmPerPixelFrom(300, 3400)).toBeCloseTo(11.33, 2);
  });

  it("사람이 사는 크기가 아닌 길이는 받지 않는다", () => {
    expect(mmPerPixelFrom(300, 2)).toBeNull();
    expect(mmPerPixelFrom(0, 3400)).toBeNull();
  });

  it("첫 점은 제자리에 남는다 — 맞춘 자리가 화면 밖으로 달아나지 않게", () => {
    /* 픽셀당 1mm 로 깔려 있으면 평면 거리가 곧 픽셀 거리다 */
    const before = underlay({ originMm: [0, 1000], mmPerPixel: 1 });
    const from: [number, number] = [300, 1000];
    const to: [number, number] = [600, 1000];

    const after = calibrateUnderlay(before, from, to, 3400)!;

    expect(after.mmPerPixel).toBeCloseTo(3400 / 300, 3);

    /* 첫 점이 이미지의 어느 픽셀이었는지가 그대로여야 한다 */
    const pixelBefore = (from[0] - before.originMm[0]) / before.mmPerPixel;
    const pixelAfter = (from[0] - after.originMm[0]) / after.mmPerPixel;
    expect(pixelAfter).toBeCloseTo(pixelBefore, 3);
  });

  it("길이를 잘못 넣으면 아무것도 바꾸지 않는다", () => {
    const before = underlay({ mmPerPixel: 1 });
    expect(calibrateUnderlay(before, [0, 0], [300, 0], 0)).toBeNull();
  });
});

/* ── 격자 스냅 ── */

describe("격자 스냅", () => {
  const cuts = [0, 3400, 6000, 8400];

  it("가까운 격자선에 붙는다", () => {
    expect(snapToGrid(3380, cuts, 60)).toBe(3400);
  });

  it("멀면 그대로 둔다 — 도면에 없는 자리를 지어내지 않는다", () => {
    expect(snapToGrid(3200, cuts, 60)).toBe(3200);
  });

  it("격자가 없으면 아무 일도 하지 않는다", () => {
    expect(snapToGrid(3380, undefined, 60)).toBe(3380);
    expect(snapToGrid(3380, [], 60)).toBe(3380);
  });

  it("붙은 축을 알려 준다 — 어디에 붙었는지 보여야 도구가 된다", () => {
    const result = snapPointToGrid([3380, 500], { x: cuts, y: [0, 1000] }, 60);

    expect(result.point).toEqual([3400, 500]);
    expect(result.snappedX).toBe(true);
    expect(result.snappedY).toBe(false);
  });
});

/* ── 초기 정합 ── */

describe("초기 정합", () => {
  /*
   * 실제 도면의 값이다. 전용 8400×8650 평면이고, 치수 체인은 그림 안쪽에 그어져 있다 —
   * 가로 체인은 그림 폭의 10%~90%, 세로 체인은 높이의 8%~88% 자리다.
   */
  const pixels = { leftRatio: 0.1, rightRatio: 0.9, topRatio: 0.08, bottomRatio: 0.88 };
  const image = { width: 1200, height: 900 };
  const plan = { widthMm: 8400, heightMm: 8650 };

  it("체인 양 끝을 평면의 0 과 전체 폭에 맞춘다", () => {
    const placed = underlayFromChains(pixels, image, plan)!;

    /* originMm 은 정수 mm 로 떨어지므로 1mm 안쪽이면 맞은 것이다 — 벽 두께의 1/200 이다 */

    /* 체인 왼쪽 끝(그림 x=120px)이 평면 x=0 이어야 한다 */
    const chainLeftPlanX = placed.originMm[0] + 0.1 * image.width * placed.mmPerPixel;
    expect(Math.abs(chainLeftPlanX - 0)).toBeLessThanOrEqual(1);

    /* 체인 위쪽 끝(그림 y=72px)이 평면 y=8650 이어야 한다 */
    const chainTopPlanY = placed.originMm[1] - 0.08 * image.height * placed.mmPerPixel;
    expect(Math.abs(chainTopPlanY - 8650)).toBeLessThanOrEqual(1);
  });

  it("가로·세로 축척이 어긋나면 반씩 나눠 진다 — 이미지는 축척이 하나뿐이다", () => {
    const horizontal = 8400 / (0.8 * 1200);
    const vertical = 8650 / (0.8 * 900);
    const placed = underlayFromChains(pixels, image, plan)!;

    expect(placed.mmPerPixel).toBeCloseTo((horizontal + vertical) / 2, 4);
  });

  it("비율을 못 읽었으면 null — 지어낸 자리에 깔지 않는다", () => {
    expect(underlayFromChains({}, image, plan)).toBeNull();
    expect(underlayFromChains(pixels, { width: 0, height: 0 }, plan)).toBeNull();
  });

  it("치수 체인이 없으면 방 크기에 맞춰 대충 놓는다", () => {
    const placed = underlayFitToRoom(image, { width: 8400, length: 8650, height: 2400 })!;

    /* 방 안에 들어오기만 하면 된다 — 사용자가 두 점으로 맞출 출발점이다 */
    expect(image.width * placed.mmPerPixel).toBeLessThanOrEqual(8400 + 1);
    expect(image.height * placed.mmPerPixel).toBeLessThanOrEqual(8650 + 1);
  });
});

/* ── 내보내기 ── */

describe("내보내기", () => {
  it("평면도 SVG 에는 밑그림이 들어가지 않는다", () => {
    /*
     * 밑그림은 작업할 때 보는 참고 자료지 도면의 일부가 아니다. 도면집에 원본 스캔이
     * 반투명하게 겹쳐 나오면 그건 도면이 아니라 낙서다.
     */
    const withUnderlay = scene();
    withUnderlay.room.underlay = underlay();

    const svg = buildPlanSvg(toPlanData(withUnderlay, "테스트"));

    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("plan.png");
  });
});

/* ── 값 다듬기 ── */

describe("normalizeUnderlay", () => {
  it("투명도를 쓸 만한 범위로 가둔다", () => {
    expect(normalizeUnderlay({ opacity: 0 }, underlay())!.opacity).toBe(0.1);
    expect(normalizeUnderlay({ opacity: 5 }, underlay())!.opacity).toBe(0.8);
  });

  it("기울기는 ±5° 를 넘지 않는다 — 눈으로 맞추는 용도다", () => {
    expect(normalizeUnderlay({ rotation: 3 }, underlay())!.rotation).toBeCloseTo(Math.PI / 36, 6);
  });

  it("좌표는 정수 mm 로 떨어진다", () => {
    const result = normalizeUnderlay({ originMm: [10.7, -3.2] }, underlay())!;
    expect(result.originMm).toEqual([11, -3]);
  });
});

/* ── 잡기 판정 ── */

describe("insideUnderlay", () => {
  it("이미지가 덮은 사각형 안인지 본다 — 빈 곳 드래그로 밑그림을 잡을 때 쓴다", () => {
    const item = underlay({ originMm: [0, 9000], mmPerPixel: 10 });
    const image = { width: 1200, height: 900 };

    /* 평면으로 12000 × 9000, 왼쪽 위가 (0, 9000) 이므로 y 는 0~9000 */
    expect(insideUnderlay(item, image, [6000, 4500])).toBe(true);
    expect(insideUnderlay(item, image, [6000, 9500])).toBe(false);
    expect(insideUnderlay(item, image, [13000, 4500])).toBe(false);
  });
});
