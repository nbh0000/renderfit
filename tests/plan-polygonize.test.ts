import { describe, expect, it } from "vitest";
import { polygonizeWalls, recomputeRooms, polygonArea } from "@/scene/planPolygonize";
import type { FloorPlanDoc, Point } from "@renderfit/plan-schema";

/**
 * 벽에서 방을 다시 만드는 계산.
 *
 * 검수 화면에서 벽을 끌면 방과 면적이 그 자리에서 바뀌어야 한다. 정답은 재서 얻은
 * 값이 아니라 **그려 넣은 값**이다 — 6m × 4m 로 그렸으면 24㎡ 여야 한다.
 */

const wall = (a: Point, b: Point) => ({ a, b });

/** 6000 × 4000 짜리 방 하나 */
const BOX = [
  wall([0, 0], [6000, 0]),
  wall([6000, 0], [6000, 4000]),
  wall([6000, 4000], [0, 4000]),
  wall([0, 4000], [0, 0]),
];

describe("polygonizeWalls", () => {
  it("닫힌 벽 하나에서 방 하나를 낸다", () => {
    const rooms = polygonizeWalls(BOX);

    expect(rooms).toHaveLength(1);
    expect(Math.abs(polygonArea(rooms[0]))).toBeCloseTo(24_000_000, 0);
  });

  it("가운데 벽을 세우면 방이 둘로 갈린다", () => {
    const rooms = polygonizeWalls([...BOX, wall([3000, 0], [3000, 4000])]);

    expect(rooms).toHaveLength(2);
    for (const room of rooms) {
      expect(Math.abs(polygonArea(room))).toBeCloseTo(12_000_000, 0);
    }
  });

  it("T 자로 닿는 벽도 잘라서 고리에 넣는다", () => {
    /* 가운데 벽이 아래 벽 중간에서 시작한다 — 안 자르면 방이 하나로 뭉친다 */
    const rooms = polygonizeWalls([...BOX, wall([2000, 0], [2000, 4000])]);

    expect(rooms).toHaveLength(2);
    const areas = rooms.map((room) => Math.abs(polygonArea(room))).sort((a, b) => a - b);
    expect(areas[0]).toBeCloseTo(8_000_000, 0);
    expect(areas[1]).toBeCloseTo(16_000_000, 0);
  });

  it("끝점이 조금 어긋나 있어도 같은 자리로 본다", () => {
    /* 손으로 끈 끝점은 딱 맞지 않는다. 안 붙이면 방이 통째로 사라진다 */
    const rooms = polygonizeWalls([
      wall([0, 0], [6000, 3]),
      wall([6000, 0], [6004, 4000]),
      wall([6000, 4000], [2, 3998]),
      wall([0, 4000], [3, 0]),
    ]);

    expect(rooms).toHaveLength(1);
  });

  it("벽이 닫히지 않으면 방을 만들지 않는다", () => {
    expect(polygonizeWalls(BOX.slice(0, 3))).toHaveLength(0);
  });

  it("바깥 테두리를 방으로 세지 않는다", () => {
    /* 방 둘짜리 도면에서 고리는 셋 나온다 — 안쪽 둘과 바깥 테두리 하나 */
    const rooms = polygonizeWalls([...BOX, wall([3000, 0], [3000, 4000])]);
    const total = rooms.reduce((sum, room) => sum + Math.abs(polygonArea(room)), 0);

    expect(total).toBeCloseTo(24_000_000, 0);
  });
});

function docOf(walls: { a: Point; b: Point }[], rooms: FloorPlanDoc["rooms"]): FloorPlanDoc {
  return {
    id: "doc_1",
    sourceType: "raster",
    scale: { mmPerUnit: 1, confidence: 1, source: "user" },
    bounds: { w: 6000, h: 4000 },
    walls: walls.map((item, index) => ({
      id: `wall_${index}`,
      a: item.a,
      b: item.b,
      thickness: 100,
      confidence: 1,
    })),
    openings: [],
    rooms,
    fixtures: [],
    annotations: [],
    review: { status: "auto", flags: [] },
  };
}

describe("recomputeRooms", () => {
  it("이름을 지키고 기하만 새로 낸다", () => {
    const before = docOf(BOX, [
      {
        id: "room_kitchen",
        polygon: [
          [0, 0],
          [6000, 0],
          [6000, 4000],
          [0, 4000],
        ],
        name: "주방",
        nameConfidence: 0.9,
        areaMm2: 24_000_000,
      },
    ]);

    /* 오른쪽 벽을 1m 당긴다 */
    const moved = {
      ...before,
      walls: before.walls.map((item) =>
        item.a[0] === 6000 || item.b[0] === 6000
          ? {
              ...item,
              a: [item.a[0] === 6000 ? 5000 : item.a[0], item.a[1]] as Point,
              b: [item.b[0] === 6000 ? 5000 : item.b[0], item.b[1]] as Point,
            }
          : item
      ),
    };

    const after = recomputeRooms(moved);

    expect(after.rooms).toHaveLength(1);
    expect(after.rooms[0].name).toBe("주방");
    expect(after.rooms[0].id).toBe("room_kitchen");
    expect(after.rooms[0].areaMm2).toBeCloseTo(20_000_000, 0);
  });

  it("벽이 닫히지 않는 동안에는 있던 방을 지우지 않는다", () => {
    /* 끌고 있는 도중에 방이 사라지면 무엇을 하는 중인지 알 수 없다 */
    const before = docOf(BOX.slice(0, 3), [
      { id: "room_a", polygon: [[0, 0], [6000, 0], [6000, 4000]], nameConfidence: 0, areaMm2: 1 },
    ]);

    expect(recomputeRooms(before).rooms).toHaveLength(1);
  });
});
