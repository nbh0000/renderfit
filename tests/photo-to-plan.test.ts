import { describe, expect, it } from "vitest";
import { analysisToScene } from "@/services/projectService";
import { createEmptyScene } from "@/scene/serialization";
import { buildPlanSvg, toPlanData } from "@/services/cadExport";
import { buildElevationSvg } from "@/services/elevationExport";
import { mountingOf, planCenter } from "@/scene/placement";
import { toPlanAnalysis } from "@/ai/providers/vision";
import { wallLength } from "@/scene/geometry";

/**
 * 사진 → 평면도·입면도·3D.
 *
 * 예전에는 모델에게 화면 bbox와 depthRatio 하나만 받아 평면으로 되돌렸는데,
 * 그 역투영은 원리적으로 불가능했다 — 카메라에서 멀어지며 뻗은 유리 칸막이벽은
 * 사진 속 폭이 실제 길이와 무관하다. 지금은 모델이 도면 좌표(mm)로 바로 답한다.
 *
 * 아래 값은 사무실 사진 한 장으로 gemini-3.5-flash가 실제로 돌려준 평면이다.
 */
const RAW_PLAN = {
  roomType: "home-office",
  ceilingHeightMm: 2800,
  cameraWallIndex: 0,
  outline: [
    { x: 0, y: 0 },
    { x: 8000, y: 0 },
    { x: 8000, y: 12000 },
    { x: 0, y: 12000 },
  ],
  walls: [
    { name: "카메라 뒤쪽 벽", thicknessMm: 200, openings: [] },
    {
      name: "우측 유리창 벽",
      thicknessMm: 200,
      openings: [
        {
          kind: "glass-partition",
          name: "우측 유리 칸막이",
          offsetMm: 1000,
          widthMm: 10000,
          heightMm: 2600,
          sillMm: 100,
        },
      ],
    },
    {
      name: "정면 벽",
      thicknessMm: 200,
      openings: [
        { kind: "door", name: "사무실 문", offsetMm: 6200, widthMm: 900, heightMm: 2100, sillMm: 0 },
      ],
    },
    {
      name: "좌측 유리창 벽",
      thicknessMm: 200,
      openings: [
        // 벽(12000)보다 긴 개구부 — 벽을 무너뜨리지 않게 잘려 들어와야 한다
        {
          kind: "glass-partition",
          name: "좌측 유리 칸막이",
          offsetMm: 2200,
          widthMm: 14000,
          heightMm: 2600,
          sillMm: 100,
        },
      ],
    },
  ],
  furniture: [
    {
      type: "lamp",
      name: "천장 매입등",
      xMm: 1500,
      yMm: 2000,
      rotationDeg: 0,
      widthMm: 600,
      depthMm: 600,
      heightMm: 50,
      elevationMm: 2750,
      mountedOn: "ceiling",
    },
    {
      type: "table",
      name: "회의 테이블",
      xMm: 4000,
      yMm: 6000,
      rotationDeg: 90,
      widthMm: 3600,
      depthMm: 1200,
      heightMm: 740,
      elevationMm: 0,
      mountedOn: "floor",
    },
  ],
};

const analysis = toPlanAnalysis(RAW_PLAN)!;
const scene = analysisToScene(createEmptyScene(), analysis);
const room = scene.room;

describe("사진에서 복원한 평면", () => {
  it("방 크기와 외곽선이 분석 결과를 따른다", () => {
    expect(room.dimensions).toEqual({ width: 8000, length: 12000, height: 2800 });
    expect(room.walls).toHaveLength(4);
    expect(room.areas?.[0]?.points).toEqual([
      [0, 0],
      [8000, 0],
      [8000, 12000],
      [0, 12000],
    ]);
  });

  it("유리 칸막이벽이 옆벽에 벽 길이만큼 앉는다", () => {
    const right = room.walls!.find((wall) => wall.name === "우측 유리창 벽")!;
    const partition = right.openings[0];

    expect(partition.type).toBe("window");
    expect(partition.width).toBe(10000);
    // 예전 bbox 방식에서는 사진 속 폭(수백 mm)으로 줄어들었다
    expect(partition.width).toBeGreaterThan(wallLength(right) * 0.7);
  });

  it("벽보다 긴 개구부는 벽 안으로 잘려 들어온다", () => {
    for (const wall of room.walls ?? []) {
      const length = wallLength(wall);
      for (const opening of wall.openings) {
        expect(opening.offset).toBeGreaterThanOrEqual(0);
        expect(opening.offset + opening.width).toBeLessThanOrEqual(length);
      }
    }
  });

  it("문은 문으로, 하단은 바닥에 붙는다", () => {
    const front = room.walls!.find((wall) => wall.name === "정면 벽")!;
    expect(front.openings[0].type).toBe("door");
    expect(front.openings[0].sillHeight).toBe(0);
  });
});

describe("평면 → 가구 배치", () => {
  const find = (name: string) => scene.objects.find((object) => object.name === name)!;

  it("가구가 도면 좌표 그대로 놓인다", () => {
    const table = find("회의 테이블");
    const center = planCenter(table.screen, table.depth, room);

    expect(Math.round(center.cx)).toBe(4000);
    expect(Math.round(center.cy)).toBe(6000);
    expect(table.screen.rotation).toBe(90);
  });

  it("천장등은 천장에 매달린 것으로 표시된다", () => {
    const lamp = find("천장 매입등");
    expect(mountingOf(lamp)).toBe("ceiling");
    // 바닥에서 물체 중심까지 = 2750 + 50/2 = 2775mm
    expect(lamp.transform.position[1]).toBeCloseTo(2.775, 3);
  });
});

