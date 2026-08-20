import { describe, expect, it } from "vitest";
import {
  distanceToSegment,
  findEnclosingLoop,
  hitTest,
  itemsInMarquee,
  magnetToEndpoints,
  toObjectLocal,
  type HitContext,
} from "@/components/editor/Plan/hitTest";
import { rectangleWalls } from "@/scene/geometry";
import type { SceneObject } from "@/scene/types";

/**
 * 편집기 조작 품질은 히트 테스트에서 갈린다.
 * 벽 끝점을 잡으려는데 벽이 잡히거나, 회전 손잡이 대신 가구가 잡히면 도면을 그릴 수 없다.
 */

const walls = rectangleWalls({ width: 4000, length: 3000, height: 2400 });

function object(patch: Partial<SceneObject> = {}): SceneObject {
  return {
    id: "obj1",
    name: "소파",
    type: "sofa",
    category: "furniture",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    dimensions: { width: 2000, height: 800, depth: 900 },
    screen: { x: 0.25, y: 0.4, width: 0.5, height: 0.3, rotation: 0 },
    assetId: null,
    materialId: null,
    visibility: true,
    locked: false,
    mask: null,
    depth: 0.5,
    confidence: 1,
    source: "user",
    order: 0,
    metadata: {},
    ...patch,
  } as SceneObject;
}

function context(patch: Partial<HitContext> = {}): HitContext {
  return {
    walls,
    objects: [object()],
    areas: [],
    annotations: [],
    // screen 0.25~0.75 → 중심 0.5 → x 2000 / depth 0.5 → y 1500
    objectCenter: () => [2000, 1500],
    mmPerPixel: 20,
    selectedIds: [],
    ...patch,
  };
}

describe("기하 보조", () => {
  it("점에서 선분까지의 거리를 잰다", () => {
    expect(distanceToSegment([0, 100], [0, 0], [1000, 0])).toBe(100);
    // 선분 밖이면 가까운 끝점까지의 거리
    expect(distanceToSegment([-100, 0], [0, 0], [1000, 0])).toBe(100);
  });

  it("회전한 가구의 로컬 좌표로 옮긴다", () => {
    const [x, y] = toObjectLocal([1000, 0], [0, 0], 90);
    expect(Math.round(x)).toBe(0);
    expect(Math.round(y)).toBe(-1000);
  });
});

describe("히트 테스트 우선순위", () => {
  it("가구 안쪽을 누르면 가구가 잡힌다", () => {
    expect(hitTest([2000, 1500], context())).toEqual({
      kind: "object",
      id: "obj1",
      part: "body",
    });
  });

  it("벽 위를 누르면 벽이 잡힌다", () => {
    const hit = hitTest([2000, 0], context());
    expect(hit?.kind).toBe("wall");
    expect(hit?.part).toBe("body");
  });

  it("선택된 가구의 회전 손잡이가 본체보다 먼저 잡힌다", () => {
    // 가구 깊이 절반(450) + 회전 손잡이 오프셋(26px × 20mm)
    const hit = hitTest([2000, 1500 + 450 + 26 * 20], context({ selectedIds: ["obj1"] }));
    expect(hit).toEqual({ kind: "object", id: "obj1", part: "rotate" });
  });

  it("선택된 벽의 끝점이 벽 본체보다 먼저 잡힌다", () => {
    const wall = walls[0];
    const hit = hitTest(wall.start, context({ selectedIds: [wall.id] }));
    expect(hit).toEqual({ kind: "wall", id: wall.id, part: "start" });
  });

  it("빈 곳은 아무것도 잡히지 않는다", () => {
    expect(hitTest([9000, 9000], context())).toBeNull();
  });

  it("실은 가장 마지막이라 가구를 덮지 않는다", () => {
    const withArea = context({
      areas: [
        {
          id: "area1",
          name: "거실",
          points: [
            [0, 0],
            [4000, 0],
            [4000, 3000],
            [0, 3000],
          ],
        },
      ],
    });
    expect(hitTest([2000, 1500], withArea)?.kind).toBe("object");
    // 가구 밖 · 벽 안쪽이면 실이 잡힌다
    expect(hitTest([500, 1500], withArea)?.kind).toBe("area");
  });
});

describe("자석과 박스 선택", () => {
  it("가까운 벽 끝점에 정확히 붙는다", () => {
    expect(magnetToEndpoints([40, 30], walls, 100)).toEqual([0, 0]);
    expect(magnetToEndpoints([500, 500], walls, 100)).toBeNull();
  });

  it("박스 안에 완전히 들어온 것만 고른다", () => {
    const ids = itemsInMarquee([0, 0], [4000, 3000], context());
    expect(ids).toContain("obj1");
    expect(ids.length).toBeGreaterThan(1); // 벽도 포함

    expect(itemsInMarquee([0, 0], [100, 100], context())).not.toContain("obj1");
  });
});

describe("벽으로 둘러싸인 실 자동 인식", () => {
  it("사각형 벽 안쪽을 찍으면 고리를 찾는다", () => {
    const loop = findEnclosingLoop([2000, 1500], walls);
    expect(loop).not.toBeNull();
    expect(loop!.length).toBe(4);
  });

  it("벽 바깥이면 찾지 못한다", () => {
    expect(findEnclosingLoop([9000, 9000], walls)).toBeNull();
  });

  it("벽이 부족하면 찾지 못한다", () => {
    expect(findEnclosingLoop([100, 100], walls.slice(0, 2))).toBeNull();
  });
});
