import { describe, expect, it } from "vitest";
import { repairPlan } from "@/scene/planRepair";
import type { PlanFurniture, RoomPlan } from "@/ai/providers/types";

/**
 * 도면 스캔 결과 다듬기.
 *
 * 아래 값들은 실제 아파트 평면도 한 장을 gemini-3.5-flash에 넣었을 때 나온 것과 같은
 * 모양의 오류다 — 2.45×2.52m 침실에 폭 2.4m 침대가 들어왔고, 식탁 의자 넷이 식탁과
 * 같은 좌표에 쌓여 있었다.
 */
function furniture(overrides: Partial<PlanFurniture>): PlanFurniture {
  return {
    type: "bed",
    name: "침대",
    xMm: 1000,
    yMm: 1000,
    rotationDeg: 0,
    widthMm: 1500,
    depthMm: 2000,
    heightMm: 500,
    elevationMm: 0,
    mountedOn: "floor",
    material: null,
    color: null,
    ...overrides,
  };
}

function plan(items: PlanFurniture[], rooms?: RoomPlan["rooms"]): RoomPlan {
  return {
    roomType: "living-room",
    ceilingHeightMm: 2400,
    cameraWallIndex: 0,
    outline: [
      { x: 0, y: 0 },
      { x: 8000, y: 0 },
      { x: 8000, y: 9000 },
      { x: 0, y: 9000 },
    ],
    rooms: rooms ?? [
      {
        name: "거실",
        type: "living-room",
        polygon: [
          { x: 0, y: 0 },
          { x: 8000, y: 0 },
          { x: 8000, y: 9000 },
          { x: 0, y: 9000 },
        ],
      },
    ],
    walls: [],
    furniture: items,
  };
}

/** 돌려 놓은 뒤 평면에서 차지하는 사각형 */
function box(item: PlanFurniture) {
  const turned = item.rotationDeg % 180 !== 0;
  const width = turned ? item.depthMm : item.widthMm;
  const depth = turned ? item.widthMm : item.depthMm;
  return {
    x0: item.xMm - width / 2,
    y0: item.yMm - depth / 2,
    x1: item.xMm + width / 2,
    y1: item.yMm + depth / 2,
  };
}

function overlaps(a: PlanFurniture, b: PlanFurniture): boolean {
  const one = box(a);
  const two = box(b);
  return one.x0 < two.x1 && two.x0 < one.x1 && one.y0 < two.y1 && two.y0 < one.y1;
}

const BEDROOM: RoomPlan["rooms"] = [
  {
    name: "침실1",
    type: "bedroom",
    polygon: [
      { x: 0, y: 0 },
      { x: 2450, y: 0 },
      { x: 2450, y: 2520 },
      { x: 0, y: 2520 },
    ],
  },
];

describe("가구 규격 되돌리기", () => {
  it("이름에 적힌 규격이 잘못 읽은 치수를 이긴다", () => {
    const [bed] = repairPlan(
      plan([furniture({ name: "퀸 침대", widthMm: 2400, depthMm: 1700 })])
    ).furniture;

    expect(bed.widthMm).toBe(1500);
    expect(bed.depthMm).toBe(2000);
  });

  it("범위 안의 실측은 그대로 존중한다", () => {
    // 1600×2050은 흔한 킹 규격이다 — 우리 표준으로 덮어쓰면 안 된다
    const [bed] = repairPlan(
      plan([furniture({ name: "침대", widthMm: 1600, depthMm: 2050 })])
    ).furniture;

    expect(bed.widthMm).toBe(1600);
    expect(bed.depthMm).toBe(2050);
  });

  it("종류만 아는 것도 말이 안 되는 치수는 되돌린다", () => {
    const [chair] = repairPlan(
      plan([furniture({ type: "chair", name: "의자", widthMm: 2600, depthMm: 40 })])
    ).furniture;

    expect(chair.widthMm).toBeLessThanOrEqual(900);
    expect(chair.depthMm).toBeGreaterThanOrEqual(300);
  });
});

