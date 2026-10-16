import { describe, expect, it } from "vitest";
import type { FloorPlanDoc, Point } from "@renderfit/plan-schema";
import {
  addWall,
  deleteFixture,
  deleteWall,
  flagPosition,
  mergeRooms,
  moveFixture,
  moveOpening,
  moveWallEnd,
  readyToConfirm,
  renameRoom,
  rescale,
  rotateFixture,
  setFixtureKind,
  setOpeningWidth,
  setWallThickness,
  splitRoom,
} from "@/scene/planEdit";

/**
 * 검수 화면의 편집 도구.
 *
 * 여기서 지키는 것은 두 가지다 — **고치면 방과 면적이 따라온다**, 그리고 **사람이
 * 고친 것은 다시 검수 대상이 되지 않는다**(confidence 1).
 */

const RECT: Point[] = [
  [0, 0],
  [6000, 0],
  [6000, 4000],
  [0, 4000],
];

function box(): FloorPlanDoc {
  return {
    id: "doc_1",
    sourceType: "raster",
    scale: { mmPerUnit: 10, confidence: 0.9, source: "dimension-ocr" },
    bounds: { w: 6000, h: 4000 },
    walls: [
      { id: "w_bottom", a: [0, 0], b: [6000, 0], thickness: 100, confidence: 0.9 },
      { id: "w_right", a: [6000, 0], b: [6000, 4000], thickness: 100, confidence: 0.9 },
      { id: "w_top", a: [6000, 4000], b: [0, 4000], thickness: 100, confidence: 0.9 },
      { id: "w_left", a: [0, 4000], b: [0, 0], thickness: 100, confidence: 0.9 },
    ],
    openings: [
      { id: "op_1", wallId: "w_bottom", kind: "door", offset: 1000, width: 900, confidence: 0.5 },
    ],
    rooms: [{ id: "room_1", polygon: RECT, name: "거실", nameConfidence: 0.8, areaMm2: 24_000_000 }],
    fixtures: [
      {
        id: "fx_1",
        kind: "refrigerator",
        label: "냉장고",
        bbox: [500, 500, 900, 700],
        rotation: 0,
        source: "ocr-label",
        confidence: 0.4,
      },
    ],
    annotations: [],
    review: { status: "auto", flags: [] },
  };
}

describe("벽", () => {
  it("끝점을 옮기면 면적이 그 자리에서 바뀐다", () => {
    /* 오른쪽 벽을 1m 당긴다 — 6×4 가 5×4 가 된다 */
    let doc = moveWallEnd(box(), "w_right", "a", [5000, 0]).doc;
    doc = moveWallEnd(doc, "w_right", "b", [5000, 4000]).doc;

    expect(doc.rooms[0].areaMm2).toBeCloseTo(20_000_000, 0);
    expect(doc.rooms[0].name).toBe("거실");
  });

  it("같은 자리에 붙어 있던 옆 벽도 함께 데려간다", () => {
    /* 안 데려가면 모서리가 벌어져 방이 통째로 사라진다 */
    const { doc } = moveWallEnd(box(), "w_right", "a", [5000, 500]);
    const bottom = doc.walls.find((wall) => wall.id === "w_bottom")!;

    expect(bottom.b).toEqual([5000, 500]);
  });

  it("벽을 지우면 방도 사라진다", () => {
    const { doc } = deleteWall(box(), "w_right");
    /* 세 면만 남으면 닫히지 않는다 — 예전 방을 그대로 둔다(끌던 중일 수 있다) */
    expect(doc.walls).toHaveLength(3);
    expect(doc.openings).toHaveLength(1);
  });

  it("벽을 지우면 그 벽에 달린 문도 함께 사라진다", () => {
    const { doc } = deleteWall(box(), "w_bottom");
    expect(doc.openings).toHaveLength(0);
  });

  it("사람이 그린 벽은 다시 검수하지 않는다", () => {
    const { doc, edit } = addWall(box(), [3000, 0], [3000, 4000]);
    const added = doc.walls.find((wall) => wall.id === edit.target)!;

    expect(added.confidence).toBe(1);
    /* 가운데 벽을 세웠으니 방이 둘이다 */
    expect(doc.rooms).toHaveLength(2);
  });

  it("두께는 0 아래로 내려가지 않는다", () => {
    const { doc } = setWallThickness(box(), "w_top", -50);
    expect(doc.walls.find((wall) => wall.id === "w_top")!.thickness).toBeGreaterThan(0);
  });
});

