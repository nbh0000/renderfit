import { describe, expect, it } from "vitest";

/**
 * 3D에서 상판과 다리가 뚝 떨어져 보이던 문제.
 *
 * 가구의 원점은 한가운데다. 그래서 바닥은 y = -높이/2 에 있다. 그런데 다리를 제 길이의
 * 절반만큼만 내려 두고 있었다(y = -다리길이/2). 그러면 다리는 바닥이 아니라 가구
 * 한가운데에 매달린다 — 옆에서 보면 상판이 공중에 뜨고, 다리 끝은 바닥을 뚫고 내려간다.
 *
 * 계산을 여기 옮겨 두고 못 박는다. 3D는 눈으로만 확인할 수 있어서, 이런 종류의
 * 어긋남은 숫자로 잡아 두지 않으면 다음에 또 조용히 돌아온다.
 */

/** 다리 원통의 중심 y (FurnitureMesh 의 Legs 와 같은 식) */
function legCenterY(floorY: number, legHeight: number): number {
  return floorY + legHeight / 2;
}

/** 다리가 차지하는 위아래 범위 */
function legSpan(floorY: number, legHeight: number): { bottom: number; top: number } {
  const center = legCenterY(floorY, legHeight);
  return { bottom: center - legHeight / 2, top: center + legHeight / 2 };
}

describe("가구 다리 위치", () => {
  it("책상 다리가 바닥에 닿고 상판 밑면에 붙는다", () => {
    const height = 0.75;
    const topThickness = Math.max(0.03, height * 0.1);
    const floorY = -height / 2;

    const span = legSpan(floorY, height - topThickness);
    /** 상판은 맨 위에 있고, 그 밑면이 다리가 닿아야 할 자리다 */
    const topUnderside = height / 2 - topThickness;

    expect(span.bottom).toBeCloseTo(floorY, 6);
    expect(span.top).toBeCloseTo(topUnderside, 6);
  });

  it("의자 다리가 바닥에서 앉는 면까지다", () => {
    const height = 0.85;
    const floorY = -height / 2;
    const seatY = -height / 2 + height * 0.45;

    const span = legSpan(floorY, height * 0.45);

    expect(span.bottom).toBeCloseTo(floorY, 6);
    expect(span.top).toBeCloseTo(seatY, 6);
  });

  it("소파 다리도 바닥에서 시작한다", () => {
    const height = 0.85;
    const floorY = -height / 2;

    expect(legSpan(floorY, 0.12).bottom).toBeCloseTo(floorY, 6);
  });

  it("예전 방식은 다리가 바닥을 뚫고 상판과 벌어졌다", () => {
    // 회귀 기록 — 고치기 전에는 다리 중심이 -다리길이/2 였다.
    const height = 0.75;
    const topThickness = height * 0.1;
    const legHeight = height - topThickness;

    const oldCenter = -legHeight / 2;
    const oldBottom = oldCenter - legHeight / 2;
    const oldTop = oldCenter + legHeight / 2;

    const floorY = -height / 2;
    const topUnderside = height / 2 - topThickness;

    // 바닥(-0.375)보다 0.3m 아래로 내려가 있었다
    expect(oldBottom).toBeLessThan(floorY);
    expect(floorY - oldBottom).toBeCloseTo(0.3, 2);
    // 상판 밑면(0.3)과도 0.3m 벌어져 있었다
    expect(topUnderside - oldTop).toBeCloseTo(0.3, 2);
  });
});
