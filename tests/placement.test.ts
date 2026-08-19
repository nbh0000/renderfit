import { describe, expect, it } from "vitest";
import { SceneEngine, createSceneObject } from "@/scene/engine/SceneEngine";
import { createEmptyScene } from "@/scene/serialization";
import { footprintOf, nearestWall, placeObject, ROTATION_BY_SIDE } from "@/scene/placement";

/** 기본 방은 5000 × 6000 */
function engineWith(
  objects: {
    id: string;
    type: import("@/scene/types").ObjectType;
    width: number;
    depth: number;
    x: number;
    depthRatio: number;
  }[]
) {
  const engine = new SceneEngine(createEmptyScene());
  for (const spec of objects) {
    engine.addObject(
      createSceneObject({
        id: spec.id,
        type: spec.type,
        name: spec.id,
        screen: { x: spec.x, y: 0.5, width: 0.2, height: 0.2, rotation: 0 },
      })
    );
    engine.setDimensions(spec.id, { width: spec.width, depth: spec.depth });
    engine.moveObject(spec.id, { depth: spec.depthRatio });
  }
  return engine;
}

describe("가구 배치 규칙", () => {
  it("벽 가까이 놓으면 벽에 붙이고 벽을 등지게 돌린다", () => {
    const engine = engineWith([
      { id: "sofa_1", type: "sofa", width: 2200, depth: 950, x: 0.4, depthRatio: 0.5 },
    ]);
    const scene = engine.getScene();

    // 북쪽 벽(안쪽 끝) 가까이로 옮긴다
    const patch = placeObject(scene, "sofa_1", { cx: 2500, cy: 5800 })!;
    expect(patch.rotation).toBe(ROTATION_BY_SIDE.north);

    // 벽면에서 950/2 + 여유 만큼 떨어진 중심
    expect(patch.depth * scene.room.dimensions.length).toBeCloseTo(6000 - 20 - 475, 0);
  });

  it("방 밖으로는 나가지 않는다", () => {
    const engine = engineWith([
      { id: "table_1", type: "table", width: 1800, depth: 900, x: 0.4, depthRatio: 0.5 },
    ]);
    const scene = engine.getScene();

    const patch = placeObject(scene, "table_1", { cx: 99000, cy: -5000 })!;
    const cx = (patch.screen.x + 0.2 / 2) * scene.room.dimensions.width;
    expect(cx).toBeLessThanOrEqual(5000 - 900 + 1);
    expect(patch.depth).toBeGreaterThanOrEqual(0);
  });

  it("이미 있는 가구와 겹치지 않게 비켜 놓는다", () => {
    const engine = engineWith([
      { id: "sofa_1", type: "sofa", width: 2200, depth: 950, x: 0.2, depthRatio: 0.9 },
      { id: "sofa_2", type: "sofa", width: 2200, depth: 950, x: 0.5, depthRatio: 0.5 },
    ]);
    const scene = engine.getScene();

    // sofa_1 자리에 그대로 겹쳐 놓으려 하면 옆으로 밀린다
    const first = footprintOf(
      scene.objects.find((o) => o.id === "sofa_1")!,
      scene.room
    );
    const patch = placeObject(scene, "sofa_2", { cx: first.cx, cy: first.cy })!;

    const cx = (patch.screen.x + 0.2 / 2) * scene.room.dimensions.width;
    const cy = patch.depth * scene.room.dimensions.length;
    const overlapX = Math.abs(cx - first.cx) < (2200 + 2200) / 2 - 10;
    const overlapY = Math.abs(cy - first.cy) < (950 + 950) / 2 - 10;
    expect(overlapX && overlapY).toBe(false);
  });

  it("테이블처럼 가운데 두는 가구는 벽으로 돌리지 않는다", () => {
    const engine = engineWith([
      { id: "table_1", type: "table", width: 1200, depth: 800, x: 0.4, depthRatio: 0.5 },
    ]);
    const scene = engine.getScene();

    const patch = placeObject(scene, "table_1", { cx: 2500, cy: 3000 })!;
    expect(patch.rotation).toBe(0);
    expect(patch.depth * 6000).toBeCloseTo(3000, 0);
  });

  it("벽과 멀면 스냅하지 않는다", () => {
    const engine = engineWith([
      { id: "sofa_1", type: "sofa", width: 1000, depth: 600, x: 0.4, depthRatio: 0.5 },
    ]);
    const scene = engine.getScene();
    const middle = footprintOf(scene.objects[0], scene.room);
    expect(nearestWall({ ...middle, cx: 2500, cy: 3000 }, scene.room)).toBeNull();
  });

  it("자동 배치는 undo 한 번으로 되돌아간다", () => {
    const engine = engineWith([
      { id: "sofa_1", type: "sofa", width: 2200, depth: 950, x: 0.05, depthRatio: 0.95 },
      { id: "cab_1", type: "cabinet", width: 1800, depth: 450, x: 0.1, depthRatio: 0.92 },
    ]);
    const before = engine.getScene().objects.map((o) => ({ x: o.screen.x, depth: o.depth }));

    expect(engine.arrangeObjects().ok).toBe(true);
    const after = engine.getScene().objects.map((o) => ({ x: o.screen.x, depth: o.depth }));
    expect(after).not.toEqual(before);

    engine.undo();
    expect(engine.getScene().objects.map((o) => ({ x: o.screen.x, depth: o.depth }))).toEqual(
      before
    );
  });
});
