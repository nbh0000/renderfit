import { describe, expect, it } from "vitest";
import { toFloorPlanDoc, toScene } from "@/scene/planDoc";
import { parseFloorPlanDoc } from "@renderfit/plan-schema";
import { createEmptyScene } from "@/scene/serialization";
import { createSceneObject } from "@/scene/engine/SceneEngine";
import { toPlanData, buildPlanSvg } from "@/services/cadExport";
import type { Scene } from "@/scene/types";

/**
 * Scene ↔ FloorPlanDoc.
 *
 * 문서는 **기하와 의미만** 담는다. 그래서 되돌릴 때는 원본 Scene 을 바탕에 깔고
 * 문서가 담은 것만 얹는다 — 갔다 와도 화면이 같아야 한다는 것이 이 어댑터의
 * 유일한 약속이고, 여기서 그것을 지킨다.
 *
 * AI 를 부르지 않는다.
 */

/** 편집기에서 실제로 다루는 모양의 샘플 도면 — 벽·개구부·실·가구·주석이 다 있다 */
function sample(): Scene {
  const base = createEmptyScene();

  return {
    ...base,
    room: {
      ...base.room,
      dimensions: { width: 8000, length: 6000, height: 2400 },
      measured: true,
      walls: [
        {
          id: "wall_south",
          name: "남측 외벽",
          start: [0, 0],
          end: [8000, 0],
          thickness: 200,
          height: 2400,
          openings: [
            {
              id: "op_front",
              name: "현관문",
              type: "door",
              offset: 1000,
              width: 900,
              height: 2100,
              sillHeight: 0,
              doorType: "hinged",
              hinge: "start",
              swing: "in",
            },
            {
              id: "op_win",
              name: "거실 창",
              type: "window",
              offset: 4000,
              width: 1800,
              height: 1200,
              sillHeight: 900,
            },
          ],
        },
        {
          id: "wall_inner",
          name: "거실·침실 사이",
          start: [4000, 0],
          end: [4000, 6000],
          thickness: 100,
          height: 2400,
          openings: [],
        },
      ],
      areas: [
        {
          id: "area_living",
          name: "거실",
          points: [
            [0, 0],
            [4000, 0],
            [4000, 6000],
            [0, 6000],
          ],
          showArea: true,
          floorMaterialId: "mat_oak",
        },
        {
          id: "area_bed",
          name: "침실1",
          points: [
            [4000, 0],
            [8000, 0],
            [8000, 6000],
            [4000, 6000],
          ],
          showArea: true,
        },
      ],
      annotations: [
        {
          id: "ann_1",
          type: "dimension",
          points: [
            [0, 0],
            [8000, 0],
          ],
          offset: 300,
        },
        { id: "ann_2", type: "text", points: [[2000, 3000]], text: "거실 확장" },
      ],
      finishes: { floor: "mat_oak", wall: null, ceiling: null },
    },
    objects: [
      createSceneObject({
        id: "sofa_1",
        type: "sofa",
        name: "3인용 소파",
        materialId: "mat_beige_fabric",
        dimensions: { width: 2100, height: 800, depth: 900 },
        screen: { x: 0.1, y: 0.5, width: 0.26, height: 0.2, rotation: 90 },
        depth: 0.4,
      }),
      createSceneObject({
        id: "bed_1",
        type: "bed",
        name: "퀸 침대",
        dimensions: { width: 1500, height: 500, depth: 2000 },
        screen: { x: 0.55, y: 0.5, width: 0.19, height: 0.1, rotation: 0 },
        depth: 0.6,
      }),
    ],
  };
}

