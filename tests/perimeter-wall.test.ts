import { describe, expect, it } from "vitest";
import { isPerimeterWall, wallOutwardNormal } from "@/scene/geometry";
import type { RoomSpec, WallSegment } from "@/scene/types";

/**
 * 3D에서 바깥벽만 숨기고 칸막이는 늘 세워 두기 위한 판정.
 *
 * 대각선에서 볼 때 내벽까지 통째로 사라지던 문제의 회귀 시험이다.
 */
const room = {
  dimensions: { width: 10000, length: 8000, height: 2400 },
} as RoomSpec;

function wall(start: [number, number], end: [number, number], thickness = 200): WallSegment {
  return { id: "w", name: "벽", start, end, thickness, height: 2400, openings: [] };
}

describe("바깥 테두리 벽 판정", () => {
  it("아래 외벽 — 양 끝이 같은 변에 붙어 있으면 테두리다", () => {
    expect(isPerimeterWall(wall([0, 0], [10000, 0]), room)).toBe(true);
  });

  it("왼쪽·오른쪽·위 외벽도 마찬가지다", () => {
    expect(isPerimeterWall(wall([0, 0], [0, 8000]), room)).toBe(true);
    expect(isPerimeterWall(wall([10000, 0], [10000, 8000]), room)).toBe(true);
    expect(isPerimeterWall(wall([0, 8000], [10000, 8000]), room)).toBe(true);
  });

  it("한가운데 칸막이는 테두리가 아니다", () => {
    expect(isPerimeterWall(wall([4000, 2000], [4000, 6000]), room)).toBe(false);
  });

  /**
   * 이것이 실제로 사라지던 벽이다.
   *
   * 외벽에서 안쪽으로 뻗어 나온 짧은 가벽(현관 옆 같은)은 중점이 아직 외곽 띠 안에
   * 있어서, 중점만 보던 예전 판정으로는 테두리로 잡혔다.
   */
  it("외벽에 한쪽 끝만 닿은 짧은 칸막이는 테두리가 아니다", () => {
    expect(isPerimeterWall(wall([0, 4000], [600, 4000]), room)).toBe(false);
  });

  it("외벽에서 안으로 길게 뻗은 칸막이도 테두리가 아니다", () => {
    expect(isPerimeterWall(wall([0, 4000], [3000, 4000]), room)).toBe(false);
  });
});

describe("벽이 바깥을 보는 방향", () => {
  it("아래 외벽은 아래(-y)를 본다", () => {
    const [nx, ny] = wallOutwardNormal(wall([0, 0], [10000, 0]), room);
    expect(nx).toBeCloseTo(0);
    expect(ny).toBeCloseTo(-1);
  });

  it("위 외벽은 위(+y)를 본다", () => {
    const [nx, ny] = wallOutwardNormal(wall([0, 8000], [10000, 8000]), room);
    expect(nx).toBeCloseTo(0);
    expect(ny).toBeCloseTo(1);
  });

  it("왼쪽 외벽은 왼쪽(-x)을 본다", () => {
    const [nx, ny] = wallOutwardNormal(wall([0, 0], [0, 8000]), room);
    expect(nx).toBeCloseTo(-1);
    expect(ny).toBeCloseTo(0);
  });

  it("오른쪽 외벽은 오른쪽(+x)을 본다", () => {
    const [nx, ny] = wallOutwardNormal(wall([10000, 0], [10000, 8000]), room);
    expect(nx).toBeCloseTo(1);
    expect(ny).toBeCloseTo(0);
  });

  it("그린 방향이 반대여도 같은 쪽을 본다 — 시작·끝 순서에 좌우되지 않는다", () => {
    const forward = wallOutwardNormal(wall([0, 0], [10000, 0]), room);
    const backward = wallOutwardNormal(wall([10000, 0], [0, 0]), room);
    expect(backward[0]).toBeCloseTo(forward[0]);
    expect(backward[1]).toBeCloseTo(forward[1]);
  });

  it("길이가 0인 벽에도 NaN 을 내지 않는다", () => {
    const [nx, ny] = wallOutwardNormal(wall([5000, 4000], [5000, 4000]), room);
    expect(Number.isFinite(nx)).toBe(true);
    expect(Number.isFinite(ny)).toBe(true);
  });
});
