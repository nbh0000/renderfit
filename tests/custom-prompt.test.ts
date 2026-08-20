import { describe, expect, it } from "vitest";
import { buildPrompt } from "@/lib/prompt";
import { EMPTY_MATERIALS, type GenerationSettings } from "@/lib/types";

/**
 * 사용자가 직접 쓴 요청이 방 종류·스타일 기본값에 묻히지 않아야 한다.
 * "여기는 매장이다"라고 써도 거실 가구가 나오던 문제를 막는 회귀 테스트다.
 */
function settings(customPrompt?: string): GenerationSettings {
  return {
    modeId: "redesign",
    roomId: "living-room",
    styleId: "modern",
    resolution: "standard",
    materials: EMPTY_MATERIALS,
    useMask: false,
    projectId: null,
    size: { unit: "pyeong", pyeong: 12 },
    customPrompt,
  } as GenerationSettings;
}

describe("사용자 추가 요청", () => {
  it("방 종류 기본값보다 앞에 놓인다", () => {
    const prompt = buildPrompt(settings("여기는 홀 장사하는 매장이다."));
    expect(prompt.indexOf("사용자 요청:")).toBeLessThan(prompt.indexOf("대상 공간:"));
  });

  it("구조 보존 원칙은 여전히 맨 앞에 남는다", () => {
    const prompt = buildPrompt(settings("여기는 홀 장사하는 매장이다."));
    expect(prompt.indexOf("벽·창문·문·천장")).toBeLessThan(prompt.indexOf("사용자 요청:"));
  });

  it("용도를 바꾸라는 요청이면 기본 방 종류를 대체하라고 지시한다", () => {
    const prompt = buildPrompt(settings("여기는 홀 장사하는 매장이다."));
    expect(prompt).toContain("그 쪽을 따라 가구와 집기를 배치한다");
  });

  it("끝에서 한 번 더 반복해 묻히지 않게 한다", () => {
    const prompt = buildPrompt(settings("테이블 여러 개를 놓아 주세요."));
    const first = prompt.indexOf("테이블 여러 개를 놓아 주세요.");
    const last = prompt.lastIndexOf("테이블 여러 개를 놓아 주세요.");
    expect(last).toBeGreaterThan(first);
  });

  it("요청이 없으면 관련 문장이 붙지 않는다", () => {
    const prompt = buildPrompt(settings());
    expect(prompt).not.toContain("사용자 요청");
  });
});