describe("toFloorPlanDoc", () => {
  const doc = toFloorPlanDoc(sample());

  it("스키마를 통과한다", () => {
    const parsed = parseFloorPlanDoc(doc);
    expect(parsed.ok).toBe(true);
  });

  it("벽과 개구부를 옮긴다 — 개구부는 벽 id 로 매달린다", () => {
    expect(doc.walls.map((wall) => wall.id)).toEqual(["wall_south", "wall_inner"]);
    expect(doc.openings).toHaveLength(2);
    expect(doc.openings.every((opening) => opening.wallId === "wall_south")).toBe(true);
  });

  it("여닫이 방향은 있을 때만 담는다 — 창에는 없는 값이다", () => {
    const door = doc.openings.find((opening) => opening.kind === "door")!;
    const window = doc.openings.find((opening) => opening.kind === "window")!;

    expect(door.swing).toBe("in");
    expect(window.swing).toBeUndefined();
  });

  it("실 면적을 mm² 로 계산해 담는다", () => {
    const living = doc.rooms.find((room) => room.name === "거실")!;
    expect(living.areaMm2).toBe(4000 * 6000);
  });

  it("가구 bbox 는 좌하단 모서리 기준이다 — y 가 위로 커지는 좌표계다", () => {
    const sofa = doc.fixtures.find((fixture) => fixture.id === "sofa_1")!;
    const [x, y, w, h] = sofa.bbox;

    /* screen.x 0.1 + width 0.26/2 → 중심 x = 0.23 × 8000 = 1840 */
    expect(x + w / 2).toBeCloseTo(1840, 3);
    /* depth 0.4 → 중심 y = 2400 */
    expect(y + h / 2).toBeCloseTo(2400, 3);
    expect(w).toBe(2100);
    expect(h).toBe(900);
    expect(sofa.rotation).toBe(90);
  });

  it("벽·바닥·천장은 설비가 아니다", () => {
    expect(doc.fixtures.map((fixture) => fixture.kind).sort()).toEqual(["bed", "sofa"]);
  });

  it("주석 종류를 옮긴다", () => {
    expect(doc.annotations.map((item) => item.kind)).toEqual(["dimension", "label"]);
    expect(doc.annotations[1].text).toBe("거실 확장");
  });

  it("좌표를 뒤집지 않는다 — Scene 과 문서는 같은 약속을 쓴다", () => {
    expect(doc.walls[0].a).toEqual([0, 0]);
    expect(doc.walls[0].b).toEqual([8000, 0]);
    expect(doc.bounds).toEqual({ w: 8000, h: 6000 });
  });
});

describe("갔다 와도 화면이 같다", () => {
  const before = sample();
  const after = toScene(toFloorPlanDoc(before), before);

  it("벽이 그대로다 — 문서가 모르는 높이·이름까지", () => {
    expect(after.room.walls).toEqual(before.room.walls);
  });

  it("개구부가 그대로다 — 문서가 모르는 창대높이·경첩까지", () => {
    const openings = (scene: Scene) => (scene.room.walls ?? []).flatMap((wall) => wall.openings);
    expect(openings(after)).toEqual(openings(before));
  });

  it("실이 그대로다 — 문서가 모르는 바닥 마감까지", () => {
    expect(after.room.areas).toEqual(before.room.areas);
  });

  it("가구가 그대로다 — 문서가 모르는 재질·3D 변환까지", () => {
    expect(after.objects).toEqual(before.objects);
  });

  it("방 치수·주석·재질·조명·카메라가 그대로다", () => {
    expect(after.room.dimensions).toEqual(before.room.dimensions);
    expect(after.room.annotations).toEqual(before.room.annotations);
    expect(after.materials).toEqual(before.materials);
    expect(after.lights).toEqual(before.lights);
    expect(after.camera).toEqual(before.camera);
  });

  it("그려 낸 도면이 한 글자도 다르지 않다", () => {
    /*
     * 이것이 진짜 기준이다. 자료가 같아 보여도 그리는 쪽에서 다르게 읽으면 소용없다.
     * 같은 SVG 가 나오면 화면이 같다.
     */
    expect(buildPlanSvg(toPlanData(after, "왕복"))).toBe(
      buildPlanSvg(toPlanData(before, "왕복"))
    );
  });
});

