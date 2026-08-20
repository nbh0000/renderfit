import { describe, expect, it } from "vitest";
import { buildDxf, buildPlanSvg, doorNote, electricalPoint, toPlanData } from "@/services/cadExport";
import { buildElevationSvg, fixturesOnWall } from "@/services/elevationExport";
import { rectangleWalls } from "@/scene/geometry";
import type { Scene, WallOpening } from "@/scene/types";

/**
 * 평면도·입면도는 시공자가 보고 작업하는 산출물이라,
 * "문이 어느 쪽으로 열리는가"와 "설비를 몇 mm에 다는가"가 도면에 실제로 찍히는지 확인한다.
 */

function sceneWith(openings: WallOpening[]): Scene {
  const walls = rectangleWalls({ width: 4000, length: 3000, height: 2400 });
  walls[0] = { ...walls[0], openings };

  return {
    sceneId: "test",
    version: 1,
    room: {
      type: "거실",
      dimensions: { width: 4000, length: 3000, height: 2400 },
      walls,
      electrical: [
        {
          id: "fx1",
          name: "콘센트",
          kind: "outlet",
          wallId: walls[0].id,
          offset: 1200,
          height: 300,
        },
        {
          id: "fx2",
          name: "스위치",
          kind: "switch",
          wallId: walls[0].id,
          offset: 2600,
          height: 1200,
        },
        { id: "fx3", name: "천장 조명", kind: "ceiling-light", wallId: null, offset: 0, height: 2400 },
      ],
    },
    camera: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      fov: 50,
      near: 0.1,
      far: 100,
      projection: "perspective",
    },
    source: {
      imageUrl: null,
      generatedImageUrl: null,
      depthMapUrl: null,
      segmentationUrl: null,
      width: 1024,
      height: 768,
    },
    objects: [],
    materials: [],
    lights: [],
    renderSettings: { resolution: [1024, 768], quality: "preview" },
    styleId: null,
    updatedAt: new Date().toISOString(),
  };
}

const door: WallOpening = {
  id: "op1",
  name: "현관문",
  type: "door",
  offset: 500,
  width: 900,
  height: 2100,
  sillHeight: 0,
  doorType: "hinged",
  hinge: "end",
  swing: "out",
};

describe("문 열림 표기", () => {
  it("경첩과 열림 방향을 주기로 남긴다", () => {
    expect(doorNote(door)).toBe("(우힌지·밖열림)");
    expect(doorNote({ ...door, hinge: "start", swing: "in" })).toBe("(좌힌지·안열림)");
  });

  it("미닫이·개구부는 스윙 대신 종류만 적는다", () => {
    expect(doorNote({ ...door, doorType: "sliding" })).toBe("(미닫이)");
    expect(doorNote({ ...door, doorType: "opening" })).toBe("(개구부)");
  });

  it("여닫이는 평면도에 스윙 아크를 그리고 개구부는 그리지 않는다", () => {
    const plan = toPlanData(sceneWith([door]), "테스트");
    expect(buildPlanSvg(plan)).toContain("<path d=");

    const openingOnly = toPlanData(sceneWith([{ ...door, doorType: "opening" }]), "테스트");
    const svg = buildPlanSvg(openingOnly);
    // 개구부는 문짝도 아크도 없다 (창의 유리선과 구분하기 위해 문 색으로 검사한다)
    expect(svg).not.toContain('stroke="#8a8a8a" stroke-width="14" stroke-dasharray="60 40"');
  });

  it("열림 방향을 바꾸면 그림이 달라진다", () => {
    const inward = buildPlanSvg(toPlanData(sceneWith([{ ...door, swing: "in" }]), "t"));
    const outward = buildPlanSvg(toPlanData(sceneWith([{ ...door, swing: "out" }]), "t"));
    expect(inward).not.toBe(outward);
  });
});

describe("전기 · 통신", () => {
  it("벽에 붙은 설비는 벽을 따라 좌표가 잡힌다", () => {
    const plan = toPlanData(sceneWith([]), "테스트");
    const outlet = plan.electrical.find((item) => item.id === "fx1")!;
    const [x, y] = electricalPoint(plan, outlet);
    expect(x).toBeCloseTo(1200, 0);
    expect(y).toBeCloseTo(0, 0);
  });

  it("벽이 없는 설비는 방 중앙으로 떨어진다", () => {
    const plan = toPlanData(sceneWith([]), "테스트");
    const light = plan.electrical.find((item) => item.id === "fx3")!;
    expect(electricalPoint(plan, light)).toEqual([2000, 1500]);
  });

  it("평면도와 DXF 모두에 기호가 들어간다", () => {
    const plan = toPlanData(sceneWith([door]), "테스트");
    expect(buildPlanSvg(plan)).toContain("H300");
    const dxf = buildDxf(plan);
    expect(dxf).toContain("E-POWR");
    expect(dxf).toContain("CIRCLE");
  });
});

describe("입면도", () => {
  it("해당 벽의 설비만 높이와 함께 그린다", () => {
    const scene = sceneWith([door]);
    const plan = toPlanData(scene, "테스트");
    const wall = plan.walls[0];

    expect(fixturesOnWall(plan, wall.id)).toHaveLength(2);

    const svg = buildElevationSvg({ plan, wall });
    expect(svg).toContain("입면도");
    expect(svg).toContain("H1200");
    expect(svg).toContain("현관문 900×2100");
  });

  it("천장고와 개구부 높이가 치수로 찍힌다", () => {
    const plan = toPlanData(sceneWith([door]), "테스트");
    const svg = buildElevationSvg({ plan, wall: plan.walls[0] });
    expect(svg).toContain(">2400<");
    expect(svg).toContain(">2100<");
  });
});
