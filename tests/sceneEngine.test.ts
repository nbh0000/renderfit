import { describe, expect, it } from "vitest";
import { SceneEngine, createSceneObject } from "@/scene/engine/SceneEngine";
import { createEmptyScene } from "@/scene/serialization";
import { isValidScene } from "@/scene/validation";

function engineWithSofa() {
  const engine = new SceneEngine(createEmptyScene());
  engine.addObject(
    createSceneObject({
      id: "sofa_001",
      type: "sofa",
      name: "소파",
      materialId: "mat_beige_fabric",
      screen: { x: 0.2, y: 0.5, width: 0.3, height: 0.2, rotation: 0 },
    })
  );
  return engine;
}

describe("SceneEngine", () => {
  it("빈 Scene은 스키마 검증을 통과한다", () => {
    expect(isValidScene(createEmptyScene())).toBe(true);
  });

  it("객체를 추가하고 조회할 수 있다", () => {
    const engine = engineWithSofa();
    expect(engine.getScene().objects).toHaveLength(1);
    expect(engine.getObject("sofa_001")?.name).toBe("소파");
  });

  it("이동은 화면 좌표를 바꾸고 operation을 남긴다", () => {
    const engine = engineWithSofa();
    const result = engine.moveObject("sofa_001", { screen: { x: 0.4, y: 0.55 } });

    expect(result.ok).toBe(true);
    expect(engine.getObject("sofa_001")?.screen.x).toBeCloseTo(0.4);
    expect(engine.getOperations()).toHaveLength(2); // ADD + MOVE
  });

  it("잠긴 객체는 수정되지 않는다", () => {
    const engine = engineWithSofa();
    engine.setLocked("sofa_001", true);

    const result = engine.moveObject("sofa_001", { screen: { x: 0.9 } });
    expect(result.ok).toBe(false);
    expect(engine.getObject("sofa_001")?.screen.x).toBeCloseTo(0.2);
  });

  it("존재하지 않는 재질은 적용되지 않는다", () => {
    const engine = engineWithSofa();
    const result = engine.changeMaterial("sofa_001", "mat_does_not_exist");
    expect(result.ok).toBe(false);
  });

  it("색상 변경은 새 재질을 만들어 연결한다", () => {
    const engine = engineWithSofa();
    const before = engine.getScene().materials.length;

    const result = engine.changeColor("sofa_001", "#123456");
    expect(result.ok).toBe(true);
    expect(engine.getScene().materials.length).toBe(before + 1);

    const materialId = engine.getObject("sofa_001")?.materialId;
    expect(engine.getMaterial(materialId!)?.baseColor).toBe("#123456");
  });

  it("삭제한 객체는 undo로 복원된다", () => {
    const engine = engineWithSofa();
    engine.deleteObject("sofa_001");
    expect(engine.getScene().objects).toHaveLength(0);

    engine.undo();
    expect(engine.getObject("sofa_001")).toBeDefined();

    engine.redo();
    expect(engine.getScene().objects).toHaveLength(0);
  });

  it("undo/redo가 여러 단계에 걸쳐 동작한다", () => {
    const engine = engineWithSofa();
    engine.moveObject("sofa_001", { screen: { x: 0.5 } });
    engine.changeColor("sofa_001", "#aabbcc");
    engine.scaleObject("sofa_001", { factor: 2 });

    expect(engine.getObject("sofa_001")?.screen.width).toBeCloseTo(0.6);

    engine.undo(); // scale
    expect(engine.getObject("sofa_001")?.screen.width).toBeCloseTo(0.3);

    engine.undo(); // color
    expect(engine.getObject("sofa_001")?.materialId).toBe("mat_beige_fabric");

    engine.undo(); // move
    expect(engine.getObject("sofa_001")?.screen.x).toBeCloseTo(0.2);

    expect(engine.canUndo()).toBe(true); // ADD가 남아 있다
    engine.redo();
    expect(engine.getObject("sofa_001")?.screen.x).toBeCloseTo(0.5);
  });

  it("새 작업을 하면 redo 스택이 비워진다", () => {
    const engine = engineWithSofa();
    engine.moveObject("sofa_001", { screen: { x: 0.5 } });
    engine.undo();
    expect(engine.canRedo()).toBe(true);

    engine.rotateObject("sofa_001", { screen: 30 });
    expect(engine.canRedo()).toBe(false);
  });

  it("복제는 새 id를 가진 객체를 만든다", () => {
    const engine = engineWithSofa();
    const result = engine.duplicateObject("sofa_001");

    expect(result.ok).toBe(true);
    expect(engine.getScene().objects).toHaveLength(2);
    expect(engine.getScene().objects[1].id).not.toBe("sofa_001");
  });

  it("스케일은 0 이하가 될 수 없다", () => {
    const engine = engineWithSofa();
    const result = engine.scaleObject("sofa_001", { world: [0, 1, 1] });
    expect(result.ok).toBe(false);
  });
});
