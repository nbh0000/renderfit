import { describe, expect, it } from "vitest";
import { sizeFromText } from "@/lib/space";
import { buildPrompt } from "@/lib/prompt";
import { EMPTY_MATERIALS, type GenerationSettings } from "@/lib/types";

/**
 * "8평에 맞게 해줘"라고 써 놓고 공간 크기 입력은 45평이 남아 있던 실제 사례를 막는다.
 * 한 프롬프트에 두 면적이 같이 들어가면 모델이 어느 쪽도 따르지 못한다.
 */

function settings(customPrompt?: string, pyeong = 45): GenerationSettings {
  return {
    modeId: "redesign",
    roomId: "bedroom",
    styleId: "midcentury",
    resolution: "standard",
    materials: EMPTY_MATERIALS,
    useMask: false,
    projectId: null,
    size: { unit: "pyeong", pyeong },
    customPrompt,
  } as GenerationSettings;
}

describe("문장에서 면적 읽기", () => {
  it("평수를 찾는다", () => {
    expect(sizeFromText("8평에 맞는 디자인해줘")).toEqual({ unit: "pyeong", pyeong: 8 });
    expect(sizeFromText("41평 아파트")).toEqual({ unit: "pyeong", pyeong: 41 });
    expect(sizeFromText("8.5 평 원룸")).toEqual({ unit: "pyeong", pyeong: 8.5 });
  });

  it("제곱미터도 평으로 바꿔 읽는다", () => {
    expect(sizeFromText("26㎡ 공간")?.pyeong).toBeCloseTo(7.9, 1);
    expect(sizeFromText("40 m2")?.pyeong).toBeCloseTo(12.1, 1);
  });

  it("면적이 없거나 범위 밖이면 무시한다", () => {
    expect(sizeFromText("밝은 우드 톤으로")).toBeNull();
    expect(sizeFromText("9999평")).toBeNull();
    expect(sizeFromText(null)).toBeNull();
  });
});

describe("프롬프트 면적 충돌", () => {
  it("문장에 적힌 평수가 크기 입력을 이긴다", () => {
    const prompt = buildPrompt(settings("8평에 맞는 디자인해줘", 45));

    expect(prompt).toContain("약 8평(26.4㎡)");
    expect(prompt).not.toContain("약 45평");
    expect(prompt).toContain("다른 면적이 언급되더라도 이 값을 따른다");
  });

  it("문장에 평수가 없으면 크기 입력을 그대로 쓴다", () => {
    const prompt = buildPrompt(settings("밝은 우드 톤으로", 45));
    expect(prompt).toContain("약 45평");
    expect(prompt).not.toContain("다른 면적이 언급되더라도");
  });

  it("넓은 면적에도 가구 규모 제약이 붙는다", () => {
    // 45평(148.8㎡)은 가장 큰 구간이라 예전에는 아무 제약이 없었다.
    const prompt = buildPrompt(settings(undefined, 45));
    expect(prompt).toContain("벽 폭의 60%");
    expect(prompt).toContain("바닥 면적의 55%");
  });
});
