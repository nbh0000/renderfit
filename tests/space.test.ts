import { describe, expect, it } from "vitest";
import {
  buildSpaceFragment,
  describeSpaceSize,
  normalizeSpaceSize,
  spaceAreaM2,
  toRoomDimensions,
} from "@/lib/space";
import { buildPrompt } from "@/lib/prompt";
import { furnitureScaleGuide } from "@/config/space";
import { EMPTY_MATERIALS, type GenerationSettings } from "@/lib/types";

function settings(size: GenerationSettings["size"]): GenerationSettings {
  return {
    modeId: "redesign",
    roomId: "living-room",
    styleId: "modern",
    resolution: "standard",
    materials: EMPTY_MATERIALS,
    useMask: false,
    size,
  };
}

describe("공간 크기 입력", () => {
  it("평수를 면적으로 환산한다", () => {
    const size = normalizeSpaceSize({ unit: "pyeong", pyeong: 24 });
    expect(size).not.toBeNull();
    expect(spaceAreaM2(size!)).toBeCloseTo(79.3, 1);
  });

  it("치수를 면적으로 환산한다", () => {
    const size = normalizeSpaceSize({ unit: "mm", width: 3600, length: 4200 });
    expect(spaceAreaM2(size!)).toBeCloseTo(15.1, 1);
  });

  it("범위를 벗어난 값은 버린다", () => {
    expect(normalizeSpaceSize({ unit: "pyeong", pyeong: 0 })).toBeNull();
    expect(normalizeSpaceSize({ unit: "pyeong", pyeong: 5000 })).toBeNull();
    expect(normalizeSpaceSize({ unit: "mm", width: 100, length: 4200 })).toBeNull();
    expect(normalizeSpaceSize({ unit: "mm", width: 3600 })).toBeNull();
    expect(normalizeSpaceSize(null)).toBeNull();
    expect(normalizeSpaceSize({ unit: "평" })).toBeNull();
  });

  it("천장 높이는 범위 안에서만 받는다", () => {
    expect(normalizeSpaceSize({ unit: "pyeong", pyeong: 24, height: 2400 })?.height).toBe(2400);
    expect(normalizeSpaceSize({ unit: "pyeong", pyeong: 24, height: 300 })?.height).toBeUndefined();
  });

  it("설명 문구에 평과 ㎡가 함께 들어간다", () => {
    const pyeong = describeSpaceSize({ unit: "pyeong", pyeong: 24, height: 2400 });
    expect(pyeong).toContain("24평");
    expect(pyeong).toContain("79.3㎡");
    expect(pyeong).toContain("2400mm");

    const mm = describeSpaceSize({ unit: "mm", width: 3600, length: 4200 });
    expect(mm).toContain("3600");
    expect(mm).toContain("15.1㎡");
    expect(mm).toContain("4.6평");
  });

  it("평수만 받아도 도면용 치수를 추정한다", () => {
    const dimensions = toRoomDimensions({ unit: "pyeong", pyeong: 15 })!;
    const area = (dimensions.width / 1000) * (dimensions.length / 1000);
    expect(area).toBeCloseTo(15 * 3.305785, 0);
    expect(dimensions.height).toBe(2400);
  });
});

describe("프롬프트 반영", () => {
  it("크기를 입력하면 면적 지시문이 들어간다", () => {
    const prompt = buildPrompt(settings({ unit: "pyeong", pyeong: 24 }));
    expect(prompt).toContain("24평");
    expect(prompt).toContain("79.3㎡");
    // 환산 치수와 면적 구간별 가구 규모까지 숫자로 넘어가야 한다.
    expect(prompt).toContain("가로 8.0m × 세로 10.0m");
    expect(prompt).toContain("면적에 비해 지나치게 크거나 많은 가구를 넣지 않고");
  });

  it("좁은 면적에는 큰 가구를 넣지 말라는 지시가 붙는다", () => {
    const prompt = buildPrompt(settings({ unit: "pyeong", pyeong: 3 }));
    expect(prompt).toContain("폭 1400mm를 넘는 가구는 놓지 않는다");
    expect(prompt).toContain("35%");
  });

  it("넓어질수록 허용 가구 규모가 커진다", () => {
    expect(furnitureScaleGuide(12)).toContain("1600mm");
    expect(furnitureScaleGuide(30)).toContain("50%");
    expect(furnitureScaleGuide(200)).toContain("구역으로 나눠");
    // 가장 큰 구간에도 제약이 있어야 한다 — 예전에는 비어 있었다
    expect(furnitureScaleGuide(200)).toContain("60%");
  });

  it("가구 규모 지시에 특정 가구 이름을 강제하지 않는다", () => {
    // 매장·사무실 요청과 충돌하지 않아야 한다.
    for (const area of [8, 12, 20, 30, 50, 100]) {
      expect(furnitureScaleGuide(area)).not.toContain("TV장");
    }
  });

  it("사진이 넓어 보여도 입력한 면적을 따르라고 못박는다", () => {
    const prompt = buildPrompt(settings({ unit: "pyeong", pyeong: 12 }));
    expect(prompt).toContain("사진 속 공간이 실제보다 넓어 보이더라도");
  });

  it("크기를 비우면 문장이 붙지 않는다", () => {
    const prompt = buildPrompt(settings(null));
    expect(prompt).not.toContain("대상 공간의 실제 크기");
  });

  it("잘못된 크기는 무시된다", () => {
    expect(buildSpaceFragment({ unit: "mm", width: 10, length: 10 })).toBe("");
  });

  it("구조 보존 원칙은 크기 지시보다 앞에 남는다", () => {
    const prompt = buildPrompt(settings({ unit: "mm", width: 3600, length: 4200 }));
    expect(prompt.indexOf("벽·창문·문·천장")).toBeLessThan(prompt.indexOf("대상 공간의 실제 크기"));
  });
});