describe("방 안에 앉히기", () => {
  it("방보다 큰 침대가 방 안으로 들어온다", () => {
    const [bed] = repairPlan(
      plan(
        [furniture({ name: "침대", xMm: 1200, yMm: 1200, widthMm: 2400, depthMm: 1700, rotationDeg: 90 })],
        BEDROOM
      )
    ).furniture;

    const rect = box(bed);
    expect(rect.x0).toBeGreaterThanOrEqual(0);
    expect(rect.y0).toBeGreaterThanOrEqual(0);
    expect(rect.x1).toBeLessThanOrEqual(2450);
    expect(rect.y1).toBeLessThanOrEqual(2520);
  });

  it("침대가 벽에 등을 대고 선다", () => {
    const [bed] = repairPlan(
      plan([furniture({ name: "퀸 침대", xMm: 1225, yMm: 1400, rotationDeg: 45 })], BEDROOM)
    ).furniture;

    // 도면 가구는 직각으로 놓인다
    expect([0, 90, 180, 270]).toContain(bed.rotationDeg);

    // 어느 한 벽에는 붙어 있어야 한다
    const rect = box(bed);
    const gaps = [rect.x0, rect.y0, 2450 - rect.x1, 2520 - rect.y1];
    expect(Math.min(...gaps)).toBeLessThanOrEqual(100);
  });

  it("벽에 걸린 것은 바닥 규칙을 적용하지 않는다", () => {
    const [tv] = repairPlan(
      plan([
        furniture({
          type: "tv",
          name: "벽걸이 TV",
          mountedOn: "wall",
          xMm: 4000,
          yMm: 8950,
          elevationMm: 1100,
          widthMm: 1300,
          depthMm: 80,
        }),
      ])
    ).furniture;

    expect(tv.xMm).toBe(4000);
    expect(tv.yMm).toBe(8950);
    expect(tv.elevationMm).toBe(1100);
  });
});

describe("식탁과 의자", () => {
  const table = furniture({
    type: "table",
    name: "식탁",
    xMm: 5000,
    yMm: 4500,
    widthMm: 1500,
    depthMm: 900,
    heightMm: 740,
  });

  // 모델이 실제로 이렇게 준다 — 의자 넷이 식탁과 같은 자리에 쌓인다
  const chairs = [0, 1, 2, 3].map((index) =>
    furniture({
      type: "chair",
      name: `식탁 의자 ${index + 1}`,
      xMm: 5000 + index * 60,
      yMm: 4500,
      widthMm: 450,
      depthMm: 500,
      heightMm: 900,
    })
  );

  const repaired = repairPlan(plan([table, ...chairs])).furniture;
  const seated = repaired.filter((item) => item.type === "chair");
  const dining = repaired.find((item) => item.type === "table")!;

  it("의자가 식탁 위에 올라타지 않는다", () => {
    for (const chair of seated) expect(overlaps(chair, dining)).toBe(false);
  });

  it("의자끼리도 겹치지 않는다", () => {
    for (let a = 0; a < seated.length; a += 1) {
      for (let b = a + 1; b < seated.length; b += 1) {
        expect(overlaps(seated[a], seated[b])).toBe(false);
      }
    }
  });

  it("긴 변을 따라 양쪽에 나눠 앉는다", () => {
    const above = seated.filter((chair) => chair.yMm > dining.yMm);
    const below = seated.filter((chair) => chair.yMm < dining.yMm);
    expect(above).toHaveLength(2);
    expect(below).toHaveLength(2);
  });

  it("의자가 식탁을 바라본다", () => {
    for (const chair of seated) {
      // 0도는 정면이 y가 작아지는 쪽 — 식탁 위쪽 의자는 0도, 아래쪽 의자는 180도
      expect(chair.rotationDeg).toBe(chair.yMm > dining.yMm ? 0 : 180);
    }
  });
});

describe("남은 겹침 풀기", () => {
  it("한 방에 몰아넣은 가구가 서로 떨어진다", () => {
    const items = [
      furniture({ name: "퀸 침대", xMm: 3000, yMm: 3000 }),
      furniture({ type: "cabinet", name: "붙박이장", xMm: 3000, yMm: 3000, widthMm: 1800, depthMm: 600 }),
      furniture({ type: "sofa", name: "3인 소파", xMm: 3100, yMm: 3100, widthMm: 2100, depthMm: 900 }),
    ];

    const repaired = repairPlan(plan(items)).furniture;

    for (let a = 0; a < repaired.length; a += 1) {
      for (let b = a + 1; b < repaired.length; b += 1) {
        expect(overlaps(repaired[a], repaired[b])).toBe(false);
      }
    }
  });

  it("깔개는 가구 밑에 그대로 둔다", () => {
    const repaired = repairPlan(
      plan([
        furniture({ type: "rug", name: "러그", xMm: 4000, yMm: 4000, widthMm: 2000, depthMm: 1400, heightMm: 15 }),
        furniture({ type: "table", name: "거실 테이블", xMm: 4000, yMm: 4000, widthMm: 1100, depthMm: 600 }),
      ])
    ).furniture;

    const rug = repaired.find((item) => item.type === "rug")!;
    expect(rug.xMm).toBe(4000);
    expect(rug.yMm).toBe(4000);
  });
});

/**
 * 도면에 적힌 면적으로 되맞추기.
 *
 * 실제 도면 한 장에서 24.1㎡라고 적힌 거실을 6500×2010(13.1㎡)으로 읽어 왔다.
 * 그 깊이로는 소파와 식탁을 어떻게 놓아도 겹친다 — 가구를 앉히기 전에 방부터 고쳐야 한다.
 */
