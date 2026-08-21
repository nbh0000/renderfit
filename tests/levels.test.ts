import { describe, expect, it } from "vitest";
import { BASE_LEVEL_ID, levelBelow, levelIdOf, levelsOf, onLevel, rectangleWalls } from "@/scene/geometry";
import { SceneEngine } from "@/scene/engine/SceneEngine";
import type { Scene } from "@/scene/types";

/**
 * 층은 "지금 몇 층을 그리고 있는가"를 나누는 장치다.
 * 층이 없던 프로젝트가 그대로 열려야 하고, 층을 지우면 그 층의 것도 같이 사라져야 한다.
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

describe("기존 프로젝트 호환", () => {
  it("층이 없으면 기준층 하나를 만들어 준다", () => {
    const levels = levelsOf(scene().room);
    expect(levels).toHaveLength(1);
    expect(levels[0].id).toBe(BASE_LEVEL_ID);
    expect(levels[0].elevation).toBe(0);
    expect(levels[0].height).toBe(2400);
  });

  it("levelId가 없는 요소는 기준층 소속으로 본다", () => {
    const levels = levelsOf(scene().room);
    expect(levelIdOf({}, levels)).toBe(BASE_LEVEL_ID);
    expect(onLevel([{}, {}], BASE_LEVEL_ID, levels)).toHaveLength(2);
  });
});

describe("층 편집", () => {
  it("새 층은 아래층 위에 같은 높이로 얹힌다", () => {
    const engine = new SceneEngine(scene());
    expect(engine.addLevel().ok).toBe(true);

    const levels = engine.getLevels();
    expect(levels).toHaveLength(2);
    expect(levels[1].elevation).toBe(2400);
    expect(levels[1].height).toBe(2400);
    expect(levels[1].name).toBe("2층");
  });

  it("바닥 레벨 순서로 정렬해 돌려준다", () => {
    const engine = new SceneEngine(scene());
    engine.addLevel({ name: "다락", elevation: 5000, height: 1800 });
    engine.addLevel({ name: "중간", elevation: 2400, height: 2400 });

    expect(engine.getLevels().map((level) => level.name)).toEqual(["1층", "중간", "다락"]);
  });

  it("바로 아래 층을 찾는다", () => {
    const engine = new SceneEngine(scene());
    engine.addLevel({ name: "2층" });
    const levels = engine.getLevels();

    expect(levelBelow(levels, levels[1].id)?.name).toBe("1층");
    expect(levelBelow(levels, levels[0].id)).toBeNull();
  });

  it("이름과 높이를 고친다", () => {
    const engine = new SceneEngine(scene());
    engine.addLevel({ name: "2층" });
    const id = engine.getLevels()[1].id;

    expect(engine.updateLevel(id, { name: "다락", height: 1800 }).ok).toBe(true);
    expect(engine.getLevels()[1].name).toBe("다락");

    expect(engine.updateLevel(id, { height: 0 }).ok).toBe(false);
    expect(engine.updateLevel(id, { name: "  " }).ok).toBe(false);
  });

  it("마지막 층은 지울 수 없다", () => {
    const engine = new SceneEngine(scene());
    const result = engine.deleteLevel(engine.getLevels()[0].id);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("마지막 층");
  });

  it("층을 지우면 그 층의 벽과 실도 함께 사라진다", () => {
    const engine = new SceneEngine(scene());
    engine.addLevel({ name: "2층" });
    const upper = engine.getLevels()[1].id;

    engine.addWall({
      id: "w_upper",
      name: "2층 벽",
      levelId: upper,
      start: [0, 0],
      end: [2000, 0],
      thickness: 150,
      height: 2400,
      openings: [],
    });
    engine.addArea({
      id: "a_upper",
      name: "다락방",
      levelId: upper,
      points: [
        [0, 0],
        [2000, 0],
        [2000, 2000],
        [0, 2000],
      ],
    });

    const before = engine.getScene().room.walls?.length ?? 0;
    expect(engine.deleteLevel(upper).ok).toBe(true);

    const after = engine.getScene();
    expect(after.room.walls?.length).toBe(before - 1);
    expect(after.room.areas ?? []).toHaveLength(0);
    expect(engine.getLevels()).toHaveLength(1);
  });

  it("층 추가는 실행 취소로 되돌아간다", () => {
    const engine = new SceneEngine(scene());
    engine.addLevel({ name: "2층" });
    expect(engine.getLevels()).toHaveLength(2);

    engine.undo();
    expect(engine.getLevels()).toHaveLength(1);
  });
});
