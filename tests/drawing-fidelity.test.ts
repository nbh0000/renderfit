import { describe, expect, it } from "vitest";
import { repairPlan } from "@/scene/planRepair";
import { toPlanAnalysis } from "@/ai/providers/vision";
import type { RoomPlan } from "@/ai/providers/types";

/**
 * 도면을 마구잡이로 보정하지 않는다.
 *
 * 사진과 도면은 정반대다. 사진에는 정답이 없어서 모델이 짐작한 값을 상식으로 걸러
 * 줘야 하지만, 도면은 그 자체가 정답이다. 현관이 좁게 그려져 있으면 좁은 게 맞고,
 * 책상이 벽에서 떨어져 있으면 떨어져 있는 게 맞다. 우리가 "보기 좋게" 고치면 그건
 * 더 이상 그 도면이 아니다.
 *
 * 실제로 그랬다. 치수선이 하나도 없는 도면에서 모델이 12000×4800, 3600×4200 같은
 * 그럴싸하게 반올림된 숫자를 지어냈고, 우리는 그것을 "도면에 적힌 치수"로 믿고
 * 평면을 그쪽으로 늘렸다. 도면에 그어져 있지도 않은 치수에 맞춰 방 크기가 바뀐 것이다.
 */

/** 벽에서 떨어진 좁은 현관과, 규격에서 벗어난 책상 하나 */
function drawnPlan(): RoomPlan {
  return {
    roomType: "home-office",
    ceilingHeightMm: 2400,
    cameraWallIndex: 0,
    outline: [
      { x: 0, y: 0 },
      { x: 6000, y: 0 },
      { x: 6000, y: 5000 },
      { x: 0, y: 5000 },
    ],
    rooms: [
      {
        name: "현관",
        type: "entrance",
        polygon: [
          { x: 0, y: 0 },
          { x: 1100, y: 0 },
          { x: 1100, y: 1400 },
          { x: 0, y: 1400 },
        ],
        printedWidthMm: null,
        printedDepthMm: null,
      },
      {
        name: "사무실",
        type: "home-office",
        polygon: [
          { x: 1100, y: 0 },
          { x: 6000, y: 0 },
          { x: 6000, y: 5000 },
          { x: 1100, y: 5000 },
        ],
        printedWidthMm: null,
        printedDepthMm: null,
      },
    ],
    walls: [],
    furniture: [
      {
        type: "table",
        name: "제작 책상",
        // 표준 책상(1400×700)에서 한참 벗어난 크기 — 도면에 그렇게 그려져 있다
        xMm: 3000,
        yMm: 2500,
        rotationDeg: 0,
        widthMm: 2600,
        depthMm: 500,
        heightMm: 720,
        elevationMm: 0,
        mountedOn: "floor",
        material: null,
        color: null,
      },
    ],
  };
}

describe("도면은 그린 대로 둔다", () => {
  it("가구 치수를 표준 규격으로 되돌리지 않는다", () => {
    const drawn = drawnPlan();
    const kept = repairPlan(drawn, "drawing");

    expect(kept.furniture[0].widthMm).toBe(2600);
    expect(kept.furniture[0].depthMm).toBe(500);
  });

  it("가구를 벽으로 끌어다 붙이지 않는다", () => {
    const drawn = drawnPlan();
    const kept = repairPlan(drawn, "drawing");

    expect(kept.furniture[0].xMm).toBe(3000);
    expect(kept.furniture[0].yMm).toBe(2500);
  });

  it("실 폴리곤을 건드리지 않는다 — 좁은 현관은 좁은 채로", () => {
    const drawn = drawnPlan();
    const kept = repairPlan(drawn, "drawing");

    expect(kept.rooms[0].polygon).toEqual(drawn.rooms[0].polygon);
    expect(kept.outline).toEqual(drawn.outline);
  });

  it("사진일 때는 예전처럼 상식으로 앉힌다", () => {
    const guessed = repairPlan(drawnPlan(), "photo");

    // 표준 책상 규격 쪽으로 당겨져야 한다 — 사진에는 정답이 없기 때문이다
    expect(guessed.furniture[0].widthMm).toBeLessThan(2600);
  });
});

describe("적혀 있지 않은 치수는 쓰지 않는다", () => {
  /** 치수선이 하나도 없는 도면에서 모델이 반올림된 숫자를 지어낸 상황 */
  const raw = {
    roomType: "home-office",
    ceilingHeightMm: 2600,
    cameraWallIndex: 0,
    outline: [
      { x: 0, y: 0 },
      { x: 5000, y: 0 },
      { x: 5000, y: 4000 },
      { x: 0, y: 4000 },
    ],
    rooms: [
      {
        name: "사무실",
        type: "home-office",
        polygon: [
          { x: 0, y: 0 },
          { x: 5000, y: 0 },
          { x: 5000, y: 4000 },
          { x: 0, y: 4000 },
        ],
        // 도면에는 없는데 모델이 지어낸 숫자
        printedWidthMm: 12000,
        printedDepthMm: 9000,
      },
    ],
    walls: [],
    furniture: [],
  };

  it("치수선 읽기가 아무것도 못 찾았으면 본문 숫자를 믿지 않는다", () => {
    const analysis = toPlanAnalysis(raw as never, [], {
      fromDrawing: true,
      readerRan: true,
    });

    const room = analysis!.plan!.rooms[0];
    expect(room.printedWidthMm).toBeNull();
    expect(room.printedDepthMm).toBeNull();

    // 지어낸 12000 쪽으로 늘어나지 않고 그림 그대로 5000 이어야 한다
    expect(analysis!.roomDimensions.width).toBe(5000);
  });
});
