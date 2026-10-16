import { describe, expect, it } from "vitest";
import type { FloorPlanDoc, Point } from "@renderfit/plan-schema";
import {
  centerOn,
  fitView,
  reasonText,
  squareMetres,
  targetLabel,
  toPlan,
  toScreen,
  zoomAt,
} from "@/components/plan/planView";

/**
 * 검수 화면의 좌표 변환.
 *
 * 도면은 y 가 **위로** 커지고 화면은 아래로 커진다. 이 뒤집기를 한 번이라도 빠뜨리면
 * 도면이 뒤집힌 채 검수를 통과하므로, 여기만은 숫자로 못박아 둔다.
 */

const VIEW = { scale: 0.1, originX: 0, originY: 4000 };

describe("좌표 변환", () => {
  it("도면 좌하단이 화면 왼쪽 아래로 간다", () => {
    /* 도면 (0, 0) 은 화면에서 아래쪽이다 */
    expect(toScreen(VIEW, [0, 0])).toEqual([0, 400]);
    expect(toScreen(VIEW, [0, 4000])).toEqual([0, 0]);
  });

  it("갔다 오면 제자리다", () => {
    const point: Point = [1234, 2345];
    const [x, y] = toScreen(VIEW, point);
    const back = toPlan(VIEW, x, y);

    expect(back[0]).toBeCloseTo(point[0], 6);
    expect(back[1]).toBeCloseTo(point[1], 6);
  });

  it("확대해도 마우스가 가리키던 자리는 그대로다", () => {
    /* 안 그러면 확대할 때마다 보던 곳이 화면 밖으로 달아난다 */
    const before = toPlan(VIEW, 300, 200);
    const zoomed = zoomAt(VIEW, 2, 300, 200);
    const after = toPlan(zoomed, 300, 200);

    expect(after[0]).toBeCloseTo(before[0], 6);
    expect(after[1]).toBeCloseTo(before[1], 6);
    expect(zoomed.scale).toBeCloseTo(0.2, 6);
  });
});

const DOC = {
  bounds: { w: 10_000, h: 8000 },
  walls: [{ id: "w1", a: [0, 0], b: [1, 1], thickness: 100, confidence: 1 }],
  rooms: [
    { id: "r1", polygon: [], name: "주방", nameConfidence: 1, areaMm2: 0 },
    { id: "r2", polygon: [], nameConfidence: 0, areaMm2: 0 },
  ],
  openings: [{ id: "o1", wallId: "w1", kind: "door", offset: 0, width: 900, confidence: 1 }],
  fixtures: [
    {
      id: "f1",
      kind: "sink",
      bbox: [0, 0, 1, 1],
      rotation: 0,
      source: "ocr-label",
      confidence: 1,
    },
  ],
} as unknown as FloorPlanDoc;

describe("화면 맞추기", () => {
  it("도면 전체가 화면 안에 들어온다", () => {
    const view = fitView(DOC, 800, 600);

    const bottomLeft = toScreen(view, [0, 0]);
    const topRight = toScreen(view, [10_000, 8000]);

    for (const [x, y] of [bottomLeft, topRight]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(800);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(600);
    }
  });

  it("가운데로 옮기면 그 자리가 화면 한가운데다", () => {
    const view = centerOn(fitView(DOC, 800, 600), [2000, 6000], 800, 600);
    const [x, y] = toScreen(view, [2000, 6000]);

    expect(x).toBeCloseTo(400, 6);
    expect(y).toBeCloseTo(300, 6);
  });
});

describe("지적 문구", () => {
  it("짧은 말을 사람 말로 바꾼다", () => {
    expect(reasonText("low-confidence-wall")).toContain("벽");
    /* 모르는 이유라도 지워 버리지 않는다 — 무엇이든 보여 줘야 짚을 수 있다 */
    expect(reasonText("무슨-새-이유")).toBe("무슨-새-이유");
  });

  it("무엇에 대한 지적인지 알려 준다", () => {
    expect(targetLabel(DOC, "w1")).toBe("벽");
    expect(targetLabel(DOC, "o1")).toBe("문·창");
    expect(targetLabel(DOC, "f1")).toBe("설비");
    expect(targetLabel(DOC, "r1")).toBe("주방");
    expect(targetLabel(DOC, "r2")).toBe("방");
    expect(targetLabel(DOC, "scale")).toBe("축척");
  });

  it("면적은 ㎡ 로 보여 준다", () => {
    expect(squareMetres(24_000_000)).toBe("24.0㎡");
  });
});
