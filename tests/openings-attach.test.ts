import { describe, expect, it } from "vitest";
import { attachOpenings, tidyOpenings } from "@/ai/providers/vision";
import type { PlanWall } from "@/ai/providers/types";

/**
 * 따로 읽은 문·창을 벽에 붙이기.
 *
 * 평면 전체를 한 번에 물으면 모델이 문을 통째로 흘린다. 실제로 방 일곱 개짜리
 * 아파트에서 창 넷만 오고 문은 하나도 오지 않았다 — 현관문도 방문도 없었다.
 * 그래서 문·창만 따로 한 번 더 읽는데, 그 결과는 좌표 하나로 온다.
 *
 * 좌표를 "몇 번 벽의 몇 mm 지점"으로 바꾸는 것은 순수한 기하 계산이다. 지어내는 게
 * 아니라 그려진 자리를 그대로 쓰는 것이라, 도면을 고치지 않는다는 원칙에 어긋나지 않는다.
 */

/** 가로 4000, 세로 3000 짜리 방의 네 벽 */
function boxWalls(): PlanWall[] {
  return [
    { name: "남", start: { x: 0, y: 0 }, end: { x: 4000, y: 0 }, thicknessMm: 200, openings: [] },
    { name: "동", start: { x: 4000, y: 0 }, end: { x: 4000, y: 3000 }, thicknessMm: 200, openings: [] },
    { name: "북", start: { x: 4000, y: 3000 }, end: { x: 0, y: 3000 }, thicknessMm: 200, openings: [] },
    { name: "서", start: { x: 0, y: 3000 }, end: { x: 0, y: 0 }, thicknessMm: 200, openings: [] },
  ];
}

describe("문·창 붙이기", () => {
  it("가장 가까운 벽에 붙는다", () => {
    const walls = attachOpenings(boxWalls(), [
      { kind: "door", name: "현관문", centerXMm: 1000, centerYMm: 0, widthMm: 900, heightMm: 2100, sillMm: 0 },
    ]);

    expect(walls[0].openings).toHaveLength(1);
    expect(walls[1].openings).toHaveLength(0);
    // 벽 시작점에서 문 왼쪽 끝까지 = 1000 - 900/2
    expect(walls[0].openings[0].offsetMm).toBe(550);
    expect(walls[0].openings[0].kind).toBe("door");
  });

  it("벽에서 멀리 떨어진 좌표는 버린다", () => {
    // 방 한가운데를 가리켰다 — 벽에 그려진 개구부가 아니다
    const walls = attachOpenings(boxWalls(), [
      { kind: "door", name: "?", centerXMm: 2000, centerYMm: 1500, widthMm: 900, heightMm: 2100, sillMm: 0 },
    ]);
    expect(walls.flatMap((wall) => wall.openings)).toHaveLength(0);
  });

  it("벽 밖으로 삐져나가지 않게 밀어 넣는다", () => {
    const walls = attachOpenings(boxWalls(), [
      { kind: "door", name: "구석 문", centerXMm: 3950, centerYMm: 0, widthMm: 900, heightMm: 2100, sillMm: 0 },
    ]);

    const opening = walls[0].openings[0];
    expect(opening.offsetMm + opening.widthMm).toBeLessThanOrEqual(4000);
  });

  it("본문이 이미 준 개구부와 겹치면 두 번 넣지 않는다", () => {
    const walls = boxWalls();
    walls[0].openings.push({ kind: "door", name: "현관문", offsetMm: 550, widthMm: 900, heightMm: 2100, sillMm: 0 });

    const merged = attachOpenings(walls, [
      { kind: "door", name: "현관문", centerXMm: 1000, centerYMm: 0, widthMm: 900, heightMm: 2100, sillMm: 0 },
    ]);

    expect(merged[0].openings).toHaveLength(1);
  });

  it("떨어진 자리의 개구부는 같은 벽에도 더 붙는다", () => {
    const walls = boxWalls();
    walls[0].openings.push({ kind: "door", name: "현관문", offsetMm: 0, widthMm: 900, heightMm: 2100, sillMm: 0 });

    const merged = attachOpenings(walls, [
      { kind: "window", name: "거실창", centerXMm: 3000, centerYMm: 0, widthMm: 1800, heightMm: 1400, sillMm: 850 },
    ]);

    expect(merged[0].openings).toHaveLength(2);
    expect(merged[0].openings[1].kind).toBe("window");
    expect(merged[0].openings[1].sillMm).toBe(850);
  });

  it("개구부보다 짧은 벽에는 붙이지 않는다", () => {
    const stub: PlanWall[] = [
      { name: "토막", start: { x: 0, y: 0 }, end: { x: 600, y: 0 }, thicknessMm: 200, openings: [] },
    ];
    const walls = attachOpenings(stub, [
      { kind: "door", name: "문", centerXMm: 300, centerYMm: 0, widthMm: 900, heightMm: 2100, sillMm: 0 },
    ]);
    expect(walls[0].openings).toHaveLength(0);
  });

  it("말이 안 되는 값은 무시한다", () => {
    const walls = attachOpenings(boxWalls(), [
      { kind: "door", name: "x", centerXMm: NaN, centerYMm: 0, widthMm: 900, heightMm: 2100, sillMm: 0 },
      { kind: "door", name: "y", centerXMm: 1000, centerYMm: 0, widthMm: 50, heightMm: 2100, sillMm: 0 },
      { kind: "door", name: "z", centerXMm: 1000, centerYMm: 0, widthMm: 90000, heightMm: 2100, sillMm: 0 },
    ]);
    expect(walls.flatMap((wall) => wall.openings)).toHaveLength(0);
  });

  it("읽은 것이 없어도 벽의 내용은 그대로다", () => {
    // 새로 붙일 것이 없어도 정리는 한 번 거친다 — 본문이 준 개구부에도 벽 밖으로
    // 나간 것이나 겹친 것이 있을 수 있다.
    const walls = boxWalls();
    expect(attachOpenings(walls, [])).toEqual(walls);
  });
});

