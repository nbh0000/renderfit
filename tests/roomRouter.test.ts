import { describe, expect, it } from "vitest";
import { intentOf, routeCommand } from "@/ai/router";
import { executeCommand } from "@/ai/tools";
import { SceneEngine, createSceneObject } from "@/scene/engine/SceneEngine";
import { createEmptyScene, sceneContextForAI } from "@/scene/serialization";
import { createOpening } from "@/scene/geometry";

function setup(withOpening = false) {
  const engine = new SceneEngine(createEmptyScene());
  engine.addObject(
    createSceneObject({
      id: "window_001",
      type: "window",
      name: "창문",
      screen: { x: 0.6, y: 0.2, width: 0.2, height: 0.3, rotation: 0 },
    })
  );

  if (withOpening) {
    engine.addOpening(engine.getWalls()[0].id, createOpening("door", { offset: 500 }));
  }

  const context = () => ({ ...sceneContextForAI(engine.getScene()), selectedObjectId: null });
  return { engine, context };
}

describe("AI 명령 — 방 실측 치수", () => {
  it("천장 높이를 인식한다", () => {
    const { context } = setup();
    const commands = routeCommand("천장 높이 2400으로 해줘", context());

    expect(commands[0].tool).toBe("set_room");
    expect(commands[0].arguments.height).toBe(2400);
    expect(intentOf(commands)).toBe("ROOM_CHANGE");
  });

  it("미터 단위를 mm로 환산한다", () => {
    const { context } = setup();
    const commands = routeCommand("가로 3.6m로 바꿔줘", context());

    expect(commands[0].tool).toBe("set_room");
    expect(commands[0].arguments.width).toBe(3600);
  });

  it("3600x4200 형태로 한 번에 받는다", () => {
    const { context } = setup();
    const commands = routeCommand("방 크기 3600x4200으로 해줘", context());

    expect(commands[0].arguments.width).toBe(3600);
    expect(commands[0].arguments.length).toBe(4200);
  });

  it("실측이라고 하면 measured를 함께 켠다", () => {
    const { context } = setup();
    const commands = routeCommand("실측했어 세로 4200", context());

    expect(commands[0].arguments.length).toBe(4200);
    expect(commands[0].arguments.measured).toBe(true);
  });

  it("명령이 실제로 Scene에 반영된다", () => {
    const { engine, context } = setup();
    const commands = routeCommand("천장 높이 2400으로 해줘", context());
    const result = executeCommand(engine, commands[0]);

    expect(result.ok).toBe(true);
    expect(engine.getScene().room.dimensions.height).toBe(2400);
  });
});

describe("AI 명령 — 벽·개구부", () => {
  it("문을 내달라는 명령을 개구부 추가로 보낸다", () => {
    const { engine, context } = setup();
    const commands = routeCommand("이 벽에 문 하나 내줘", context());

    expect(commands[0].tool).toBe("add_opening");
    expect(commands[0].arguments.type).toBe("door");
    expect(intentOf(commands)).toBe("OPENING_CHANGE");

    // 위치를 안 줘도 빈 자리를 찾아 실제로 붙는다
    expect(executeCommand(engine, commands[0]).ok).toBe(true);
    expect(engine.getWalls().flatMap((wall) => wall.openings)).toHaveLength(1);
  });

  it("벽 이름을 말하면 그 벽에 낸다", () => {
    const { engine, context } = setup();
    const commands = routeCommand("동측 벽에 창문 달아줘", context());

    const wallId = commands[0].arguments.wallId as string;
    expect(engine.getWall(wallId)!.name).toBe("동측 벽");
    expect(commands[0].arguments.type).toBe("window");
  });

  it("개구부 크기 변경은 객체 스케일이 아니라 update_opening으로 간다", () => {
    const { engine, context } = setup(true);
    const commands = routeCommand("문 폭 1000으로 바꿔줘", context());

    expect(commands[0].tool).toBe("update_opening");
    expect(commands[0].arguments.width).toBe(1000);

    executeCommand(engine, commands[0]);
    expect(engine.getWalls()[0].openings[0].width).toBe(1000);
  });

  it("문 삭제 명령을 인식한다", () => {
    const { engine, context } = setup(true);
    const commands = routeCommand("문 없애줘", context());

    expect(commands[0].tool).toBe("delete_opening");
    executeCommand(engine, commands[0]);
    expect(engine.getWalls()[0].openings).toHaveLength(0);
  });

  it("벽 두께를 바꾼다", () => {
    const { context } = setup();
    const commands = routeCommand("벽 두께 200으로", context());

    expect(commands[0].tool).toBe("update_wall");
    expect(commands[0].arguments.thickness).toBe(200);
  });

  it("기존 객체 명령은 그대로 동작한다", () => {
    const { context } = setup();
    const commands = routeCommand("창문을 조금 크게", context());

    // 개구부 규칙이 일반 객체 편집을 가로채면 안 된다
    expect(commands[0].tool).toBe("scale_object");
  });
});
