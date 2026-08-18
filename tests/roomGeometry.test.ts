import { describe, expect, it } from "vitest";
import {
  createOpening,
  createWall,
  ensureRoom,
  rectangleWalls,
  validateOpening,
  wallLength,
  wallSpans,
} from "@/scene/geometry";
import { SceneEngine, createSceneObject } from "@/scene/engine/SceneEngine";
import { createEmptyScene } from "@/scene/serialization";
import { isValidScene } from "@/scene/validation";
import { buildDxf, buildPlanSvg, toPlanData } from "@/services/cadExport";

function wall(length = 5000) {
  return createWall({ start: [0, 0], end: [length, 0], height: 2700 });
}

describe("wallSpans", () => {
  it("개구부가 없으면 벽 전체가 한 덩어리다", () => {
    const spans = wallSpans(wall());
    expect(spans).toEqual([{ from: 0, to: 5000, bottom: 0, top: 2700 }]);
  });

  it("문은 바닥까지 뚫려 상인방만 남는다", () => {
    const target = wall();
    target.openings = [createOpening("door", { offset: 1000, width: 900, height: 2100 })];

    const spans = wallSpans(target);
    // 좌측 벽 / 문 위 상인방 / 우측 벽
    expect(spans).toHaveLength(3);
    expect(spans).toContainEqual({ from: 0, to: 1000, bottom: 0, top: 2700 });
    expect(spans).toContainEqual({ from: 1000, to: 1900, bottom: 2100, top: 2700 });
    expect(spans).toContainEqual({ from: 1900, to: 5000, bottom: 0, top: 2700 });
    // 문 구간에는 바닥에 닿는 벽이 없어야 한다
    expect(spans.some((s) => s.from === 1000 && s.bottom === 0)).toBe(false);
  });

  it("창은 하인방과 상인방이 모두 남는다", () => {
    const target = wall();
    target.openings = [
      createOpening("window", { offset: 2000, width: 1500, height: 1200, sillHeight: 900 }),
    ];

    const spans = wallSpans(target);
    expect(spans).toContainEqual({ from: 2000, to: 3500, bottom: 0, top: 900 });
    expect(spans).toContainEqual({ from: 2000, to: 3500, bottom: 2100, top: 2700 });
  });

  it("개구부가 여러 개여도 사이 벽이 유지된다", () => {
    const target = wall();
    target.openings = [
      createOpening("door", { offset: 3000, width: 900 }),
      createOpening("window", { offset: 500, width: 1000, sillHeight: 900, height: 1200 }),
    ];

    const spans = wallSpans(target);
    expect(spans).toContainEqual({ from: 1500, to: 3000, bottom: 0, top: 2700 });
  });
});