describe("벽마다 개구부 정리", () => {
  it("벽 밖으로 나간 것을 안으로 넣는다", () => {
    const walls = boxWalls();
    // 4000mm 벽에 4500 지점의 창 — 실 경계에서 벽을 다시 짜면 이런 일이 생긴다
    walls[0].openings.push({ kind: "window", name: "창", offsetMm: 4500, widthMm: 600, heightMm: 1200, sillMm: 900 });

    const tidy = tidyOpenings(walls)[0].openings[0];
    expect(tidy.offsetMm + tidy.widthMm).toBeLessThanOrEqual(4000);
  });

  it("겹쳐 달린 문은 넓은 쪽만 남긴다", () => {
    const walls = boxWalls();
    walls[0].openings.push(
      { kind: "door", name: "좁은 문", offsetMm: 1150, widthMm: 800, heightMm: 2100, sillMm: 0 },
      { kind: "door", name: "넓은 문", offsetMm: 1800, widthMm: 900, heightMm: 2100, sillMm: 0 }
    );

    const kept = tidyOpenings(walls)[0].openings;
    expect(kept).toHaveLength(1);
    expect(kept[0].name).toBe("넓은 문");
  });

  it("떨어져 있으면 둘 다 남긴다", () => {
    const walls = boxWalls();
    walls[0].openings.push(
      { kind: "door", name: "문", offsetMm: 0, widthMm: 900, heightMm: 2100, sillMm: 0 },
      { kind: "window", name: "창", offsetMm: 2000, widthMm: 1200, heightMm: 1400, sillMm: 850 }
    );
    expect(tidyOpenings(walls)[0].openings).toHaveLength(2);
  });

  it("벽보다 넓은 개구부는 벽 길이에 맞춘다", () => {
    const stub: PlanWall[] = [
      { name: "짧은 벽", start: { x: 0, y: 0 }, end: { x: 1000, y: 0 }, thicknessMm: 200, openings: [
        { kind: "door", name: "문", offsetMm: 0, widthMm: 2000, heightMm: 2100, sillMm: 0 },
      ] },
    ];
    expect(tidyOpenings(stub)[0].openings[0].widthMm).toBe(1000);
  });

  it("자리 순서대로 정렬해서 돌려준다", () => {
    const walls = boxWalls();
    walls[0].openings.push(
      { kind: "window", name: "뒤", offsetMm: 2500, widthMm: 800, heightMm: 1400, sillMm: 850 },
      { kind: "door", name: "앞", offsetMm: 200, widthMm: 900, heightMm: 2100, sillMm: 0 }
    );
    const kept = tidyOpenings(walls)[0].openings;
    expect(kept.map((opening) => opening.name)).toEqual(["앞", "뒤"]);
  });
});
