import { describe, expect, it } from "vitest";
import { SceneEngine } from "@/scene/engine/SceneEngine";
import { createEmptyScene } from "@/scene/serialization";
import { ensureRoom, wallLength } from "@/scene/geometry";
import { planCenter } from "@/scene/placement";
import { executeCommand } from "@/ai/tools";

/**
 * 축척 보정.
 *
 * 사진에서 읽은 치수는 비례는 꽤 맞는데 절대 크기가 흔들린다 — 같은 사진을 두 번
 * 분석했을 때 방 면적이 60㎡와 81㎡로 갈렸다. 그래서 줄자로 잰 한 변만 받아
 * 나머지를 그 비율로 끌어당긴다. 이 값이 있어야 DXF가 열린다.
 */
function setup() {
  const engine = new SceneEngine(createEmptyScene());
  engine.setRoomDimensions({ width: 7500, length: 9000, height: 3200 });

  const wall = ensureRoom(engine.getScene().room).walls![0];
  executeCommand(engine, {
    tool: "add_opening",
    arguments: {
      wallId: wall.id,
      type: "window",
      width: 1200,
      height: 1200,
      sillHeight: 900,
      offset: 2000,
    },
    explanation: "",
    confidence: 1,
  });
  executeCommand(engine, {
    tool: "add_object",
    arguments: { assetId: "asset_sofa_beige_3" },
    explanation: "",
    confidence: 1,
  });

  return { engine, wallId: ensureRoom(engine.getScene().room).walls![0].id };
}

describe("한 변 실측으로 축척 맞추기", () => {
  it("기준 벽이 정확히 실측 길이가 된다", () => {
    const { engine, wallId } = setup();
    expect(engine.calibrateScale(wallId, 6000).ok).toBe(true);

    const wall = ensureRoom(engine.getScene().room).walls!.find((w) => w.id === wallId)!;
    expect(Math.round(wallLength(wall))).toBe(6000);
  });

  it("나머지 치수가 같은 비율로 따라온다", () => {
    const { engine, wallId } = setup();
    engine.calibrateScale(wallId, 6000); // 7500 → ×0.8

    const room = engine.getScene().room;
    expect(room.dimensions.width).toBe(6000);
    expect(room.dimensions.length).toBe(7200);
    // 천장고는 사람이 서서 재기 쉬워 따로 받는다 — 여기서 건드리지 않는다.
    expect(room.dimensions.height).toBe(3200);
  });

  it("개구부 위치와 폭도 함께 줄어든다", () => {
    const { engine, wallId } = setup();
    engine.calibrateScale(wallId, 6000);

    const opening = ensureRoom(engine.getScene().room).walls!.find((w) => w.id === wallId)!
      .openings[0];
    expect(opening.offset).toBe(1600);
    expect(opening.width).toBe(960);
  });

  it("가구는 크기를 지키고 자리만 따라 옮겨진다", () => {
    const { engine, wallId } = setup();
    const before = engine.getScene().objects[0];
    const beforeCenter = planCenter(before.screen, before.depth, engine.getScene().room);
    const beforeWidth = before.dimensions.width;

    engine.calibrateScale(wallId, 6000);

    const after = engine.getScene().objects[0];
    const afterCenter = planCenter(after.screen, after.depth, engine.getScene().room);

    // 제품 규격이라 크기는 그대로
    expect(after.dimensions.width).toBe(beforeWidth);
    // 위치는 방과 같은 비율로
    expect(afterCenter.cx / beforeCenter.cx).toBeCloseTo(0.8, 3);
    expect(afterCenter.cy / beforeCenter.cy).toBeCloseTo(0.8, 3);
  });

  it("보정하면 실측 확정으로 바뀐다 — DXF는 이 값에 걸려 있다", () => {
    const { engine, wallId } = setup();
    expect(engine.getScene().room.measured).toBeFalsy();

    engine.calibrateScale(wallId, 6000);
    expect(engine.getScene().room.measured).toBe(true);
  });

  it("되돌리면 원래 축척으로 돌아온다", () => {
    const { engine, wallId } = setup();
    engine.calibrateScale(wallId, 6000);
    engine.undo();

    expect(engine.getScene().room.dimensions.width).toBe(7500);
  });

  it("말이 안 되는 값은 받지 않는다", () => {
    const { engine, wallId } = setup();
    expect(engine.calibrateScale(wallId, 10).ok).toBe(false);
    expect(engine.calibrateScale(wallId, 999999).ok).toBe(false);
    expect(engine.calibrateScale("없는벽", 6000).ok).toBe(false);
  });
});
