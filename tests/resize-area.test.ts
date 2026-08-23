import { describe, expect, it } from "vitest";
import { SceneEngine } from "@/scene/engine/SceneEngine";
import { createEmptyScene } from "@/scene/serialization";
import { executeCommand } from "@/ai/tools";
import { ensureRoom, polygonArea, toSquareMeters } from "@/scene/geometry";
import { planCenter } from "@/scene/placement";
import type { RoomArea, Scene } from "@/scene/types";

/**
 * 실 치수를 사람이 직접 넣기.
 *
 * 도면을 스캔하면 치수선이 그어진 실만 정확하다. 치수선이 없는 실은 모델이 눈대중으로
 * 그리므로 같은 도면을 두 번 넣어도 거실 깊이가 2.2m와 4.5m로 갈린다. AI를 조여서
 * 없앨 수 있는 오차가 아니라, 줄자로 잰 값을 넣을 길이 있어야 한다.
 *
 * 아래 평면은 아래쪽에 거실, 위쪽에 침실 둘이 나란히 놓인 흔한 구성이다.
 */
function area(id: string, name: string, points: [number, number][]): RoomArea {
  return { id, name, points };
}

function setup() {
  const scene: Scene = createEmptyScene();
  const engine = new SceneEngine(scene);

  engine.setRoomDimensions({ width: 6000, length: 5000, height: 2400 });
  engine.setWalls([]);

  for (const item of [
    area("area_living", "거실", [
      [0, 0],
      [6000, 0],
      [6000, 2000],
      [0, 2000],
    ]),
    area("area_bed1", "침실1", [
      [0, 2000],
      [3000, 2000],
      [3000, 5000],
      [0, 5000],
    ]),
    area("area_bed2", "침실2", [
      [3000, 2000],
      [6000, 2000],
      [6000, 5000],
      [3000, 5000],
    ]),
  ]) {
    engine.addArea(item);
  }

  return engine;
}

/** 실의 외접 사각형 (mm) */
function boxOf(engine: SceneEngine, id: string) {
  const found = ensureRoom(engine.getScene().room).areas!.find((item) => item.id === id)!;
  const xs = found.points.map(([x]) => x);
  const ys = found.points.map(([, y]) => y);
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    length: Math.max(...ys) - Math.min(...ys),
  };
}

describe("실 치수 직접 입력", () => {
  it("적은 치수 그대로 된다", () => {
    const engine = setup();
    expect(engine.resizeArea("area_living", { length: 3700 }).ok).toBe(true);

    expect(boxOf(engine, "area_living").length).toBe(3700);
  });

  it("건드리지 않은 축은 그대로 둔다", () => {
    const engine = setup();
    engine.resizeArea("area_living", { length: 3700 });

    // 깊이만 줬으니 폭은 6000 그대로
    expect(boxOf(engine, "area_living").width).toBe(6000);
  });

  it("이웃 실이 떨어지거나 겹치지 않는다", () => {
    const engine = setup();
    engine.resizeArea("area_living", { length: 3700 });

    const living = boxOf(engine, "area_living");
    const bedroom = boxOf(engine, "area_bed1");
    expect(living.y1).toBe(bedroom.y0);
  });

  it("이웃 실은 제 크기를 지킨 채 밀려난다", () => {
    const engine = setup();
    const before = boxOf(engine, "area_bed1");
    engine.resizeArea("area_living", { length: 3700 });
    const after = boxOf(engine, "area_bed1");

    expect(after.length).toBe(before.length);
    expect(after.width).toBe(before.width);
    expect(after.y0).toBeGreaterThan(before.y0);
  });

  it("방 전체 크기가 늘어난 만큼 커진다", () => {
    const engine = setup();
    engine.resizeArea("area_living", { length: 3700 });

    // 2000 → 3700이니 전체 길이는 5000 → 6700
    expect(engine.getScene().room.dimensions.length).toBe(6700);
  });

  it("한 실만 늘여도 옆 실은 폭이 안 바뀐다", () => {
    const engine = setup();
    engine.resizeArea("area_bed1", { width: 2400 });

    expect(boxOf(engine, "area_bed1").width).toBe(2400);
    expect(boxOf(engine, "area_bed2").width).toBe(3000);
  });

  it("실측 확정으로 바뀐다 — DXF는 이 값에 걸려 있다", () => {
    const engine = setup();
    expect(engine.getScene().room.measured).toBeFalsy();

    engine.resizeArea("area_living", { length: 3700 });
    expect(engine.getScene().room.measured).toBe(true);
  });

  it("되돌리기 한 번이면 원래대로다", () => {
    const engine = setup();
    engine.resizeArea("area_living", { length: 3700 });
    engine.undo();

    expect(boxOf(engine, "area_living").length).toBe(2000);
    expect(engine.getScene().room.dimensions.length).toBe(5000);
  });

  it("말이 안 되는 값은 받지 않는다", () => {
    const engine = setup();
    expect(engine.resizeArea("area_living", { length: 50 }).ok).toBe(false);
    expect(engine.resizeArea("area_living", { length: 90000 }).ok).toBe(false);
    expect(engine.resizeArea("없는실", { length: 3000 }).ok).toBe(false);
    expect(engine.resizeArea("area_living", {}).ok).toBe(false);
  });

  it("면적도 함께 맞는다", () => {
    const engine = setup();
    engine.resizeArea("area_living", { width: 5000, length: 4000 });

    const found = ensureRoom(engine.getScene().room).areas!.find((a) => a.id === "area_living")!;
    expect(toSquareMeters(polygonArea(found.points))).toBeCloseTo(20, 1);
  });
});

describe("치수를 고쳐도 가구는 제자리", () => {
  it("늘어난 실 안의 가구는 같은 비율 자리에 남는다", () => {
    const engine = setup();
    executeCommand(engine, {
      tool: "add_object",
      arguments: { assetId: "asset_sofa_beige_3" },
      explanation: "",
      confidence: 1,
    });

    const before = engine.getScene().objects[0];
    const beforeWidth = before.dimensions.width;

    engine.resizeArea("area_living", { length: 3700 });

    const after = engine.getScene().objects[0];
    // 제품 규격이라 크기는 그대로
    expect(after.dimensions.width).toBe(beforeWidth);

    // 방 안에 남아 있어야 한다
    const room = engine.getScene().room;
    const centre = planCenter(after.screen, after.depth, room);
    expect(centre.cx).toBeGreaterThanOrEqual(0);
    expect(centre.cx).toBeLessThanOrEqual(room.dimensions.width);
    expect(centre.cy).toBeGreaterThanOrEqual(0);
    expect(centre.cy).toBeLessThanOrEqual(room.dimensions.length);
  });
});

describe("도구로도 부를 수 있다", () => {
  it("resize_room_area가 엔진과 같게 동작한다", () => {
    const engine = setup();
    const result = executeCommand(engine, {
      tool: "resize_room_area",
      arguments: { areaId: "area_living", length: 3700 },
      explanation: "",
      confidence: 1,
    });

    expect(result.ok).toBe(true);
    expect(boxOf(engine, "area_living").length).toBe(3700);
  });
});
