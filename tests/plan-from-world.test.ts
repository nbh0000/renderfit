import { describe, expect, it } from "vitest";
import { planFromWorld, worldXZ } from "@/scene/placement";
import type { RoomSpec } from "@/scene/types";

/**
 * 3D → 평면 역변환.
 *
 * 걷기 모드가 매 프레임 쓴다. 카메라를 3D 에서 움직인 뒤 그 자리가 평면의 어디인지
 * 알아야 벽·가구와의 충돌을 풀 수 있기 때문이다.
 *
 * z 부호가 뒤집힌다는 것 하나 때문에 손으로 다시 쓰면 반드시 틀린다 — 앞으로 걸었는데
 * 뒤로 가고, 벽이 반대쪽에서 막는다. 그래서 왕복이 제자리로 오는지 못 박아 둔다.
 */

const room: RoomSpec = {
  type: "living-room",
  dimensions: { width: 4000, length: 3000, height: 2400 },
};

describe("worldXZ 의 역함수", () => {
  it("왕복하면 제자리로 온다", () => {
    for (const point of [
      { cx: 0, cy: 0 },
      { cx: 4000, cy: 3000 },
      { cx: 1234, cy: 2345 },
      { cx: 2000, cy: 1500 },
    ]) {
      const back = planFromWorld(worldXZ(point, room), room);
      expect(back.cx).toBeCloseTo(point.cx, 6);
      expect(back.cy).toBeCloseTo(point.cy, 6);
    }
  });

  it("방 한가운데는 3D 원점이다", () => {
    expect(planFromWorld([0, 0], room)).toEqual({ cx: 2000, cy: 1500 });
  });

  it("도면 안쪽(y가 큰 쪽)이 3D 의 -z 다", () => {
    // 이 부호가 뒤집히면 걷기에서 앞뒤가 바뀐다
    const inner = planFromWorld([0, -1], room);
    const outer = planFromWorld([0, 1], room);

    expect(inner.cy).toBeGreaterThan(outer.cy);
    expect(inner.cy).toBe(2500);
    expect(outer.cy).toBe(500);
  });

  it("3D 의 +x 가 도면 오른쪽이다", () => {
    expect(planFromWorld([1, 0], room).cx).toBe(3000);
    expect(planFromWorld([-1, 0], room).cx).toBe(1000);
  });

  it("m 와 mm 를 제대로 오간다", () => {
    // 1m 움직이면 평면에서 1000mm 다
    const a = planFromWorld([0, 0], room);
    const b = planFromWorld([1, 0], room);
    expect(b.cx - a.cx).toBe(1000);
  });
});
