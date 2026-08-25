import { describe, expect, it } from "vitest";
import { buildPlanSvg, toPlanData } from "@/services/cadExport";
import { buildElevationSvg } from "@/services/elevationExport";
import { buildPdf } from "@/services/pdfExport";
import { SceneEngine, createSceneObject } from "@/scene/engine/SceneEngine";
import { createEmptyScene } from "@/scene/serialization";

/**
 * 도면 한 부(PDF).
 *
 * 도면을 주고받는 방식은 장마다 파일 하나가 아니라 "한 부"다. 평면도·입면도·3D를
 * 한 파일에 순서대로 담아, 받는 사람이 열어서 그대로 인쇄하면 도면집이 되게 한다.
 *
 * 여기서 확인하는 것은 세 가지다.
 *   · 우리 SVG 가 실제로 구워지는가 (한글 글자와 해치가 든 SVG 다)
 *   · 한 장이 실패해도 나머지가 나오는가
 *   · 한 장도 못 만들면 조용히 빈 파일을 주지 않고 실패하는가
 */

/** 가구가 든 장면 하나 — 해치·기호·치수가 모두 그려지는 도면이 나온다 */
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
  return engine.getScene();
}

function planSheets() {
  const plan = toPlanData(sceneWithFurniture(), "테스트 현장");
  return {
    plan,
    sheets: [
      { title: "평면도", svg: buildPlanSvg(plan) },
      ...plan.walls.slice(0, 2).map((wall) => ({
        title: `입면도 — ${wall.name || wall.id}`,
        svg: buildElevationSvg({ plan, wall }),
      })),
    ],
  };
}

describe("도면 PDF", () => {
  it("평면도와 입면도를 한 부로 묶는다", async () => {
    const { sheets } = planSheets();
    const result = await buildPdf(sheets);

    expect(result.included).toEqual(sheets.map((sheet) => sheet.title));
    expect(result.skipped).toEqual([]);

    // 진짜 PDF 인지 — 앞머리 다섯 글자가 %PDF- 여야 한다
    expect(new TextDecoder().decode(result.bytes.slice(0, 5))).toBe("%PDF-");
    // 장수만큼 그림이 들어갔으니 빈 껍데기일 수 없다
    expect(result.bytes.byteLength).toBeGreaterThan(20_000);
  }, 60_000);

  it("한 장이 깨져도 나머지는 낸다", async () => {
    const { sheets } = planSheets();
    const result = await buildPdf([
      ...sheets.slice(0, 1),
      { title: "깨진 장", svg: "<svg><이건 SVG 가 아니다" },
    ]);

    expect(result.included).toEqual(["평면도"]);
    expect(result.skipped).toEqual(["깨진 장"]);
  }, 60_000);

  it("한 장도 못 만들면 빈 파일 대신 실패한다", async () => {
    await expect(buildPdf([{ title: "빈 장" }])).rejects.toThrow(
      "도면을 한 장도 만들지 못했습니다."
    );
  }, 30_000);

  it("3D 캡처 같은 PNG 도 한 장으로 받는다", async () => {
    const sharp = (await import("sharp")).default;
    const png = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "#c8d0d8" },
    })
      .png()
      .toBuffer();

    const result = await buildPdf([{ title: "3D", png }]);
    expect(result.included).toEqual(["3D"]);
  }, 30_000);
});
