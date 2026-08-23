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
 * 도면에 그어진 치수선으로 방 크기를 되맞춘다.
 *
 * 모델은 글자는 잘 읽는데 선 길이는 자주 틀린다. 치수선이 있으면 그 숫자가 답이고,
 * 없으면 그림에서 읽은 폴리곤을 그대로 둔다.
 */
describe("치수선으로 방 되맞추기", () => {
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
          printedWidthMm: 6000,
          printedDepthMm: 3000,
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
          printedWidthMm: 3000,
          printedDepthMm: 2500,
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
          printedWidthMm: 3000,
          printedDepthMm: 2500,
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

  /** 실 폴리곤의 외접 사각형 (mm) */
  function sizeOf(room: RoomPlan["rooms"][number]) {
    const xs = room.polygon.map((p) => p.x);
    const ys = room.polygon.map((p) => p.y);
    return {
      width: Math.max(...xs) - Math.min(...xs),
      depth: Math.max(...ys) - Math.min(...ys),
    };
  }

  const fitted = repairPlan(squashed());

  it("얕게 읽힌 거실이 치수선대로 깊어진다", () => {
    const living = sizeOf(fitted.rooms.find((room) => room.name === "거실")!);
    expect(living.depth).toBeGreaterThan(2800);
    expect(living.depth).toBeLessThan(3200);
  });

  it("이미 맞던 침실은 크게 흔들리지 않는다", () => {
    for (const name of ["침실1", "침실2"]) {
      const bedroom = sizeOf(fitted.rooms.find((room) => room.name === name)!);
      expect(bedroom.width).toBeGreaterThan(2800);
      expect(bedroom.width).toBeLessThan(3200);
      expect(bedroom.depth).toBeGreaterThan(2300);
      expect(bedroom.depth).toBeLessThan(2700);
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

  it("치수선이 없으면 손대지 않는다 — 그림 그대로 간다", () => {
    const plain = squashed();
    for (const room of plain.rooms) {
      room.printedWidthMm = null;
      room.printedDepthMm = null;
    }

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

/**
 * 치수선이 그림을 이긴다.
 *
 * 모델이 그린 폴리곤은 눈대중이라 자주 어긋나지만, 치수선의 숫자는 도면에 적힌 그대로다.
 * 치수선이 없는 실은 그림에서 읽은 폴리곤을 그대로 둔다 — 지어내지 않는다.
 */
describe("치수선이 그림을 이긴다", () => {
  function twoRooms(left: Partial<RoomPlan["rooms"][number]>, right: Partial<RoomPlan["rooms"][number]>): RoomPlan {
    return {
      roomType: "living-room",
      ceilingHeightMm: 2400,
      cameraWallIndex: 0,
      outline: [
        { x: 0, y: 0 },
        { x: 6000, y: 0 },
        { x: 6000, y: 3000 },
        { x: 0, y: 3000 },
      ],
      rooms: [
        {
          name: "침실",
          type: "bedroom",
          polygon: [
            { x: 0, y: 0 },
            { x: 3000, y: 0 },
            { x: 3000, y: 3000 },
            { x: 0, y: 3000 },
          ],
          ...left,
        },
        {
          name: "거실",
          type: "living-room",
          polygon: [
            { x: 3000, y: 0 },
            { x: 6000, y: 0 },
            { x: 6000, y: 3000 },
            { x: 3000, y: 3000 },
          ],
          ...right,
        },
      ],
      walls: [],
      furniture: [],
    };
  }

  function size(plan: RoomPlan, name: string) {
    const room = plan.rooms.find((item) => item.name === name)!;
    const xs = room.polygon.map((p) => p.x);
    const ys = room.polygon.map((p) => p.y);
    return {
      width: Math.max(...xs) - Math.min(...xs),
      depth: Math.max(...ys) - Math.min(...ys),
    };
  }

  it("치수선이 있으면 그림이 아니라 그 값이 된다", () => {
    // 그림은 3000×3000인데 도면에는 2450×2520이라고 그어져 있다
    const fitted = repairPlan(twoRooms({ printedWidthMm: 2450, printedDepthMm: 2520 }, {}));

    const bedroom = size(fitted, "침실");
    expect(bedroom.width).toBeGreaterThan(2350);
    expect(bedroom.width).toBeLessThan(2550);
    expect(bedroom.depth).toBeGreaterThan(2420);
    expect(bedroom.depth).toBeLessThan(2620);
  });

  it("한쪽만 적혀 있으면 그 축만 고치고 나머지는 그림대로 둔다", () => {
    const fitted = repairPlan(twoRooms({ printedDepthMm: 2400 }, {}));

    const bedroom = size(fitted, "침실");
    expect(bedroom.depth).toBeGreaterThan(2300);
    expect(bedroom.depth).toBeLessThan(2500);
    // 폭은 치수선이 없으니 그림의 3000 그대로
    expect(bedroom.width).toBe(3000);
  });

  it("치수선이 없는 실은 그림 그대로 둔다", () => {
    const plain = twoRooms({}, {});
    const same = repairPlan(plain);

    expect(same.rooms[0].polygon).toEqual(plain.rooms[0].polygon);
    expect(same.rooms[1].polygon).toEqual(plain.rooms[1].polygon);
  });

  it("치수선이 있는 실 옆에서도 실끼리 붙어 있다", () => {
    const fitted = repairPlan(
      twoRooms({ printedWidthMm: 2450, printedDepthMm: 2520 }, { printedWidthMm: 3400 })
    );

    const bedroomRight = Math.max(...fitted.rooms[0].polygon.map((p) => p.x));
    const livingLeft = Math.min(...fitted.rooms[1].polygon.map((p) => p.x));
    expect(bedroomRight).toBe(livingLeft);
  });
});

describe("의자는 방을 건너뛰지 않는다", () => {
  /** 실제 스캔에서 모델이 변기를 chair로 분류해 거실 식탁으로 끌려갔다 */
  const twoRoomPlan: RoomPlan = {
    roomType: "living-room",
    ceilingHeightMm: 2400,
    cameraWallIndex: 0,
    outline: [
      { x: 0, y: 0 },
      { x: 8000, y: 0 },
      { x: 8000, y: 5000 },
      { x: 0, y: 5000 },
    ],
    rooms: [
      {
        name: "거실",
        type: "living-room",
        polygon: [
          { x: 0, y: 0 },
          { x: 8000, y: 0 },
          { x: 8000, y: 2500 },
          { x: 0, y: 2500 },
        ],
      },
      {
        name: "욕실",
        type: "bathroom",
        polygon: [
          { x: 6000, y: 2500 },
          { x: 8000, y: 2500 },
          { x: 8000, y: 5000 },
          { x: 6000, y: 5000 },
        ],
      },
    ],
    walls: [],
    furniture: [
      furniture({ type: "table", name: "식탁", xMm: 5500, yMm: 1200, widthMm: 1400, depthMm: 800 }),
      furniture({ type: "chair", name: "식탁 의자 1", xMm: 5500, yMm: 1200, widthMm: 450, depthMm: 500 }),
      furniture({ type: "chair", name: "식탁 의자 2", xMm: 5560, yMm: 1200, widthMm: 450, depthMm: 500 }),
      // 모델이 chair로 분류해 버린 변기
      furniture({ type: "chair", name: "욕실 변기", xMm: 4800, yMm: 400, widthMm: 700, depthMm: 400, rotationDeg: 270 }),
    ],
  };

  const repaired = repairPlan(twoRoomPlan).furniture;
  const toilet = repaired.find((item) => item.name === "욕실 변기")!;

  it("변기가 이름에 적힌 욕실로 간다", () => {
    expect(toilet.xMm).toBeGreaterThan(6000);
    expect(toilet.yMm).toBeGreaterThan(2500);
  });

  it("변기가 식탁 의자 사이에 앉지 않는다", () => {
    const chairs = repaired.filter((item) => item.name.startsWith("식탁 의자"));
    for (const chair of chairs) expect(overlaps(toilet, chair)).toBe(false);
  });

  it("잘못 분류돼 와도 변기 규격은 지킨다", () => {
    expect(toilet.widthMm).toBe(400);
    expect(toilet.depthMm).toBe(700);
  });
});

describe("남의 치수선은 버린다", () => {
  /**
   * 모델이 도면 전체 치수(6500×4530)를 거실 치수선으로 옮겨 적어 평면이 세로로 늘어났다.
   * 숫자를 잘못 읽는 일은 드물고 어느 실의 것인지를 헷갈리는 일이 잦다.
   */
  const misread: RoomPlan = {
    roomType: "living-room",
    ceilingHeightMm: 2400,
    cameraWallIndex: 0,
    outline: [
      { x: 0, y: 0 },
      { x: 6500, y: 0 },
      { x: 6500, y: 4500 },
      { x: 0, y: 4500 },
    ],
    rooms: [
      {
        name: "거실",
        type: "living-room",
        // 그림에서는 2000 깊이인데 치수선이 4530이라고 주장한다 (2.3배)
        printedWidthMm: 6500,
        printedDepthMm: 4530,
        polygon: [
          { x: 0, y: 0 },
          { x: 6500, y: 0 },
          { x: 6500, y: 2000 },
          { x: 0, y: 2000 },
        ],
      },
      {
        name: "침실",
        type: "bedroom",
        printedWidthMm: 2450,
        printedDepthMm: 2520,
        polygon: [
          { x: 0, y: 2000 },
          { x: 2400, y: 2000 },
          { x: 2400, y: 4500 },
          { x: 0, y: 4500 },
        ],
      },
    ],
    walls: [],
    furniture: [],
  };

  const fitted = repairPlan(misread);
  const depthOf = (name: string) => {
    const room = fitted.rooms.find((item) => item.name === name)!;
    const ys = room.polygon.map((p) => p.y);
    return Math.max(...ys) - Math.min(...ys);
  };

  it("그림과 2배 넘게 어긋나는 치수선은 안 쓴다", () => {
    // 4530을 그대로 믿었으면 거실만 4.5m 깊이가 됐다
    expect(depthOf("거실")).toBeLessThan(3000);
  });

  it("버린 자리는 그림이 그대로 남는다", () => {
    // 그림에서 읽은 2.0m를 지키고, 옆방 치수선에 딸려 조금 움직이는 정도만 허용한다
    expect(depthOf("거실")).toBeGreaterThan(1800);
  });

  it("그림과 맞는 치수선은 그대로 쓴다", () => {
    expect(depthOf("침실")).toBeGreaterThan(2400);
    expect(depthOf("침실")).toBeLessThan(2650);
  });
});
