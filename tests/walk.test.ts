import { describe, expect, it } from "vitest";
import {
  EYE_HEIGHT_MM,
  MAX_SUBSTEP_MM,
  PLAYER_RADIUS_MM,
  initialYaw,
  resolveWalk,
  roomNameAt,
  walkBlockers,
  walkSpawn,
} from "@/scene/walk";
import { BASE_LEVEL_ID, rectangleWalls } from "@/scene/geometry";
import { createEmptyScene } from "@/scene/serialization";
import type { Scene, SceneObject, WallOpening, WallSegment } from "@/scene/types";

/**
 * 걷기 모드는 "못 지나가야 할 곳을 못 지나가는가"가 전부다.
 *
 * 벽을 뚫고 나가면 공간의 크기를 확인할 수 없고, 모서리에 끼면 되돌아 나올 수가 없다.
 * 매 프레임 도는 계산이라 화면에서 눈으로 잡기가 어렵고, 잡아도 어느 숫자가 틀렸는지
 * 알 수 없다. 그래서 여기서 못 박아 둔다.
 *
 * 모든 좌표는 평면 좌표(mm)다 — 원점은 방 좌측 하단, y 는 도면 위쪽.
 */

/** 벽 두께 150 의 절반 + 사람 반지름 = 벽 중심선에서 설 수 있는 최소 거리 */
const CLEARANCE = PLAYER_RADIUS_MM + 75;

const ROOM = { width: 4000, length: 3000, height: 2400 };

/**
 * 4×3m 직사각 방.
 *
 * rectangleWalls 가 주는 벽 순서: 0 남(y=0), 1 동(x=4000), 2 북(y=3000), 3 서(x=0).
 */
function walls(patch?: (walls: WallSegment[]) => void): WallSegment[] {
  const made = rectangleWalls(ROOM);
  patch?.(made);
  return made;
}

function opening(patch: Partial<WallOpening> = {}): WallOpening {
  return {
    id: "op1",
    name: "방문",
    type: "door",
    offset: 1500,
    width: 900,
    height: 2100,
    sillHeight: 0,
    ...patch,
  };
}

