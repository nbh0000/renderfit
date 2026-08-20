import { describe, expect, it } from "vitest";
import { deriveOpenings, projectOntoWall, rescaleOpenings } from "@/scene/openings";
import { rectangleWalls } from "@/scene/geometry";
import type { RoomSpec, SceneObject, WallOpening } from "@/scene/types";

/**
 * 실측 치수를 넣으면 사진 속 방 구조 그대로 도면이 나와야 한다.
 * 화면 좌표에만 있던 창·문이 벽 개구부로 옮겨지는지, 치수를 바꿔도 남는지 확인한다.
 */

const room: RoomSpec = {
  type: "거실",
  dimensions: { width: 4000, length: 3000, height: 2400 },
  walls: rectangleWalls({ width: 4000, length: 3000, height: 2400 }),
};

function object(patch: Partial<SceneObject>): SceneObject {
  return {
    id: "obj1",
    name: "창문",
    type: "window",
    category: "room",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    dimensions: { width: 1500, height: 1200, depth: 200 },
    screen: { x: 0.3, y: 0.2, width: 0.3, height: 0.35, rotation: 0 },
    assetId: null,
    materialId: null,
    visibility: true,
    locked: false,
    mask: null,
    depth: 0.95,
    confidence: 0.9,
    source: "vision_model",
    order: 0,
    metadata: {},
    ...patch,
  } as SceneObject;
}

describe("벽 투영", () => {
  it("점을 벽 위로 내리고 시작점 기준 거리를 준다", () => {
    const wall = room.walls![0]; // 남측 (0,0) → (4000,0)
    const { distance, offset } = projectOntoWall(wall, [1200, 500]);
    expect(offset).toBeCloseTo(1200, 0);
    expect(distance).toBeCloseTo(500, 0);
  });
});

describe("사진 속 창·문 → 개구부", () => {
  it("가장 가까운 벽에 개구부로 붙는다", () => {
    const { walls, added } = deriveOpenings(room, [object({})]);
    expect(added).toBe(1);

    const withOpening = walls.find((wall) => (wall.openings ?? []).length > 0)!;
    // depth 0.95 → 안쪽(북측) 벽
    expect(withOpening.name).toBe("북측 벽");

    const opening = withOpening.openings[0];
    expect(opening.type).toBe("window");
    expect(opening.width).toBe(1500);
    expect(opening.height).toBe(1200);
    // 화면상 아래쪽 45% 지점이 창 하단 → 2400 × 0.45 = 1080
    expect(opening.sillHeight).toBeCloseTo(1080, -2);
  });

  it("문은 바닥에 붙는다", () => {
    const { walls } = deriveOpenings(room, [
      object({ id: "d1", name: "방문", type: "door", dimensions: { width: 900, height: 2100, depth: 100 } }),
    ]);
    const opening = walls.flatMap((wall) => wall.openings ?? [])[0];
    expect(opening.type).toBe("door");
    expect(opening.sillHeight).toBe(0);
    expect(opening.hinge).toBe("start");
  });

  it("여러 번 실행해도 개구부가 중복되지 않는다", () => {
    const once = deriveOpenings(room, [object({})]);
    const twice = deriveOpenings({ ...room, walls: once.walls }, [object({})]);
    expect(twice.walls.flatMap((wall) => wall.openings ?? [])).toHaveLength(1);
  });

  it("손으로 넣은 개구부는 지우지 않는다", () => {
    const manual: WallOpening = {
      id: "op_manual",
      name: "손으로 넣은 창",
      type: "window",
      offset: 100,
      width: 600,
      height: 900,
      sillHeight: 900,
    };
    const walls = room.walls!.map((wall, index) =>
      index === 0 ? { ...wall, openings: [manual] } : wall
    );
    const { walls: next } = deriveOpenings({ ...room, walls }, [object({})]);
    expect(next.flatMap((wall) => wall.openings ?? []).map((o) => o.id)).toContain("op_manual");
  });

  it("숨긴 객체는 반영하지 않는다", () => {
    const { added } = deriveOpenings(room, [object({ visibility: false })]);
    expect(added).toBe(0);
  });
});

describe("치수를 바꿔도 개구부가 남는다", () => {
  const openings: WallOpening[] = [
    { id: "a", name: "창", type: "window", offset: 1000, width: 1500, height: 1200, sillHeight: 900 },
  ];

  it("벽이 짧아지면 비율대로 줄어든다", () => {
    const next = rescaleOpenings(openings, 4000, 3000, 2400);
    expect(next).toHaveLength(1);
    expect(next[0].offset).toBe(750);
    expect(next[0].width).toBe(1125);
  });

  it("벽이 길어져도 벽 안에 남는다", () => {
    const next = rescaleOpenings(openings, 4000, 6000, 2400);
    expect(next[0].offset + next[0].width).toBeLessThanOrEqual(6000);
  });
});