describe("도면에 적힌 면적으로 방 되맞추기", () => {
  /** 위에 침실 둘, 아래에 거실 하나 — 아래 띠만 실제보다 얕게 읽혔다 */
  function squashed(): RoomPlan {
    return {
      roomType: "living-room",
      ceilingHeightMm: 2400,
      cameraWallIndex: 0,
      outline: [
        { x: 0, y: 0 },
        { x: 6000, y: 0 },
        { x: 6000, y: 4500 },
        { x: 0, y: 4500 },
      ],
      rooms: [
        {
          name: "거실",
          type: "living-room",
          areaSqm: 24,
          polygon: [
            { x: 0, y: 0 },
            { x: 6000, y: 0 },
            { x: 6000, y: 2000 },
            { x: 0, y: 2000 },
          ],
        },
        {
          name: "침실1",
          type: "bedroom",
          areaSqm: 7.5,
          polygon: [
            { x: 0, y: 2000 },
            { x: 3000, y: 2000 },
            { x: 3000, y: 4500 },
            { x: 0, y: 4500 },
          ],
        },
        {
          name: "침실2",
          type: "bedroom",
          areaSqm: 7.5,
          polygon: [
            { x: 3000, y: 2000 },
            { x: 6000, y: 2000 },
            { x: 6000, y: 4500 },
            { x: 3000, y: 4500 },
          ],
        },
      ],
      walls: [
        {
          name: "남측 외벽",
          start: { x: 0, y: 0 },
          end: { x: 6000, y: 0 },
          thicknessMm: 200,
          openings: [
            {
              kind: "window",
              name: "거실 창",
              offsetMm: 1000,
              widthMm: 2000,
              heightMm: 1400,
              sillMm: 600,
            },
          ],
        },
      ],
      furniture: [],
    };
  }

  /** 실 폴리곤의 외접 사각형 면적 (㎡) */
  function areaOf(room: RoomPlan["rooms"][number]) {
    const xs = room.polygon.map((p) => p.x);
    const ys = room.polygon.map((p) => p.y);
    return ((Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))) / 1_000_000;
  }

  const fitted = repairPlan(squashed());

  it("얕게 읽힌 거실이 적힌 면적에 가까워진다", () => {
    const living = fitted.rooms.find((room) => room.name === "거실")!;
    expect(areaOf(living)).toBeGreaterThan(20);
    expect(areaOf(living)).toBeLessThan(28);
  });

  it("이미 맞던 침실은 크게 흔들리지 않는다", () => {
    for (const name of ["침실1", "침실2"]) {
      const bedroom = fitted.rooms.find((room) => room.name === name)!;
      expect(areaOf(bedroom)).toBeGreaterThan(6);
      expect(areaOf(bedroom)).toBeLessThan(9.5);
    }
  });

  it("실끼리 벌어지거나 겹치지 않는다 — 거실 위가 그대로 침실이다", () => {
    const living = fitted.rooms.find((room) => room.name === "거실")!;
    const bedroom = fitted.rooms.find((room) => room.name === "침실1")!;
    const livingTop = Math.max(...living.polygon.map((p) => p.y));
    const bedroomBottom = Math.min(...bedroom.polygon.map((p) => p.y));
    expect(livingTop).toBe(bedroomBottom);
  });

  it("창이 벽 안에 남는다", () => {
    const wall = fitted.walls[0];
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    const opening = wall.openings[0];
    expect(opening.offsetMm).toBeGreaterThanOrEqual(0);
    expect(opening.offsetMm + opening.widthMm).toBeLessThanOrEqual(Math.round(length));
  });

  it("면적이 안 적혀 있으면 손대지 않는다", () => {
    const plain = squashed();
    for (const room of plain.rooms) room.areaSqm = null;

    const same = repairPlan(plain);
    expect(same.rooms[0].polygon).toEqual(plain.rooms[0].polygon);
    expect(same.outline).toEqual(plain.outline);
  });
});

describe("이름 규칙이 종류를 가린다", () => {
  it("식탁 의자는 식탁 규격을 물려받지 않는다", () => {
    // 이름에 '식탁'이 들어 있어 1500×900짜리 의자가 만들어지던 버그
    const [chair] = repairPlan(
      plan([
        furniture({
          type: "chair",
          name: "식탁 의자 1",
          widthMm: 1500,
          depthMm: 900,
        }),
      ])
    ).furniture;

    expect(chair.widthMm).toBe(450);
    expect(chair.depthMm).toBe(500);
  });

  it("욕조는 가전 범위를 넘어도 제 길이를 지킨다", () => {
    const [tub] = repairPlan(
      plan([furniture({ type: "appliance", name: "욕조", widthMm: 800, depthMm: 750 })])
    ).furniture;

    expect(tub.depthMm).toBe(1700);
  });
});
