import { describe, expect, it } from "vitest";
import { intentOf, routeCommand, splitClauses } from "@/ai/router";
import { executeCommand } from "@/ai/tools";
import { SceneEngine, createSceneObject } from "@/scene/engine/SceneEngine";
import { createEmptyScene, sceneContextForAI } from "@/scene/serialization";

function setup() {
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
  engine.addObject(
    createSceneObject({
      id: "wall_001",
      type: "wall",
      name: "벽",
      materialId: "mat_white_paint",
      screen: { x: 0, y: 0, width: 1, height: 0.6, rotation: 0 },
    })
  );
  const context = { ...sceneContextForAI(engine.getScene()), selectedObjectId: null };
  return { engine, context };
}

describe("AI Router", () => {
  it("색상 변경 명령을 인식한다", () => {
    const { context } = setup();
    const commands = routeCommand("소파를 베이지색으로 바꿔줘", context);

    expect(commands[0].tool).toBe("change_color");
    expect(commands[0].arguments.objectId).toBe("sofa_001");
    expect(intentOf(commands)).toBe("COLOR_CHANGE");
  });

  it("삭제 명령을 인식한다", () => {
    const { context } = setup();
    const commands = routeCommand("소파 삭제", context);
    expect(commands[0].tool).toBe("delete_object");
    expect(intentOf(commands)).toBe("REMOVE_OBJECT");
  });

  it("이동 명령의 방향을 인식한다", () => {
    const { context } = setup();
    const commands = routeCommand("소파를 왼쪽으로 옮겨줘", context);
    expect(commands[0].tool).toBe("move_object");
    expect(commands[0].arguments.dx as number).toBeLessThan(0);
  });

  it("크기 명령을 인식한다", () => {
    const { context } = setup();
    const bigger = routeCommand("소파를 더 크게", context);
    expect(bigger[0].tool).toBe("scale_object");
    expect(bigger[0].arguments.factor as number).toBeGreaterThan(1);

    const smaller = routeCommand("소파를 조금 작게", context);
    expect(smaller[0].arguments.factor as number).toBeLessThan(1);
  });

  it("스타일 트랜스퍼를 인식한다", () => {
    const { context } = setup();
    const commands = routeCommand("이 공간을 Japandi로", context);
    expect(commands[0].tool).toBe("change_style");
    expect(commands[0].arguments.styleId).toBe("japandi");
  });

  it("조명 명령을 인식한다", () => {
    const { context } = setup();
    const commands = routeCommand("조명을 더 밝게", context);
    expect(commands[0].tool).toBe("change_lighting");
    expect(commands[0].arguments.intensityDelta as number).toBeGreaterThan(0);
  });

  it("복합 명령을 여러 tool call로 나눈다", () => {
    const { context } = setup();
    const clauses = splitClauses("소파를 삭제하고 라운지체어 두 개를 추가해줘");
    expect(clauses.length).toBeGreaterThan(1);

    const commands = routeCommand("소파를 삭제하고 라운지체어 두 개를 추가해줘", context);
    expect(commands[0].tool).toBe("delete_object");
    expect(commands.filter((c) => c.tool === "add_object")).toHaveLength(2);
    expect(intentOf(commands)).toBe("MULTI_EDIT");
  });

  it("알 수 없는 요청은 생성으로 폴백한다", () => {
    const { context } = setup();
    const commands = routeCommand("여기에 뭔가 특별한 걸 해줘", context);
    expect(commands[0].tool).toBe("generate_region");
  });
});

describe("Tool 실행", () => {
  it("색상 변경 명령이 Scene에 반영된다", () => {
    const { engine, context } = setup();
    const [command] = routeCommand("소파를 베이지색으로 바꿔줘", context);
    const result = executeCommand(engine, command);

    expect(result.ok).toBe(true);
    const materialId = engine.getObject("sofa_001")?.materialId;
    expect(engine.getMaterial(materialId!)?.baseColor).toBe("#d8c8b2");
  });

  it("삭제 → undo 로 되돌아온다", () => {
    const { engine, context } = setup();
    const [command] = routeCommand("소파 삭제", context);
    executeCommand(engine, command);
    expect(engine.getObject("sofa_001")).toBeUndefined();

    engine.undo();
    expect(engine.getObject("sofa_001")).toBeDefined();
  });

  it("가구 추가는 에셋 정보를 사용한다", () => {
    const { engine, context } = setup();
    const commands = routeCommand("라운지체어 두 개를 추가해줘", context);
    for (const command of commands) executeCommand(engine, command);

    const chairs = engine.getScene().objects.filter((object) => object.type === "chair");
    expect(chairs).toHaveLength(2);
    expect(chairs[0].assetId).toBeTruthy();
  });

  it("스타일 변경은 생성 job을 요청한다", () => {
    const { engine, context } = setup();
    const [command] = routeCommand("이 공간을 Japandi로", context);
    const result = executeCommand(engine, command);

    expect(result.ok).toBe(true);
    expect(result.job?.type).toBe("GENERATE_INTERIOR");
    expect(engine.getScene().styleId).toBe("japandi");
  });

  it("잘못된 도구 호출은 거부된다", () => {
    const { engine } = setup();
    const result = executeCommand(engine, {
      tool: "delete_object",
      arguments: { objectId: "does_not_exist" },
      explanation: "",
      confidence: 1,
    });
    expect(result.ok).toBe(false);
  });
});
