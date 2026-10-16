import { describe, expect, it, vi } from "vitest";
import { PLAYER_RADIUS_MM, resolveWalk, walkBlockers, walkSpawn } from "@/scene/walk";
import { BASE_LEVEL_ID, rectangleWalls } from "@/scene/geometry";
import { createEmptyScene } from "@/scene/serialization";
import type { Scene, SceneObject } from "@/scene/types";

/**
 * 걷기가 망가진 자료를 만났을 때.
 *
 * 실제 프로젝트에는 벽이 없는 장면, 층이 어긋난 벽, 가구가 사방을 막은 실이 다 있다.
 * 그럴 때 조용히 바닥 밖으로 걸어 나가거나 가구에 파묻힌 채 시작하면, 사용자는
 * 무엇이 잘못됐는지 알 수 없고 우리도 재현할 수 없다.
 */

const ROOM = { width: 4000, length: 3000, height: 2400 };

/**
 * 시험용 장면.
 *
 * createEmptyScene 은 기본 치수(5000×6000)의 벽을 이미 들고 있다. 치수만 바꾸고 벽을
 * 그대로 두면 벽은 큰 방 것이라 엉뚱한 것을 재게 된다 — 실제로 그래서 "좁은 방에서
 * 벽을 뚫었다"는 거짓 실패가 났다. 치수를 바꾸면 벽도 함께 새로 만든다.
 */
function scene(patch: Partial<Scene["room"]> = {}, objects: SceneObject[] = []): Scene {
  const base = createEmptyScene();
  const dimensions = patch.dimensions ?? ROOM;
  return {
    ...base,
    room: {
      ...base.room,
      dimensions,
      walls: rectangleWalls(dimensions),
      ...patch,
    },
    objects,
  };
}

