import { describe, expect, it } from "vitest";
import { buildPrompt } from "@/lib/prompt";
import { ROOMS } from "@/config/rooms";
import { STYLES } from "@/config/styles";
import { MODES } from "@/config/modes";
import { EMPTY_MATERIALS, type GenerationSettings } from "@/lib/types";

/**
 * 사진 속 구조를 지어내지 않는지 본다.
 *
 * 업소용 주방 사진을 리디자인했더니 통창과 커튼, 우물천장이 있는 아파트 거실이 나왔다.
 * 원인은 모델이 아니라 프롬프트였다 — 방 설명이 공간의 생김새를 처방하고 있어서
 * 구조 보존 지시와 정면으로 부딪혔고, 처방 쪽이 이겼다.
 *
 * 유료 호출 없이 프롬프트 문자열만 본다.
 */
function settings(overrides: Partial<GenerationSettings> = {}): GenerationSettings {
  return {
    modeId: "redesign",
    roomId: "living-room",
    styleId: "modern",
    resolution: "standard",
    materials: EMPTY_MATERIALS,
    useMask: false,
    projectId: null,
    size: { unit: "pyeong", pyeong: 15 },
    customPrompt: undefined,
    ...overrides,
  } as GenerationSettings;
}

/** 공간의 생김새를 처방하는 낱말 — 방 설명에 하나라도 들어가면 안 된다 */
const 생김새_낱말 = [
  "통창",
  "우물천장",
  "단창",
  "중문",
  "직사각형",
  "붙박이장",
  "상·하부장",
  "아일랜드",
  "샤워부스",
  "욕조",
  "몰딩",
];

describe("방 설명은 용도만 적는다", () => {
  it.each(ROOMS.map((room) => [room.label, room] as const))(
    "%s — 생김새를 처방하지 않는다",
    (_label, room) => {
      for (const word of 생김새_낱말) {
        expect(room.promptFragment).not.toContain(word);
      }
    }
  );
});

describe("구조 보존 지시", () => {
  it.each(MODES.map((mode) => [mode.label, mode.id] as const))(
    "%s 모드 — 없는 창문을 만들지 말라고 못박는다",
    (_label, modeId) => {
      const prompt = buildPrompt(settings({ modeId }));
      expect(prompt).toContain("없는 창문·문·개구부를 새로 만들지 않고");
      expect(prompt).toContain("없애거나 크기·모양·위치를 바꾸지 않는다");
    }
  );

  it("프롬프트 맨 앞과 맨 뒤에 각각 한 번씩 들어간다", () => {
    const prompt = buildPrompt(settings());
    const lines = prompt.split("\n");
    expect(lines[0]).toContain("벽·창문·문·개구부·천장");
    expect(prompt).toContain("마지막으로 다시 확인한다.");
  });
});

describe("방 종류는 참고값이다", () => {
  it("사진과 다르면 사진을 따르라고 적는다", () => {
    const prompt = buildPrompt(settings());
    expect(prompt).toContain("입력 사진에 보이는 공간이 이와 다르면 사진 쪽을 따른다");
  });

  it("대상 공간 바로 뒤에 붙는다 — 떨어뜨려 놓으면 묻힌다", () => {
    const prompt = buildPrompt(settings());
    const lines = prompt.split("\n");
    const 대상 = lines.findIndex((line) => line.startsWith("대상 공간:"));
    expect(대상).toBeGreaterThanOrEqual(0);
    expect(lines[대상 + 1]).toContain("이 방 종류는 참고값이다");
  });

  it("모든 모드에 들어간다 — 방 선택은 어느 모드에서나 기본값이 남아 있을 수 있다", () => {
    for (const mode of MODES) {
      expect(buildPrompt(settings({ modeId: mode.id }))).toContain("이 방 종류는 참고값이다");
    }
  });
});

/**
 * 스타일 묘사가 구조를 처방하지 않는지 본다.
 *
 * 클래식으로 리디자인한 사진에서, 밋밋하던 벽이 웨인스코팅 판넬로 덮이면서 창까지
 * 격자창으로 다시 그려졌다. 사용자가 "창문이 모양이 달라져서는 안돼"라고 잘랐다.
 * 원인은 스타일 문장에 벽 구조를 처방하는 낱말이 들어 있던 것이다.
 */
const 구조_처방_낱말 = ["웨인스코팅", "몰딩 벽", "격자창", "우물천장", "통창", "노출 배관", "아치"];

describe("스타일 묘사는 구조를 처방하지 않는다", () => {
  it.each(STYLES.map((style) => [style.label, style] as const))(
    "%s — 벽·창·천장의 생김새를 지시하지 않는다",
    (_label, style) => {
      for (const word of 구조_처방_낱말) {
        expect(style.promptFragment).not.toContain(word);
      }
    }
  );
});

describe("창은 모양까지 원본 그대로", () => {
  it.each(MODES.map((mode) => [mode.label, mode.id] as const))(
    "%s 모드 — 창살·격자를 새로 넣지 말라고 적는다",
    (_label, modeId) => {
      const prompt = buildPrompt(settings({ modeId }));
      expect(prompt).toContain("프레임 분할(창살·격자·중간틀)");
      expect(prompt).toContain("원본에 없는 창살이나 격자를 넣지 않는다");
    }
  );

  it("스타일을 쓰는 모드에는 스타일 적용 범위가 스타일 묘사 바로 뒤에 붙는다", () => {
    for (const mode of MODES.filter((item) => item.usesStyle)) {
      const lines = buildPrompt(settings({ modeId: mode.id, styleId: "classic" })).split("\n");
      const 스타일 = lines.findIndex((line) => line.startsWith("클래식 스타일:"));
      expect(스타일).toBeGreaterThanOrEqual(0);
      expect(lines[스타일 + 1]).toContain("스타일과 구조 보존이 부딪히면 언제나 구조 보존이 이긴다");
    }
  });

  it("스타일을 쓰지 않는 모드에는 빈 자리가 남지 않는다", () => {
    for (const mode of MODES) {
      expect(buildPrompt(settings({ modeId: mode.id }))).not.toContain("{{");
    }
  });
});