describe("문서에만 있는 것", () => {
  it("바탕에 없는 설비를 세운다 — 안 세우면 DXF 블록이 통째로 사라진다", () => {
    /*
     * 도면에 그려져 있던 책상·위생기구가 편집기에서 사라지면, 사용자는 파서가 못 읽은
     * 것인지 우리가 버린 것인지 알 수 없다.
     */
    const base = sample();
    const doc = toFloorPlanDoc(base);

    doc.fixtures.push({
      id: "fx_desk",
      kind: "desk-1400",
      label: "DESK-1400",
      bbox: [1000, 2000, 1400, 700],
      rotation: 90,
      source: "dxf-block",
      confidence: 0.9,
    });

    const objects = toScene(doc, base).objects;
    expect(objects.map((object) => object.id)).toEqual(["sofa_1", "bed_1", "fx_desk"]);

    const desk = objects.find((object) => object.id === "fx_desk")!;
    expect(desk.type).toBe("table");
    expect(desk.name).toBe("DESK-1400");
    expect(desk.dimensions.width).toBe(1400);
    expect(desk.dimensions.depth).toBe(700);
    expect(desk.screen.rotation).toBe(90);
  });

  it("못 알아보는 블록은 custom 으로 두고 이름을 살린다", () => {
    /* 억지로 가장 비슷한 것에 밀어 넣으면 도면에 없는 소파가 생긴다 */
    const base = sample();
    const doc = toFloorPlanDoc(base);

    doc.fixtures.push({
      id: "fx_unknown",
      kind: "a-c0a1b2",
      bbox: [0, 0, 400, 400],
      rotation: 0,
      source: "dxf-block",
      confidence: 0.5,
    });

    const added = toScene(doc, base).objects.find((object) => object.id === "fx_unknown")!;
    expect(added.type).toBe("custom");
    expect(added.name).toBe("a-c0a1b2");
  });

  it("새로 세운 설비의 자리가 문서 그대로다", () => {
    const base = sample();
    const doc = toFloorPlanDoc(base);

    doc.fixtures.push({
      id: "fx_wc",
      kind: "wc-basin",
      bbox: [2000, 1000, 550, 450],
      rotation: 0,
      source: "dxf-block",
      confidence: 0.9,
    });

    /* 넣었다가 다시 꺼내면 같은 자리여야 한다 */
    const back = toFloorPlanDoc(toScene(doc, base));
    const again = back.fixtures.find((fixture) => fixture.id === "fx_wc")!;

    expect(again.bbox[0] + again.bbox[2] / 2).toBeCloseTo(2000 + 550 / 2, 3);
    expect(again.bbox[1] + again.bbox[3] / 2).toBeCloseTo(1000 + 450 / 2, 3);
  });

  it("바탕에 없는 벽은 기본값으로 세운다 — 벽이 없으면 도면이 성립하지 않는다", () => {
    const base = sample();
    const doc = toFloorPlanDoc(base);

    doc.walls.push({
      id: "wall_new",
      a: [0, 6000],
      b: [8000, 6000],
      thickness: 200,
      confidence: 0.8,
    });

    const walls = toScene(doc, base).room.walls!;
    const added = walls.find((wall) => wall.id === "wall_new")!;

    expect(added.height).toBe(2400);
    expect(added.openings).toEqual([]);
  });
});

/** 설비 하나짜리 문서 — 다시 들여올 때 id 만 바꿔 넣는다 */
function docWithFixture(id: string, kind: string) {
  return {
    id: "doc_reimport",
    sourceType: "cad" as const,
    scale: { mmPerUnit: 1, confidence: 1, source: "dxf-units" as const },
    bounds: { w: 6000, h: 4000 },
    walls: [],
    openings: [],
    rooms: [],
    fixtures: [
      {
        id,
        kind,
        bbox: [1000, 1000, 1600, 2000] as [number, number, number, number],
        rotation: 0,
        source: "dxf-block" as const,
        confidence: 0.9,
      },
    ],
    annotations: [],
    review: { status: "confirmed" as const, flags: [] },
  };
}

describe("도면을 다시 들여올 때", () => {
  it("지난번 설비는 걷어내고 사람이 놓은 가구는 남긴다", () => {
    /*
     * 도면을 다시 들여오면 설비 id 가 새로 붙는다. 그대로 두면 같은 침대가 두 개씩
     * 쌓인다 — 실제로 같은 도면을 세 번 넣었더니 그렇게 됐다.
     */
    const base = toScene(docWithFixture("fx_old", "bed"), createEmptyScene());
    const mine = {
      ...base.objects[0],
      id: "obj_mine",
      name: "내가 놓은 소파",
      metadata: {},
    };

    const before = { ...base, objects: [...base.objects, mine] };
    const after = toScene(docWithFixture("fx_new", "bed"), before);

    const ids = after.objects.map((object) => object.id).sort();
    expect(ids).toEqual(["fx_new", "obj_mine"]);
  });
});