function object(patch: Partial<SceneObject> = {}): SceneObject {
  return {
    id: "obj1",
    name: "테이블",
    type: "table",
    category: "furniture",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    dimensions: { width: 3600, height: 750, depth: 2600 },
    screen: { x: 0.05, y: 0.4, width: 0.9, height: 0.3, rotation: 0 },
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

describe("벽이 없을 때", () => {
  it("벽 배열이 비어 있으면 방 테두리가 막는다", () => {
    // ensureRoom 이 직사각형을 만들어 준다
    const list = walkBlockers(scene({ walls: [] }), BASE_LEVEL_ID);
    expect(list.filter((item) => item.source === "wall").length).toBeGreaterThanOrEqual(4);
  });

  it("벽이 전부 다른 층이면 그 층에 테두리를 세운다", () => {
    /*
     * ensureRoom 은 이 경우를 못 걸러 준다 — 벽이 있긴 있기 때문이다.
     * 막는 것이 하나도 없으면 바닥 밖으로 걸어 나간다.
     */
    const upstairs = rectangleWalls(ROOM).map((wall) => ({ ...wall, levelId: "L2" }));
    const built = scene({
      walls: upstairs,
      levels: [
        { id: BASE_LEVEL_ID, name: "1층", elevation: 0, height: 2400 },
        { id: "L2", name: "2층", elevation: 2400, height: 2400 },
      ],
    });

    const ground = walkBlockers(built, BASE_LEVEL_ID);
    expect(ground.length).toBeGreaterThanOrEqual(4);

    // 실제로 막히는지 — 바깥으로 걸어 나가지 못해야 한다
    const [, y] = resolveWalk([2000, 1500], [2000, 9000], PLAYER_RADIUS_MM, ground);
    expect(y).toBeLessThan(3000);
  });
});

describe("시작 자리가 막혀 있을 때", () => {
  it("테이블 위에서 시작하지 않는다", () => {
    /*
     * 실제로 났던 일 — 회의 테이블 위에서 시작해 갇혔다.
     *
     * 가구는 네 변만 막는다. 그래서 큰 테이블 한가운데는 어느 변에서도 반지름 밖이라
     * "침투"가 아니다. 5단계에서 이걸 보고 "갇힌 게 아니다"라고 적었는데 틀렸다 —
     * 침투는 아니지만 네 변에 둘러싸여 어느 쪽으로도 못 나간다. 안에서 변에 다가가면
     * 안쪽으로 도로 밀리기 때문이다.
     *
     * 그래서 시작 자리는 침투 여부와 별개로 "가구 안인가"를 따로 본다.
     */
    const built = scene({}, [object()]);
    const [x, y] = walkSpawn(built, BASE_LEVEL_ID, PLAYER_RADIUS_MM);

    expect(Number.isFinite(x)).toBe(true);
    expect(x).toBeGreaterThan(0);
    expect(x).toBeLessThan(ROOM.width);
    expect(y).toBeGreaterThan(0);
    expect(y).toBeLessThan(ROOM.length);
  });

  it("작은 가구 위에서 시작하면 옆으로 비켜선다", () => {
    // 스폰 자리에 딱 걸친 협탁 — 변에서 반지름 안이라 밀려나야 한다
    const stool = object({
      id: "stool",
      name: "협탁",
      dimensions: { width: 400, height: 500, depth: 400 },
      screen: { x: 0.45, y: 0.4, width: 0.1, height: 0.2, rotation: 0 },
    });

    const built = scene({}, [stool]);
    const list = walkBlockers(built, BASE_LEVEL_ID);
    const spawn = walkSpawn(built, BASE_LEVEL_ID, PLAYER_RADIUS_MM);

    /** 어느 blocker 와도 반지름만큼 떨어져 있어야 한다 */
    for (const item of list) {
      const abx = item.b[0] - item.a[0];
      const aby = item.b[1] - item.a[1];
      const lenSq = abx * abx + aby * aby;
      const t = Math.min(1, Math.max(0, ((spawn[0] - item.a[0]) * abx + (spawn[1] - item.a[1]) * aby) / lenSq));
      const gap = Math.hypot(spawn[0] - (item.a[0] + abx * t), spawn[1] - (item.a[1] + aby * t));
      expect(gap).toBeGreaterThanOrEqual(PLAYER_RADIUS_MM + item.halfThickness - 0.5);
    }
  });

  it("가구가 없으면 경고하지 않는다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    walkSpawn(scene(), BASE_LEVEL_ID, PLAYER_RADIUS_MM);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("아주 작은 방", () => {
  it("1.5×1.5m 화장실에도 설 자리가 있다", () => {
    // 벽 두께 150 의 절반 + 사람 반지름 230 = 305. 1500 - 610 = 890 이 남는다
    const tiny = scene({ dimensions: { width: 1500, length: 1500, height: 2300 } });
    const [x, y] = walkSpawn(tiny, BASE_LEVEL_ID, PLAYER_RADIUS_MM);

    expect(x).toBeGreaterThan(300);
    expect(x).toBeLessThan(1200);
    expect(y).toBeGreaterThan(300);
    expect(y).toBeLessThan(1200);
  });

  it("좁은 방에서도 벽을 뚫지 않는다", () => {
    const tiny = scene({ dimensions: { width: 1500, length: 1500, height: 2300 } });
    const list = walkBlockers(tiny, BASE_LEVEL_ID);
    const [x, y] = resolveWalk([750, 750], [5000, 5000], PLAYER_RADIUS_MM, list);

    expect(x).toBeLessThan(1500);
    expect(y).toBeLessThan(1500);
  });
});

describe("가구 안에서 시작하지 않는다", () => {
  it("방 한가운데 큰 테이블이 있으면 옆으로 비켜서 시작한다", () => {
    /*
     * 회의 테이블(2.4×1.2m)이 방 한가운데 있는 사무실. 실 무게중심이 곧 테이블
     * 한가운데라, 그대로 두면 상판 위에서 시작해 갇힌다.
     */
    const table = object({
      id: "table",
      name: "회의 테이블",
      dimensions: { width: 2400, height: 750, depth: 1200 },
      screen: { x: 0.2, y: 0.4, width: 0.6, height: 0.3, rotation: 0 },
    });

    const built = scene({}, [table]);
    const spawn = walkSpawn(built, BASE_LEVEL_ID, PLAYER_RADIUS_MM);

    /** 테이블이 차지하는 범위 — 중심 (2000,1500), 2400×1200 */
    const inside =
      spawn[0] > 800 && spawn[0] < 3200 && spawn[1] > 900 && spawn[1] < 2100;

    expect(inside).toBe(false);
  });

  it("비켜선 자리도 방 안이고 벽에서 떨어져 있다", () => {
    const table = object({
      id: "table",
      name: "회의 테이블",
      dimensions: { width: 2400, height: 750, depth: 1200 },
      screen: { x: 0.2, y: 0.4, width: 0.6, height: 0.3, rotation: 0 },
    });

    const built = scene({}, [table]);
    const spawn = walkSpawn(built, BASE_LEVEL_ID, PLAYER_RADIUS_MM);
    const list = walkBlockers(built, BASE_LEVEL_ID);

    for (const item of list) {
      const abx = item.b[0] - item.a[0];
      const aby = item.b[1] - item.a[1];
      const lenSq = abx * abx + aby * aby;
      const t = Math.min(1, Math.max(0, ((spawn[0] - item.a[0]) * abx + (spawn[1] - item.a[1]) * aby) / lenSq));
      const gap = Math.hypot(spawn[0] - (item.a[0] + abx * t), spawn[1] - (item.a[1] + aby * t));
      expect(gap).toBeGreaterThanOrEqual(PLAYER_RADIUS_MM + item.halfThickness - 0.5);
    }
  });
});
