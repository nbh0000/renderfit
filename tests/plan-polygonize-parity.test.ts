import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { polygonArea, polygonizeWalls } from "@/scene/planPolygonize";
import type { Point } from "@renderfit/plan-schema";

/**
 * 브라우저의 polygonize 가 파이썬(shapely) 과 같은 답을 내는가.
 *
 * 검수 화면은 벽을 끌 때마다 브라우저에서 방을 다시 만든다. 그 계산이 파서와 다르면
 * **아무것도 안 고쳤는데 면적이 바뀌는** 일이 생긴다 — 사용자는 자기가 무엇을 망쳤는지
 * 알 수 없고, 우리도 어느 쪽이 맞는지 알 수 없다.
 *
 * 자료는 파이썬 파서의 **골든 파일**을 그대로 읽는다. 따로 떠 두면 두 벌이 되고,
 * 파서를 고쳤을 때 한쪽만 갱신돼 "둘이 같다"는 시험이 거짓말을 하게 된다.
 * 유료 호출은 하나도 쓰지 않는다.
 */

type Fixture = {
  walls: { a: Point; b: Point }[];
  rooms: { name: string | null; areaMm2: number }[];
};

function load(name: string): Fixture {
  const path = `services/plan-ingest/tests/golden/${name}.json`;
  return JSON.parse(readFileSync(path, "utf-8")) as Fixture;
}

describe.each([
  ["residential", 3],
  ["commercial", 4],
])("%s", (name, expected) => {
  const fixture = load(name);

  it("방 개수가 파이썬과 같다", () => {
    expect(polygonizeWalls(fixture.walls)).toHaveLength(expected);
  });

  it("방 면적이 파이썬과 같다", () => {
    const ours = polygonizeWalls(fixture.walls)
      .map((room) => Math.abs(polygonArea(room)))
      .sort((one, two) => one - two);

    const theirs = fixture.rooms.map((room) => room.areaMm2).sort((one, two) => one - two);

    expect(ours).toHaveLength(theirs.length);
    ours.forEach((area, index) => {
      /* 0.1% 안에 들어야 한다 — 둘 다 폴리곤 면적이므로 사실상 같아야 정상이다 */
      expect(area).toBeCloseTo(theirs[index], -Math.log10(theirs[index] * 0.001));
    });
  });
});