describe("방", () => {
  it("이름을 적으면 더 묻지 않는다", () => {
    const { doc } = renameRoom(box(), "room_1", "  주방 ");
    expect(doc.rooms[0].name).toBe("주방");
    expect(doc.rooms[0].nameConfidence).toBe(1);
  });

  it("선 하나로 방을 나눈다", () => {
    const { doc } = splitRoom(box(), "room_1", [3000, -1000], [3000, 5000]);

    expect(doc.rooms).toHaveLength(2);
    for (const room of doc.rooms) expect(room.areaMm2).toBeCloseTo(12_000_000, 0);
  });

  it("방 밖으로 삐져나간 선은 잘라서 세운다", () => {
    /* 안 자르면 도면 밖에 쓸데없는 조각 방이 생긴다 */
    const { doc, edit } = splitRoom(box(), "room_1", [3000, -5000], [3000, 9000]);
    const added = doc.walls.find((wall) => wall.id !== "w_bottom" && wall.a[0] === 3000)!;

    expect(added.a[1]).toBeCloseTo(0, 0);
    expect(added.b[1]).toBeCloseTo(4000, 0);
    expect(edit.kind).toBe("room-split");
  });

  it("방을 합치면 사이의 벽이 없어진다", () => {
    const split = splitRoom(box(), "room_1", [3000, 0], [3000, 4000]).doc;
    expect(split.rooms).toHaveLength(2);

    const merged = mergeRooms(split, split.rooms[0].id, split.rooms[1].id).doc;

    expect(merged.rooms).toHaveLength(1);
    expect(merged.rooms[0].areaMm2).toBeCloseTo(24_000_000, 0);
    /* 폴리곤만 합치면 3D 에 없어야 할 칸막이가 남는다 */
    expect(merged.walls).toHaveLength(4);
  });

  it("맞닿지 않은 방은 합치지 않는다", () => {
    const doc = box();
    const untouched = mergeRooms(doc, "room_1", "room_없음").doc;
    expect(untouched).toBe(doc);
  });
});

describe("문·창", () => {
  it("벽 밖으로는 나가지 않는다", () => {
    const { doc } = moveOpening(box(), "op_1", 99_999);
    const opening = doc.openings[0];

    expect(opening.offset + opening.width).toBeLessThanOrEqual(6000);
  });

  it("폭을 넓혀도 벽을 넘지 않는다", () => {
    const { doc } = setOpeningWidth(box(), "op_1", 99_999);
    const opening = doc.openings[0];

    expect(opening.offset + opening.width).toBeLessThanOrEqual(6000);
    expect(opening.confidence).toBe(1);
  });
});

describe("설비", () => {
  it("옮기면 사람이 놓은 것이 된다", () => {
    const { doc } = moveFixture(box(), "fx_1", [2000, 2000]);
    const fixture = doc.fixtures[0];

    expect(fixture.bbox.slice(0, 2)).toEqual([2000, 2000]);
    expect(fixture.source).toBe("user");
    expect(fixture.confidence).toBe(1);
  });

  it("회전은 0~360 으로 돈다", () => {
    expect(rotateFixture(box(), "fx_1", -90).doc.fixtures[0].rotation).toBe(270);
  });

  it("종류를 바꾸면 라벨도 함께 바뀐다", () => {
    const { doc } = setFixtureKind(box(), "fx_1", "sink", "싱크대");
    expect(doc.fixtures[0].kind).toBe("sink");
    expect(doc.fixtures[0].label).toBe("싱크대");
  });

  it("지운다", () => {
    expect(deleteFixture(box(), "fx_1").doc.fixtures).toHaveLength(0);
  });
});

describe("축척 재지정", () => {
  it("문서 전체가 같은 비율로 늘어난다", () => {
    /* 6000mm 로 읽힌 아래 벽이 실제로는 12000mm 였다 */
    const { doc } = rescale(box(), [0, 0], [6000, 0], 12_000);

    expect(doc.bounds).toEqual({ w: 12_000, h: 8000 });
    expect(doc.walls[0].b).toEqual([12_000, 0]);
    /* 벽만 커지고 문은 그대로면 말이 안 된다 */
    expect(doc.openings[0].width).toBe(1800);
    expect(doc.fixtures[0].bbox[2]).toBe(1800);
    /* 넓이는 길이의 제곱으로 늘어난다 */
    expect(doc.rooms[0].areaMm2).toBeCloseTo(96_000_000, 0);
    expect(doc.scale.source).toBe("user");
    expect(doc.scale.confidence).toBe(1);
  });

  it("겹쳐 놓은 그림도 함께 늘어난다", () => {
    const doc = { ...box(), underlay: { mmPerPixel: 10, originPx: [100, 900] as Point } };
    const scaled = rescale(doc, [0, 0], [6000, 0], 12_000).doc;

    expect(scaled.underlay!.mmPerPixel).toBe(20);
  });

  it("길이가 0 이면 아무 일도 하지 않는다", () => {
    const doc = box();
    expect(rescale(doc, [0, 0], [0, 0], 1000).doc).toBe(doc);
  });
});

describe("검수 상태", () => {
  const flagged = (): FloorPlanDoc => ({
    ...box(),
    review: {
      status: "auto",
      flags: [
        { target: "w_top", reason: "low-confidence-wall" },
        { target: "fx_1", reason: "fixture-placeholder-size" },
      ],
    },
  });

  it("남은 지적이 있으면 확인할 수 없다", () => {
    expect(readyToConfirm(flagged(), {})).toBe(false);
    expect(readyToConfirm(flagged(), { "0": "resolved" })).toBe(false);
  });

  it("전부 해결하거나 무시해야 확인할 수 있다", () => {
    expect(readyToConfirm(flagged(), { "0": "resolved", "1": "ignored" })).toBe(true);
  });

  it("지적이 없으면 바로 확인할 수 있다", () => {
    expect(readyToConfirm(box(), {})).toBe(true);
  });

  it("지적이 가리키는 자리를 찾아 준다", () => {
    const doc = flagged();

    expect(flagPosition(doc, "w_top")).toEqual([3000, 4000]);
    expect(flagPosition(doc, "fx_1")).toEqual([950, 850]);
    expect(flagPosition(doc, "room_1")).toEqual([3000, 2000]);
    expect(flagPosition(doc, "op_1")).toEqual([1450, 0]);
    expect(flagPosition(doc, "scale")).toBeNull();
  });
});
