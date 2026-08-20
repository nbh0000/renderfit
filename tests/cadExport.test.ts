import { describe, expect, it } from "vitest";
import { buildDxf, buildPlanSvg, toPlanData, CAD_DISCLAIMER } from "@/services/cadExport";
import { SceneEngine, createSceneObject } from "@/scene/engine/SceneEngine";
import { createEmptyScene } from "@/scene/serialization";

function sceneWithFurniture() {
  const engine = new SceneEngine(createEmptyScene());
  engine.addObject(
    createSceneObject({
      id: "sofa_001",
      type: "sofa",
      name: "소파",
      dimensions: { width: 2200, height: 850, depth: 950 },
      screen: { x: 0.2, y: 0.5, width: 0.3, height: 0.2, rotation: 0 },
      depth: 0.4,
    })
  );
  engine.addObject(
    createSceneObject({
      id: "table_001",
      type: "table",
      name: "커피 테이블",
      dimensions: { width: 1100, height: 400, depth: 600 },
      screen: { x: 0.5, y: 0.6, width: 0.18, height: 0.1, rotation: 45 },
      depth: 0.3,
    })
  );
  return engine.getScene();
}

describe("CAD 도면 데이터", () => {
  it("Scene 좌표를 mm 도면 좌표로 변환한다", () => {
    const plan = toPlanData(sceneWithFurniture(), "테스트 현장");

    expect(plan.roomWidth).toBe(5000);
    expect(plan.roomLength).toBe(6000);
    expect(plan.objects).toHaveLength(2);

    const sofa = plan.objects.find((o) => o.id === "sofa_001")!;
    // screen.x 0.2 + width 0.3/2 = 0.35 → 5000 * 0.35 = 1750
    expect(sofa.cx).toBeCloseTo(1750, 0);
    // depth 0.4 → 6000 * 0.4 = 2400
    expect(sofa.cy).toBeCloseTo(2400, 0);
    expect(sofa.width).toBe(2200);
    expect(sofa.depth).toBe(950);
  });

  it("벽·천장·바닥은 도면 객체에서 제외한다", () => {
    const engine = new SceneEngine(createEmptyScene());
    engine.addObject(createSceneObject({ type: "wall", name: "벽" }));
    engine.addObject(createSceneObject({ type: "sofa", name: "소파" }));

    const plan = toPlanData(engine.getScene(), "테스트");
    expect(plan.objects.map((o) => o.name)).toEqual(["소파"]);
  });
});

describe("DXF 출력", () => {
  const dxf = buildDxf(toPlanData(sceneWithFurniture(), "테스트 현장"));

  it("R12 구조를 갖춘다", () => {
    expect(dxf).toContain("AC1009");
    expect(dxf).toContain("SECTION");
    expect(dxf).toContain("ENTITIES");
    expect(dxf.trimEnd().endsWith("EOF")).toBe(true);
  });

  it("단위를 밀리미터로 선언한다", () => {
    const insunitsIndex = dxf.indexOf("$INSUNITS");
    expect(insunitsIndex).toBeGreaterThan(-1);
    // $INSUNITS 다음의 값이 4(mm)
    expect(dxf.slice(insunitsIndex, insunitsIndex + 40)).toContain("4");
  });

  it("도면 레이어를 포함한다", () => {
    for (const layer of ["A-WALL", "A-DIMS", "I-FURN", "A-NOTE"]) {
      expect(dxf).toContain(layer);
    }
  });

  it("가구 이름과 치수를 도면에 기입한다", () => {
    expect(dxf).toContain("소파");
    expect(dxf).toContain("2200x950");
  });

  it("타이틀블록에 실측 고지를 인쇄한다", () => {
    expect(dxf).toContain(CAD_DISCLAIMER);
  });

  it("좌표는 유효한 숫자만 출력한다", () => {
    expect(dxf).not.toContain("NaN");
    expect(dxf).not.toContain("undefined");
  });
});

describe("평면도 SVG", () => {
  const svg = buildPlanSvg(toPlanData(sceneWithFurniture(), "테스트 현장"));

  it("치수와 고지를 포함한 SVG를 만든다", () => {
    expect(svg.startsWith("<svg")).toBe(true);
    // 전체 치수는 사방 치수 체인의 바깥 줄에 숫자만 찍힌다 (mm 단위는 타이틀블록에 적는다)
    expect(svg).toContain(">5000<");
    expect(svg).toContain(">6000<");
    expect(svg).toContain(CAD_DISCLAIMER);
    expect(svg).not.toContain("NaN");
  });

  it("회전한 가구도 폴리곤으로 그린다", () => {
    expect(svg).toContain("<polygon");
  });
});
