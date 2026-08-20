import { describe, expect, it } from "vitest";
import {
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  rectangleWalls,
  toSquareMeters,
} from "@/scene/geometry";
import { SceneEngine } from "@/scene/engine/SceneEngine";
import type { Scene } from "@/scene/types";

/**
 * 실(방) 영역은 평면도에 실명과 면적을 적는 단위다.
 * 면적 계산이 틀리면 도면의 숫자가 전부 틀리므로 기하 계산부터 확인한다.
 */

function scene(): Scene {
  return {
    sceneId: "s",
    version: 1,
    room: {
      type: "거실",
      dimensions: { width: 4000, length: 3000, height: 2400 },
      walls: rectangleWalls({ width: 4000, length: 3000, height: 2400 }),
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

const square: [number, number][] = [
  [0, 0],
  [4000, 0],
  [4000, 3000],
  [0, 3000],
];

describe("폴리곤 계산", () => {
  it("면적을 신발끈 공식으로 낸다", () => {
    expect(polygonArea(square)).toBe(12_000_000);
    expect(toSquareMeters(polygonArea(square))).toBe(12);
  });

  it("점 순서가 반대여도 같은 면적이 나온다", () => {
    expect(polygonArea([...square].reverse())).toBe(12_000_000);
  });

  it("무게중심은 실명을 적을 자리다", () => {
    expect(polygonCentroid(square)).toEqual([2000, 1500]);
  });

  it("ㄱ자 평면도 계산한다", () => {
    const lShape: [number, number][] = [
      [0, 0],
      [4000, 0],
      [4000, 2000],
      [2000, 2000],
      [2000, 3000],
      [0, 3000],
    ];
    // 4×2 + 2×1 = 10㎡
    expect(toSquareMeters(polygonArea(lShape))).toBe(10);
  });

  it("점이 안에 있는지 판단한다", () => {
    expect(pointInPolygon([2000, 1500], square)).toBe(true);
    expect(pointInPolygon([5000, 1500], square)).toBe(false);
  });
});

describe("실 편집", () => {
  it("방 외곽 전체를 실 하나로 잡는다", () => {
    const engine = new SceneEngine(scene());
    const result = engine.addAreaFromRoomBounds("거실");
    expect(result.ok).toBe(true);

    const areas = engine.getScene().room.areas ?? [];
    expect(areas).toHaveLength(1);
    expect(areas[0].name).toBe("거실");
    expect(toSquareMeters(polygonArea(areas[0].points))).toBe(12);
  });

  it("여러 실을 나란히 둘 수 있다", () => {
    const engine = new SceneEngine(scene());
    engine.addArea({
      id: "a1",
      name: "거실",
      points: [
        [0, 0],
        [2000, 0],
        [2000, 3000],
        [0, 3000],
      ],
    });
    engine.addArea({
      id: "a2",
      name: "주방",
      points: [
        [2000, 0],
        [4000, 0],
        [4000, 3000],
        [2000, 3000],
      ],
    });

    const areas = engine.getScene().room.areas ?? [];
    expect(areas.map((area) => area.name)).toEqual(["거실", "주방"]);
    expect(areas.map((area) => toSquareMeters(polygonArea(area.points)))).toEqual([6, 6]);
  });

  it("점이 셋 미만이거나 넓이가 없으면 막는다", () => {
    const engine = new SceneEngine(scene());
    expect(
      engine.addArea({
        id: "bad",
        name: "실",
        points: [
          [0, 0],
          [100, 0],
        ],
      }).ok
    ).toBe(false);

    expect(
      engine.addArea({
        id: "flat",
        name: "실",
        points: [
          [0, 0],
          [100, 0],
          [200, 0],
        ],
      }).ok
    ).toBe(false);
  });

  it("이름과 경계를 고치고 지울 수 있다", () => {
    const engine = new SceneEngine(scene());
    engine.addAreaFromRoomBounds("거실");
    const id = (engine.getScene().room.areas ?? [])[0].id;

    expect(engine.updateArea(id, { name: "안방" }).ok).toBe(true);
    expect((engine.getScene().room.areas ?? [])[0].name).toBe("안방");

    expect(engine.deleteArea(id).ok).toBe(true);
    expect(engine.getScene().room.areas ?? []).toHaveLength(0);
  });

  it("실 추가는 실행 취소로 되돌아간다", () => {
    const engine = new SceneEngine(scene());
    engine.addAreaFromRoomBounds("거실");
    expect(engine.getScene().room.areas ?? []).toHaveLength(1);

    engine.undo();
    expect(engine.getScene().room.areas ?? []).toHaveLength(0);
  });
});
