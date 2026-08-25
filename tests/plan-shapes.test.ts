import { describe, expect, it } from "vitest";
import fixture from "./fixtures/office-plan.json";
import { buildPlanSvg, toPlanData } from "@/services/cadExport";
import { analysisToScene } from "@/services/projectService";
import { createEmptyScene } from "@/scene/serialization";
import { footprintArea } from "@/scene/footprint";
import type { RoomAnalysis } from "@/ai/providers/types";

/**
 * 도면에 그려진 모양이 끝까지 살아 오는지.
 *
 * 사용자가 넣은 사무실 도면에는 ㄱ자 책상과 등받이 있는 의자가 그려져 있는데, 우리
 * 평면도에는 전부 같은 네모가 앉았다. 폭·깊이 두 숫자 안에는 모양이 없기 때문이다.
 *
 * 이 자료는 그 도면을 실제로 한 번 분석해 받은 응답이다. 유료 호출이라 다시 돌리지
 * 않고 여기 고정해 둔다 — 모양이 분석에서 도면까지 이어지는 길은 이걸로 다 검증된다.
 */

const analysis = fixture as unknown as RoomAnalysis;

/** 이름에 이 말이 들어간 가구 */
function find(name: string) {
  return (analysis.plan?.furniture ?? []).find((item) => item.name.includes(name));
}

describe("도면에서 읽은 모양", () => {
  it("ㄱ자 책상이 ㄱ자로 온다", () => {
    const desk = find("L자");
    expect(desk).toBeDefined();
    expect(desk!.footprint?.length).toBeGreaterThanOrEqual(6);
    // 사각형이면 넓이 비율이 1이다. ㄱ자는 그보다 확실히 작아야 한다.
    expect(footprintArea(desk!.footprint!)).toBeLessThan(0.85);
  });

  it("의자에도 모양이 붙는다", () => {
    const chair = find("의자");
    expect(chair?.footprint?.length).toBeGreaterThan(3);
  });

  it("모든 모양이 자기 좌표계 안에 있다", () => {
    for (const item of analysis.plan?.furniture ?? []) {
      for (const [x, y] of item.footprint ?? []) {
        expect(Math.abs(x)).toBeLessThanOrEqual(0.5001);
        expect(Math.abs(y)).toBeLessThanOrEqual(0.5001);
      }
    }
  });
});

describe("모양이 도면까지 이어진다", () => {
  const scene = analysisToScene(createEmptyScene(), analysis);

  it("장면에 모양이 실린다", () => {
    const shaped = scene.objects.filter((object) => object.footprint?.length);
    expect(shaped.length).toBeGreaterThanOrEqual(5);
  });

  it("평면도가 네모 대신 그 모양을 그린다", () => {
    const svg = buildPlanSvg(toPlanData(scene, "사무실"));
    // 모양이 있는 가구 수만큼 path 가 나와야 한다 (네모면 rect 로 나간다)
    const paths = (svg.match(/<path d="M/g) ?? []).length;
    expect(paths).toBeGreaterThanOrEqual(5);
  });

  it("실 이름과 벽은 그대로 살아 있다", () => {
    const plan = toPlanData(scene, "사무실");
    expect(plan.areas.length).toBeGreaterThan(0);
    expect(plan.walls.length).toBeGreaterThan(3);
  });
});
