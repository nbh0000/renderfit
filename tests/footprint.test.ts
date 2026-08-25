import { describe, expect, it } from "vitest";
import {
  FOOTPRINT_SHAPES,
  footprintArea,
  footprintPath,
  normalizeFootprint,
  resolveFootprint,
  shapePolygon,
} from "@/scene/footprint";

/**
 * 가구가 평면에서 차지하는 모양.
 *
 * 지금까지 가구는 x·y·폭·깊이·회전 다섯 숫자뿐이라, 도면에 ㄱ자 책상이 그려져 있어도
 * 평면도에는 네모가 앉았다. 다섯 숫자 안에 모양이 없으니 받는 쪽에서 아무리 잘 그려도
 * 네모밖에 나올 수 없다.
 *
 * 모델이 주는 점 목록은 믿을 수 없으므로 반드시 걸러야 한다 — 점이 두 개뿐이거나,
 * 같은 점이 스무 번 반복되거나, 축척이 제각각인 답이 실제로 온다.
 */

describe("모양 다듬기", () => {
  it("어떤 축척으로 와도 -0.5~0.5 에 맞춘다", () => {
    // mm 로 온 ㄱ자 — 축척은 우리가 맞춘다
    const points = normalizeFootprint([
      { x: 0, y: 0 },
      { x: 1400, y: 0 },
      { x: 1400, y: 600 },
      { x: 600, y: 600 },
      { x: 600, y: 1400 },
      { x: 0, y: 1400 },
    ]);

    expect(points).not.toBeNull();
    const xs = points!.map(([x]) => x);
    const ys = points!.map(([, y]) => y);
    expect(Math.min(...xs)).toBeCloseTo(-0.5, 4);
    expect(Math.max(...xs)).toBeCloseTo(0.5, 4);
    expect(Math.min(...ys)).toBeCloseTo(-0.5, 4);
    expect(Math.max(...ys)).toBeCloseTo(0.5, 4);
  });

  it("[x, y] 배열로 와도 받는다", () => {
    expect(
      normalizeFootprint([
        [0, 0],
        [1, 0],
        [1, 1],
      ])
    ).toHaveLength(3);
  });

  it("겹쳐 찍힌 점은 버린다", () => {
    const points = normalizeFootprint([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ]);
    expect(points).toHaveLength(3);
  });

  it("닫으려고 첫 점을 다시 찍었으면 하나만 남긴다", () => {
    const points = normalizeFootprint([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0, y: 0 },
    ]);
    expect(points).toHaveLength(4);
  });

  it("다각형이 아닌 것은 없는 것으로 본다", () => {
    expect(normalizeFootprint(null)).toBeNull();
    expect(normalizeFootprint([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
    // 한 줄로 늘어선 점들 — 선이지 면이 아니다
    expect(
      normalizeFootprint([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
      ])
    ).toBeNull();
    expect(normalizeFootprint([{ x: "0", y: 0 }, { x: 1, y: 1 }, { x: 2, y: 3 }])).toBeNull();
  });

  it("점이 아주 많아도 죽지 않고 잘라 낸다", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      x: Math.cos((i / 500) * Math.PI * 2),
      y: Math.sin((i / 500) * Math.PI * 2),
    }));
    const points = normalizeFootprint(many);
    expect(points!.length).toBeLessThanOrEqual(64);
    expect(points!.length).toBeGreaterThan(3);
  });

  it("오목한 모양도 그대로 받는다", () => {
    // ㄷ자 — 가운데가 파여 있다
    const points = normalizeFootprint([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
      { x: 2, y: 3 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 3 },
      { x: 0, y: 3 },
    ]);
    expect(points).toHaveLength(8);
    // 사각형(1.0)보다 좁아야 오목한 것이다
    expect(footprintArea(points!)).toBeLessThan(0.9);
  });
});

describe("이름으로 고르는 모양", () => {
  it("이름마다 다각형이 나온다", () => {
    for (const shape of FOOTPRINT_SHAPES) {
      const points = shapePolygon(shape);
      expect(points.length).toBeGreaterThanOrEqual(3);
      for (const [x, y] of points) {
        expect(x).toBeGreaterThanOrEqual(-0.5001);
        expect(x).toBeLessThanOrEqual(0.5001);
        expect(y).toBeGreaterThanOrEqual(-0.5001);
        expect(y).toBeLessThanOrEqual(0.5001);
      }
    }
  });

  it("ㄱ자는 사각형보다 좁다", () => {
    expect(footprintArea(shapePolygon("l-shape"))).toBeLessThan(0.8);
  });

  it("원은 사각형의 약 79% 를 차지한다", () => {
    // π/4 ≈ 0.785. 점으로 근사하므로 조금 작게 나온다.
    expect(footprintArea(shapePolygon("circle"))).toBeCloseTo(0.78, 1);
  });
});

describe("최종 모양 정하기", () => {
  it("점이 있으면 점을 쓴다", () => {
    const outline = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ];
    expect(resolveFootprint("rect", outline)).toHaveLength(6);
  });

  it("점이 없으면 이름이 가리키는 모양으로 간다", () => {
    expect(resolveFootprint("l-shape")).toHaveLength(6);
    expect(resolveFootprint("circle")!.length).toBeGreaterThan(8);
  });

  it("네모는 굳이 들고 다니지 않는다", () => {
    // 대부분의 가구가 네모라, 전부 다각형으로 저장하면 장면 파일만 커진다
    expect(resolveFootprint("rect")).toBeNull();
    expect(resolveFootprint(undefined)).toBeNull();
    expect(resolveFootprint("이상한값")).toBeNull();
  });

  it("점이 엉망이면 이름으로 물러난다", () => {
    expect(resolveFootprint("circle", [{ x: 0, y: 0 }])).not.toBeNull();
    expect(resolveFootprint("rect", "점이 아님")).toBeNull();
  });
});

describe("SVG 로 그리기", () => {
  it("닫힌 path 가 나온다", () => {
    const d = footprintPath(shapePolygon("l-shape"));
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect((d.match(/L/g) ?? []).length).toBe(5);
  });

  it("점이 모자라면 빈 문자열", () => {
    expect(footprintPath([[0, 0]])).toBe("");
  });
});