function object(patch: Partial<SceneObject> = {}): SceneObject {
  return {
    id: "obj1",
    name: "소파",
    type: "sofa",
    category: "furniture",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    dimensions: { width: 1000, height: 800, depth: 600 },
    // screen.x 0.375 + width 0.25 → 중심 0.5 → cx 2000 / depth 0.5 → cy 1500
    screen: { x: 0.375, y: 0.4, width: 0.25, height: 0.3, rotation: 0 },
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

function scene(patch: Partial<Scene["room"]> = {}, objects: SceneObject[] = []): Scene {
  const base = createEmptyScene();
  return {
    ...base,
    room: { ...base.room, dimensions: ROOM, walls: walls(), ...patch },
    objects,
  };
}

/** blocker 중 이 점에서 가장 가까운 것까지의 거리 (halfThickness 를 뺀 값) */
function nearestGap(point: [number, number], list: ReturnType<typeof walkBlockers>): number {
  let best = Infinity;

  for (const item of list) {
    const abx = item.b[0] - item.a[0];
    const aby = item.b[1] - item.a[1];
    const lenSq = abx * abx + aby * aby;
    const t = lenSq === 0 ? 0 : Math.min(1, Math.max(0, ((point[0] - item.a[0]) * abx + (point[1] - item.a[1]) * aby) / lenSq));
    const qx = item.a[0] + abx * t;
    const qy = item.a[1] + aby * t;
    best = Math.min(best, Math.hypot(point[0] - qx, point[1] - qy) - item.halfThickness);
  }

  return best;
}

describe("사람의 치수", () => {
  it("눈높이는 서 있는 성인 기준이다", () => {
    // 키 1700 의 93.5% — 이 값이 틀리면 3D 에서 공간이 커 보이거나 작아 보인다
    expect(EYE_HEIGHT_MM).toBe(1590);
  });

  it("서브스텝이 사람 반지름보다 작다", () => {
    // 이 관계가 깨지면 한 프레임에 벽을 관통한다
    expect(MAX_SUBSTEP_MM).toBeLessThan(PLAYER_RADIUS_MM);
  });
});

describe("벽에 막힌다", () => {
  it("개구부 없는 방에서는 벽 앞에 선다", () => {
    // 막는 것: 북측 벽(y=3000). 벽 중심선에서 반지름+두께절반 앞에 멈춰야 한다
    const list = walkBlockers(scene(), BASE_LEVEL_ID);
    const [, y] = resolveWalk([2000, 1500], [2000, 5000], PLAYER_RADIUS_MM, list);

    expect(y).toBeCloseTo(3000 - CLEARANCE, 0);
  });

  it("한 번에 아주 멀리 가려 해도 벽을 뚫지 않는다", () => {
    // 막는 것: 북측 벽. 이동이 벽 두께의 백 배가 넘어도 서브스텝이 나눠 준다
    const list = walkBlockers(scene(), BASE_LEVEL_ID);
    const [, y] = resolveWalk([2000, 1500], [2000, 20000], PLAYER_RADIUS_MM, list);

    expect(y).toBeCloseTo(3000 - CLEARANCE, 0);
    expect(y).toBeLessThan(3000);
  });

  it("벽에 비스듬히 부딪히면 벽을 따라 미끄러진다", () => {
    // 막는 것: 북측 벽. 45도로 부딪히므로 y 는 막히고 x 는 계속 나아가야 한다
    const list = walkBlockers(scene(), BASE_LEVEL_ID);
    const [x, y] = resolveWalk([1000, 1500], [3000, 3500], PLAYER_RADIUS_MM, list);

    expect(x).toBeGreaterThan(1000);
    expect(y).toBeCloseTo(3000 - CLEARANCE, 0);
  });

  it("모서리에 대각선으로 밀어붙여도 끼지 않는다", () => {
    // 막는 것: 북측 벽과 동측 벽. 두 법선이 차례로 적용돼 모서리 안쪽에 남아야 한다
    const list = walkBlockers(scene(), BASE_LEVEL_ID);
    const point = resolveWalk([3500, 2500], [6000, 6000], PLAYER_RADIUS_MM, list);

    expect(point[0]).toBeLessThan(4000);
    expect(point[1]).toBeLessThan(3000);
    // 두 벽 모두에서 반지름 이상 떨어져 있어야 한다 (한쪽으로 튀어나가지 않았다)
    expect(nearestGap(point, list)).toBeGreaterThanOrEqual(PLAYER_RADIUS_MM - 0.5);
  });
});

describe("문은 지나가고 창은 막힌다", () => {
  const withDoor = () =>
    scene({
      // 북측 벽(index 2)에 문 하나 — sillHeight 0 이라 바닥에 닿는 벽 조각이 없다
      walls: walls((made) => {
        made[2].openings = [opening()];
      }),
    });

  it("문 앞에서는 벽을 넘어간다", () => {
    /*
     * 북측 벽은 (4000,3000) → (0,3000) 이라 offset 은 x 가 줄어드는 방향으로 잰다.
     * offset 1500~2400 은 x 2500~1600 구간이다. 그 한가운데인 x=2050 으로 지나간다.
     */
    const list = walkBlockers(withDoor(), BASE_LEVEL_ID);
    const [, y] = resolveWalk([2050, 1500], [2050, 4000], PLAYER_RADIUS_MM, list);

    expect(y).toBeGreaterThan(3000);
  });

  it("문에서 벗어난 자리는 여전히 막힌다", () => {
    // 막는 것: 문 옆에 남은 벽 조각
    const list = walkBlockers(withDoor(), BASE_LEVEL_ID);
    const [, y] = resolveWalk([500, 1500], [500, 4000], PLAYER_RADIUS_MM, list);

    expect(y).toBeCloseTo(3000 - CLEARANCE, 0);
  });

  it("같은 자리가 창이면 막힌다", () => {
    // 막는 것: 창 아래 하인방(bottom 0, top 900). 창턱은 넘어갈 수 없다
    const withWindow = scene({
      walls: walls((made) => {
        made[2].openings = [opening({ type: "window", sillHeight: 900, height: 1200 })];
      }),
    });

    const list = walkBlockers(withWindow, BASE_LEVEL_ID);
    const [, y] = resolveWalk([2050, 1500], [2050, 4000], PLAYER_RADIUS_MM, list);

    expect(y).toBeCloseTo(3000 - CLEARANCE, 0);
  });
});

describe("가구에 막힌다", () => {
  it("소파를 통과하지 못한다", () => {
    // 막는 것: 1000×600 소파의 왼쪽 변(x=1500). 중심 (2000,1500)
    const list = walkBlockers(scene({}, [object()]), BASE_LEVEL_ID);
    const [x] = resolveWalk([500, 1500], [3500, 1500], PLAYER_RADIUS_MM, list);

    expect(x).toBeCloseTo(1500 - PLAYER_RADIUS_MM, 0);
  });

  it("90도 돌리면 긴 변이 y 축을 막는다", () => {
    /*
     * 3D 는 rotation=[0, -θ, 0] 으로 그리고 worldXZ 가 y 를 뒤집는다. 둘을 합치면
     * 평면에서 꼭짓점은 (cx + u·cosθ - v·sinθ, cy - u·sinθ - v·cosθ) 가 된다.
     * θ=90 이면 폭 축(1000)이 y 로, 깊이 축(600)이 x 로 간다.
     *
     * ★ 이 시험만으로는 회전 "부호"를 잡지 못한다. 90도에서 부호를 뒤집으면 좌우가
     *   뒤집힌 거울상이 되는데, 중심이 같은 직사각형은 그 거울상과 구분되지 않는다.
     *   실제로 부호를 뒤집어 돌려 봤더니 이 시험이 그대로 통과했다.
     *   부호는 아래 30도 시험이 잡는다.
     */
    const turned = object({ screen: { x: 0.375, y: 0.4, width: 0.25, height: 0.3, rotation: 90 } });
    const list = walkBlockers(scene({}, [turned]), BASE_LEVEL_ID);

    // 위아래로는 폭 1000 이 가로막는다 → y 는 1500-500=1000 앞에서 멈춘다
    const [, y] = resolveWalk([2000, 200], [2000, 2800], PLAYER_RADIUS_MM, list);
    expect(y).toBeCloseTo(1000 - PLAYER_RADIUS_MM, 0);

    // 좌우로는 깊이 600 만 가로막는다 → x 는 2000-300=1700 앞에서 멈춘다
    const [x] = resolveWalk([500, 1500], [3500, 1500], PLAYER_RADIUS_MM, list);
    expect(x).toBeCloseTo(1700 - PLAYER_RADIUS_MM, 0);
  });

  it("30도 돌린 가구의 꼭짓점이 3D 렌더와 같은 자리에 온다", () => {
    /*
     * 회전 부호를 잡는 시험이다.
     *
     * 직각이 아닌 각도라야 부호가 드러난다. 90도에서는 부호를 뒤집어도 거울상이
     * 원래 사각형과 겹쳐 버려서 아무 차이가 없다.
     *
     * 3D 가 그리는 자리를 손으로 풀면 이렇다. three 의 Y 회전은 로컬 (lx, lz) 를
     *   wx = lx·cosφ + lz·sinφ,  wz = -lx·sinφ + lz·cosφ
     * 로 옮기고, ObjectMesh 는 φ = -θ 를 쓴다. worldXZ 는 cx = wx + W/2,
     * cy = L/2 - wz 이므로 평면 좌표에서는
     *   Δcx =  u·cosθ - v·sinθ
     *   Δcy = -u·sinθ - v·cosθ
     * 가 된다. 아래 값은 이 식에 u=+500, v=-300, θ=30 을 넣은 것이다.
     * 부호를 뒤집으면 (2283, 2010) 이 나와 확실히 어긋난다.
     */
    const tilted = object({ screen: { x: 0.375, y: 0.4, width: 0.25, height: 0.3, rotation: 30 } });
    const list = walkBlockers(scene({}, [tilted]), BASE_LEVEL_ID);
    const corners = list.filter((item) => item.source === "object").map((item) => item.a);

    const cos = Math.cos(Math.PI / 6);
    const sin = Math.sin(Math.PI / 6);
    const wantX = 2000 + 500 * cos + 300 * sin;
    const wantY = 1500 - 500 * sin + 300 * cos;

    const found = corners.some(
      ([x, y]) => Math.abs(x - wantX) < 0.5 && Math.abs(y - wantY) < 0.5
    );
    expect(found).toBe(true);
  });

  it("벽걸이와 천장등은 막지 않는다", () => {
    // 지나가는 길에 있는 것은 바닥에 놓인 것뿐이다
    const frame = object({ id: "frame", type: "decoration", name: "액자", metadata: { mounting: "wall" } });
    const light = object({ id: "light", type: "lamp", name: "천장등", metadata: { mounting: "ceiling" } });

    const list = walkBlockers(scene({}, [frame, light]), BASE_LEVEL_ID);
    expect(list.filter((item) => item.source === "object")).toHaveLength(0);
  });

  it("작은 소품은 무시한다", () => {
    // 100×100 화분에 걸려 못 지나가면 답답하다
    const pot = object({
      id: "pot",
      type: "plant",
      name: "화분",
      dimensions: { width: 100, height: 400, depth: 100 },
    });

    const list = walkBlockers(scene({}, [pot]), BASE_LEVEL_ID);
    expect(list.filter((item) => item.source === "object")).toHaveLength(0);
  });

  it("문·창 객체는 벽 개구부로 이미 처리되므로 빼놓는다", () => {
    const door = object({ id: "door1", type: "door", name: "방문", metadata: { mounting: "floor" } });
    const list = walkBlockers(scene({}, [door]), BASE_LEVEL_ID);
    expect(list.filter((item) => item.source === "object")).toHaveLength(0);
  });
});

describe("층", () => {
  it("위층 벽은 아래층에서 막지 않는다", () => {
    const upstairs = rectangleWalls(ROOM).map((wall) => ({ ...wall, levelId: "L2" }));
    const built = scene({
      levels: [
        { id: BASE_LEVEL_ID, name: "1층", elevation: 0, height: 2400 },
        { id: "L2", name: "2층", elevation: 2400, height: 2400 },
      ],
      walls: [...walls(), ...upstairs],
    });

    const ground = walkBlockers(built, BASE_LEVEL_ID);
    const second = walkBlockers(built, "L2");

    expect(ground.every((item) => item.sourceId.startsWith("wall"))).toBe(true);
    expect(ground).toHaveLength(4);
    expect(second).toHaveLength(4);
    // 서로 다른 벽이어야 한다
    expect(ground[0].sourceId).not.toBe(second[0].sourceId);
  });
});

describe("시작 위치와 실 이름", () => {
  const areas = [
    {
      id: "a1",
      name: "거실",
      points: [
        [0, 0],
        [4000, 0],
        [4000, 2000],
        [0, 2000],
      ] as [number, number][],
    },
    {
      id: "a2",
      name: "욕실",
      points: [
        [0, 2000],
        [1400, 2000],
        [1400, 3000],
        [0, 3000],
      ] as [number, number][],
    },
  ];

  it("가장 넓은 실의 한가운데에서 시작한다", () => {
    // 거실 8㎡ vs 욕실 1.4㎡ — 좁은 욕실에서 시작하면 벽밖에 안 보인다
    const point = walkSpawn(scene({ areas }), BASE_LEVEL_ID, PLAYER_RADIUS_MM);

    expect(point[0]).toBeCloseTo(2000, 0);
    expect(point[1]).toBeCloseTo(1000, 0);
  });

  it("실이 없으면 방 한가운데에서 시작한다", () => {
    const point = walkSpawn(scene(), BASE_LEVEL_ID, PLAYER_RADIUS_MM);

    expect(point[0]).toBeCloseTo(2000, 0);
    expect(point[1]).toBeCloseTo(1500, 0);
  });

  it("무게중심이 벽에 걸치면 벽에서 떨어뜨린다", () => {
    // 벽에 딱 붙은 좁고 긴 실 — 무게중심이 벽 두께 안에 들어간다
    const hugging = [
      {
        id: "a3",
        name: "복도",
        points: [
          [0, 0],
          [4000, 0],
          [4000, 200],
          [0, 200],
        ] as [number, number][],
      },
    ];

    const built = scene({ areas: hugging });
    const point = walkSpawn(built, BASE_LEVEL_ID, PLAYER_RADIUS_MM);

    expect(nearestGap(point, walkBlockers(built, BASE_LEVEL_ID))).toBeGreaterThanOrEqual(
      PLAYER_RADIUS_MM - 0.5
    );
  });

  it("점이 속한 실의 이름을 돌려준다", () => {
    const built = scene({ areas });

    expect(roomNameAt(built, BASE_LEVEL_ID, [2000, 1000])).toBe("거실");
    expect(roomNameAt(built, BASE_LEVEL_ID, [700, 2500])).toBe("욕실");
    // 방 밖은 어느 실도 아니다
    expect(roomNameAt(built, BASE_LEVEL_ID, [3000, 2500])).toBeNull();
  });

  it("실이 겹치면 좁은 쪽을 고른다", () => {
    // 거실 폴리곤 안에 주방이 따로 그려진 경우 — 주방에 서서 "거실"이라고 하면 안 된다
    const nested = [
      areas[0],
      {
        id: "a4",
        name: "주방",
        points: [
          [2500, 200],
          [3800, 200],
          [3800, 1200],
          [2500, 1200],
        ] as [number, number][],
      },
    ];

    expect(roomNameAt(scene({ areas: nested }), BASE_LEVEL_ID, [3000, 700])).toBe("주방");
  });
});

describe("시작 방향", () => {
  it("방 한가운데를 바라본다", () => {
    // 좌측 하단에서 시작하면 오른쪽 위(약 37도)를 본다
    const yaw = initialYaw(scene(), BASE_LEVEL_ID, [0, 0]);
    expect(yaw).toBeCloseTo(Math.atan2(1500, 2000), 5);
  });

  it("이미 한가운데면 도면 위쪽을 본다", () => {
    // 바라볼 곳이 없으므로 +y (평면 좌표계에서 π/2)
    expect(initialYaw(scene(), BASE_LEVEL_ID, [2000, 1500])).toBeCloseTo(Math.PI / 2, 5);
  });
});

describe("같은 입력에 같은 출력", () => {
  it("두 번 불러도 같은 blocker 가 나온다", () => {
    // 3D 뷰가 useMemo 로 들고 있어서, 매번 달라지면 프레임마다 다시 만든다
    const built = scene({}, [object()]);

    expect(walkBlockers(built, BASE_LEVEL_ID)).toEqual(walkBlockers(built, BASE_LEVEL_ID));
  });

  it("벽이 먼저, 가구가 나중에 온다", () => {
    const list = walkBlockers(scene({}, [object()]), BASE_LEVEL_ID);
    const firstObject = list.findIndex((item) => item.source === "object");
    const lastWall = list.map((item) => item.source).lastIndexOf("wall");

    expect(lastWall).toBeLessThan(firstObject);
  });
});