describe("도면 산출물", () => {
  it("평면도와 입면도가 깨지지 않는다", () => {
    const plan = toPlanData(scene, "사진 분석");
    expect(plan.roomWidth).toBe(8000);
    expect(plan.objects.map((object) => object.name)).toContain("회의 테이블");

    const wall = plan.walls.find((item) => item.openings.length > 0)!;
    const elevation = buildElevationSvg({ plan, wall });
    expect(elevation).not.toContain("NaN");
  });
});

/**
 * 다실 평면.
 *
 * 예전에는 외곽선 하나 = 실 하나였다. 그래서 24평 아파트 도면을 넣으면
 * 24평짜리 원룸이 나왔다 — 거실도 방도 주방도 구분되지 않았다.
 */
const APARTMENT = {
  roomType: "living-room",
  ceilingHeightMm: 2400,
  cameraWallIndex: 0,
  outline: [
    { x: 0, y: 0 },
    { x: 8000, y: 0 },
    { x: 8000, y: 9000 },
    { x: 0, y: 9000 },
  ],
  rooms: [
    { name: "거실", type: "living-room", polygon: [{ x: 0, y: 0 }, { x: 4800, y: 0 }, { x: 4800, y: 5000 }, { x: 0, y: 5000 }] },
    { name: "안방", type: "bedroom", polygon: [{ x: 4800, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 4000 }, { x: 4800, y: 4000 }] },
    { name: "주방", type: "kitchen", polygon: [{ x: 0, y: 5000 }, { x: 4800, y: 5000 }, { x: 4800, y: 9000 }, { x: 0, y: 9000 }] },
    { name: "욕실", type: "bathroom", polygon: [{ x: 4800, y: 4000 }, { x: 8000, y: 4000 }, { x: 8000, y: 9000 }, { x: 4800, y: 9000 }] },
  ],
  walls: [
    { name: "남측 외벽", start: { x: 0, y: 0 }, end: { x: 8000, y: 0 }, thicknessMm: 200, openings: [] },
    { name: "동측 외벽", start: { x: 8000, y: 0 }, end: { x: 8000, y: 9000 }, thicknessMm: 200, openings: [] },
    { name: "북측 외벽", start: { x: 8000, y: 9000 }, end: { x: 0, y: 9000 }, thicknessMm: 200, openings: [] },
    { name: "서측 외벽", start: { x: 0, y: 9000 }, end: { x: 0, y: 0 }, thicknessMm: 200, openings: [] },
    // 내벽 — 이게 있어야 아파트가 아파트다
    {
      name: "거실·안방 사이", start: { x: 4800, y: 0 }, end: { x: 4800, y: 9000 }, thicknessMm: 100,
      openings: [{ kind: "door", name: "안방 문", offsetMm: 1000, widthMm: 900, heightMm: 2100, sillMm: 0 }],
    },
    { name: "거실·주방 사이", start: { x: 0, y: 5000 }, end: { x: 4800, y: 5000 }, thicknessMm: 100, openings: [] },
  ],
  furniture: [],
};

describe("다실 평면", () => {
  const apartment = analysisToScene(createEmptyScene(), toPlanAnalysis(APARTMENT)!);

  it("실이 하나로 뭉개지지 않는다", () => {
    expect(apartment.room.areas).toHaveLength(4);
    expect(apartment.room.areas!.map((area) => area.name)).toEqual([
      "거실",
      "안방",
      "주방",
      "욕실",
    ]);
  });

  it("실 경계마다 벽이 선다", () => {
    // 모델이 준 벽(6개)만 쓰지 않고 실 경계에서 계산하므로 더 촘촘하다.
    const walls = apartment.room.walls!;
    expect(walls.length).toBeGreaterThanOrEqual(APARTMENT.rooms.length * 2);

    // 거실과 안방을 가르는 x=4800 선 위의 내벽이 있어야 한다
    const partition = walls.filter(
      (wall) => wall.start[0] === 4800 && wall.end[0] === 4800
    );
    expect(partition.length).toBeGreaterThan(0);
  });

  it("모델이 준 개구부가 계산된 벽으로 옮겨 붙는다", () => {
    // 벽을 다시 짜면서 창·문을 잃어버리면 도면이 통째로 못 쓰게 된다.
    const doors = apartment
      .room.walls!.flatMap((wall) => wall.openings)
      .filter((opening) => opening.type === "door");
    expect(doors.map((door) => door.name)).toContain("안방 문");
  });

  it("평면도에 실마다 이름과 면적이 찍힌다", () => {
    const svg = buildPlanSvg(toPlanData(apartment, "아파트"));
    for (const name of ["거실", "안방", "주방", "욕실"]) expect(svg).toContain(name);
    expect(svg).not.toContain("NaN");
  });

  it("전체 크기는 외곽선을 따른다", () => {
    expect(apartment.room.dimensions.width).toBe(8000);
    expect(apartment.room.dimensions.length).toBe(9000);
  });
});