describe("validateOpening", () => {
  const target = wall(3000);

  it("벽 길이를 벗어나면 거부한다", () => {
    const result = validateOpening(target, createOpening("door", { offset: 2500, width: 900 }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("벽 길이");
  });

  it("벽 높이를 벗어나면 거부한다", () => {
    const result = validateOpening(
      target,
      createOpening("window", { offset: 0, width: 900, sillHeight: 2000, height: 1200 })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("벽 높이");
  });

  it("다른 개구부와 겹치면 거부한다", () => {
    const withDoor = { ...target, openings: [createOpening("door", { offset: 500, width: 900 })] };
    const result = validateOpening(
      withDoor,
      createOpening("window", { offset: 1000, width: 900, sillHeight: 900, height: 1000 })
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("겹칩니다");
  });

  it("정상 개구부는 통과한다", () => {
    expect(validateOpening(target, createOpening("door", { offset: 300, width: 900 })).ok).toBe(true);
  });
});

describe("실측 치수 · 벽 편집 (SceneEngine)", () => {
  it("새 Scene은 직사각형 벽 4개를 갖는다", () => {
    const walls = createEmptyScene().room.walls ?? [];
    expect(walls).toHaveLength(4);
    expect(Math.round(wallLength(walls[0]))).toBe(5000);
  });

  it("예전 형식(벽 없음)도 ensureRoom으로 복구된다", () => {
    const room = ensureRoom({ type: "living_room", dimensions: { width: 3000, length: 4000, height: 2400 } });
    expect(room.walls).toHaveLength(4);
    expect(room.measured).toBe(false);
  });

  it("실측 치수를 넣으면 벽이 다시 맞춰지고 measured가 켜진다", () => {
    const engine = new SceneEngine(createEmptyScene());
    const result = engine.setRoomDimensions(
      { width: 3600, length: 4200, height: 2400 },
      { measured: true }
    );

    expect(result.ok).toBe(true);
    const room = engine.getScene().room;
    expect(room.measured).toBe(true);
    expect(room.dimensions.width).toBe(3600);
    expect(Math.round(wallLength((room.walls ?? [])[0]))).toBe(3600);
    expect(isValidScene(engine.getScene())).toBe(true);
  });

  it("치수가 0 이하이면 거부한다", () => {
    const engine = new SceneEngine(createEmptyScene());
    expect(engine.setRoomDimensions({ width: 0 }).ok).toBe(false);
  });

  it("개구부 추가·수정·삭제가 되돌려진다", () => {
    const engine = new SceneEngine(createEmptyScene());
    const wallId = (engine.getWalls()[0]).id;

    expect(engine.addOpening(wallId, createOpening("door", { offset: 500 })).ok).toBe(true);
    const openingId = engine.getWall(wallId)!.openings[0].id;

    expect(engine.updateOpening(wallId, openingId, { width: 1000 }).ok).toBe(true);
    expect(engine.getWall(wallId)!.openings[0].width).toBe(1000);

    // 벽을 벗어나는 수정은 거부
    expect(engine.updateOpening(wallId, openingId, { offset: 4900 }).ok).toBe(false);

    engine.undo();
    expect(engine.getWall(wallId)!.openings[0].width).toBe(900);

    expect(engine.deleteOpening(wallId, openingId).ok).toBe(true);
    expect(engine.getWall(wallId)!.openings).toHaveLength(0);
  });

  it("벽을 추가·삭제할 수 있다", () => {
    const engine = new SceneEngine(createEmptyScene());
    const before = engine.getWalls().length;

    engine.addWall(createWall({ start: [0, 0], end: [1000, 1000] }));
    expect(engine.getWalls()).toHaveLength(before + 1);

    engine.deleteWall(engine.getWalls()[before].id);
    expect(engine.getWalls()).toHaveLength(before);
  });
});

describe("방을 줄이면 가구를 안으로 들여놓는다", () => {
  function engineWithCabinet() {
    const engine = new SceneEngine(createEmptyScene()); // 5000 × 6000
    engine.addObject(
      createSceneObject({
        id: "cabinet_001",
        type: "cabinet",
        name: "상부장",
        screen: { x: 0.75, y: 0.3, width: 0.2, height: 0.2, rotation: 0 },
      })
    );
    engine.setDimensions("cabinet_001", { width: 3000, depth: 600 });
    return engine;
  }

  it("벽 밖으로 나간 가구가 방 안으로 들어온다", () => {
    const engine = engineWithCabinet();
    engine.setRoomDimensions({ width: 3600, length: 4200 }, { measured: true });

    const room = engine.getScene().room;
    const cabinet = engine.getObject("cabinet_001")!;
    const centerX = (cabinet.screen.x + cabinet.screen.width / 2) * room.dimensions.width;
    const halfWidth = (cabinet.dimensions.width * cabinet.transform.scale[0]) / 2;

    expect(centerX - halfWidth).toBeGreaterThanOrEqual(-1);
    expect(centerX + halfWidth).toBeLessThanOrEqual(room.dimensions.width + 1);
  });

  it("치수와 위치 보정이 undo 한 번으로 함께 되돌아간다", () => {
    const engine = engineWithCabinet();
    const before = engine.getObject("cabinet_001")!.screen.x;

    engine.setRoomDimensions({ width: 3600, length: 4200 });
    expect(engine.getObject("cabinet_001")!.screen.x).not.toBe(before);

    engine.undo();
    expect(engine.getScene().room.dimensions.width).toBe(5000);
    expect(engine.getObject("cabinet_001")!.screen.x).toBe(before);
    expect(isValidScene(engine.getScene())).toBe(true);
  });

  it("방 안에 있는 가구는 건드리지 않는다", () => {
    const engine = new SceneEngine(createEmptyScene());
    engine.addObject(
      createSceneObject({
        id: "chair_001",
        type: "chair",
        name: "의자",
        screen: { x: 0.4, y: 0.5, width: 0.1, height: 0.1, rotation: 0 },
      })
    );
    const before = engine.getObject("chair_001")!.screen.x;

    engine.setRoomDimensions({ height: 2400 });
    expect(engine.getObject("chair_001")!.screen.x).toBe(before);
  });
});

describe("벽 좌표 편집", () => {
  it("끝점을 옮기면 벽 길이가 따라간다", () => {
    const engine = new SceneEngine(createEmptyScene());
    const wall = engine.getWalls()[0];

    expect(engine.updateWall(wall.id, { end: [2000, 0] }).ok).toBe(true);
    expect(Math.round(wallLength(engine.getWall(wall.id)!))).toBe(2000);
  });

  it("개구부가 벽을 벗어나게 되는 좌표 변경은 막는다", () => {
    const engine = new SceneEngine(createEmptyScene());
    const wall = engine.getWalls()[0];
    engine.addOpening(wall.id, createOpening("door", { offset: 3000, width: 900 }));

    const result = engine.updateWall(wall.id, { end: [1500, 0] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("벗어납니다");
  });
});

describe("도면 출력에 개구부가 반영된다", () => {
  function sceneWithOpenings() {
    const engine = new SceneEngine(createEmptyScene());
    const wallId = engine.getWalls()[0].id;
    engine.addOpening(wallId, createOpening("door", { offset: 800, name: "현관문" }));
    engine.addOpening(wallId, createOpening("window", { offset: 2500, name: "거실창" }));
    return engine.getScene();
  }

  it("DXF에 문·창 레이어가 들어간다", () => {
    const dxf = buildDxf(toPlanData(sceneWithOpenings(), "테스트"));
    expect(dxf).toContain("A-DOOR");
    expect(dxf).toContain("A-GLAZ");
    expect(dxf).not.toContain("NaN");
    expect(dxf.trimEnd().endsWith("EOF")).toBe(true);
  });

  it("실측 확정 여부가 도면 고지에 반영된다", () => {
    const engine = new SceneEngine(createEmptyScene());
    const estimate = buildPlanSvg(toPlanData(engine.getScene(), "테스트"));
    expect(estimate).toContain("추정");

    engine.setRoomDimensions({ width: 4000 }, { measured: true });
    const measured = buildPlanSvg(toPlanData(engine.getScene(), "테스트"));
    expect(measured).toContain("실측");
  });

  it("평면도에 개구부 이름이 표기된다", () => {
    const svg = buildPlanSvg(toPlanData(sceneWithOpenings(), "테스트"));
    expect(svg).toContain("현관문");
    expect(svg).toContain("거실창");
    expect(svg).not.toContain("NaN");
  });

  it("벽 4개가 평면도 좌표계 안에 들어온다", () => {
    const walls = rectangleWalls({ width: 5000, length: 6000, height: 2700 });
    for (const w of walls) {
      expect(w.start.every(Number.isFinite)).toBe(true);
      expect(w.end.every(Number.isFinite)).toBe(true);
    }
  });
});
