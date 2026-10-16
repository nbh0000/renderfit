import { describe, expect, it } from "vitest";
import { JOYSTICK, joystickInput, joystickKnob } from "@/scene/walk";

/**
 * 화면 조이스틱의 응답.
 *
 * 손가락으로 걷는 감각이 여기서 갈린다. 선형으로 두면 조금 밀었을 때와 많이 밀었을
 * 때의 차이가 그대로 속도가 되어, 벽 앞에서 살살 다가가려 해도 훅 들어가 버린다.
 *
 * 화면 좌표를 받는다는 것도 함께 못 박는다 — 화면은 아래로 y 가 커지므로 위로 밀면
 * 앞(+)이 나와야 한다. 이 부호가 뒤집히면 조이스틱을 위로 밀 때 뒷걸음질한다.
 */

describe("데드존", () => {
  it("살짝 얹은 것만으로는 걷지 않는다", () => {
    const still = joystickInput(3, 3);
    expect(still.x).toBe(0);
    expect(still.y).toBe(0);
    expect(still.run).toBe(false);
  });

  it("데드존을 갓 넘으면 아주 느리다", () => {
    const crawl = joystickInput(0, -(JOYSTICK.deadZone + 1));
    expect(crawl.y).toBeGreaterThan(0);
    expect(crawl.y).toBeLessThan(0.05);
  });
});

describe("방향", () => {
  it("위로 밀면 앞으로 간다", () => {
    // 화면 y 는 아래로 커진다 — 위로 미는 것은 dy 가 음수다
    const ahead = joystickInput(0, -JOYSTICK.radius);
    expect(ahead.y).toBeCloseTo(1, 5);
    expect(ahead.x).toBeCloseTo(0, 5);
  });

  it("아래로 밀면 뒤로 간다", () => {
    expect(joystickInput(0, JOYSTICK.radius).y).toBeCloseTo(-1, 5);
  });

  it("오른쪽으로 밀면 +x 다", () => {
    expect(joystickInput(JOYSTICK.radius, 0).x).toBeCloseTo(1, 5);
  });
});

describe("응답 곡선", () => {
  it("끝까지 밀면 최대치다", () => {
    const full = joystickInput(0, -JOYSTICK.radius);
    expect(Math.hypot(full.x, full.y)).toBeCloseTo(1, 5);
  });

  it("더 밀어도 최대치를 넘지 않는다", () => {
    const over = joystickInput(0, -(JOYSTICK.radius * 3));
    expect(Math.hypot(over.x, over.y)).toBeCloseTo(1, 5);
  });

  it("절반쯤 밀면 절반보다 느리다", () => {
    /*
     * 1.5제곱 곡선이라 중간이 선형보다 아래에 있다. 이 성질이 있어야 초반에
     * 천천히 걷는 구간이 생긴다.
     */
    const half = JOYSTICK.deadZone + (JOYSTICK.radius - JOYSTICK.deadZone) / 2;
    const input = joystickInput(0, -half);
    const magnitude = Math.hypot(input.x, input.y);

    expect(magnitude).toBeLessThan(0.5);
    expect(magnitude).toBeGreaterThan(0.2);
  });

  it("멀수록 빨라진다", () => {
    const near = joystickInput(0, -15);
    const far = joystickInput(0, -35);
    expect(far.y).toBeGreaterThan(near.y);
  });

  it("대각선도 크기가 1을 넘지 않는다", () => {
    const diagonal = joystickInput(JOYSTICK.radius, -JOYSTICK.radius);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeLessThanOrEqual(1.0001);
  });
});

describe("달리기", () => {
  it("베이스 안에서는 걷는다", () => {
    expect(joystickInput(0, -JOYSTICK.radius).run).toBe(false);
  });

  it("베이스 밖까지 밀면 달린다", () => {
    expect(joystickInput(0, -(JOYSTICK.radius + JOYSTICK.runExtra)).run).toBe(true);
  });

  it("달리는 중에도 방향은 그대로다", () => {
    const running = joystickInput(0, -200);
    expect(running.run).toBe(true);
    expect(running.y).toBeCloseTo(1, 5);
  });
});

describe("손잡이 그리기", () => {
  it("반지름 안에서는 손가락을 그대로 따라간다", () => {
    expect(joystickKnob(10, -20)).toEqual([10, -20]);
  });

  it("반지름을 넘으면 테두리에 붙는다", () => {
    // 손가락은 더 나갔는데 손잡이가 따라 나가면 조이스틱으로 안 보인다
    const [x, y] = joystickKnob(0, -300);
    expect(Math.hypot(x, y)).toBeCloseTo(JOYSTICK.radius, 5);
    expect(y).toBeLessThan(0);
  });

  it("방향은 유지한다", () => {
    const [x, y] = joystickKnob(300, 300);
    expect(x).toBeCloseTo(y, 5);
    expect(x).toBeGreaterThan(0);
  });
});
