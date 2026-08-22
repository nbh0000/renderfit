import { describe, expect, it } from "vitest";
import { analysisToScene } from "@/services/projectService";
import { createEmptyScene } from "@/scene/serialization";
import { toPlanData } from "@/services/cadExport";
import { openingObjectIds } from "@/scene/openings";
import { mountHeight, planCenter } from "@/scene/placement";
import { normalizeRoomType } from "@/ai/providers/vision";
import type { RoomAnalysis } from "@/ai/providers/types";
import type { SceneObject } from "@/scene/types";

/**
 * 올린 사진이 평면도·3D로 넘어갈 때 지켜야 하는 것들.
 *
 * 예전에는 분석 결과를 그대로 Scene에 얹기만 해서
 *  - 벽에 붙은 붙박이장이 방 한가운데 가로로 놓이고 벽 밖으로 삐져나갔으며
 *  - 천장등이 바닥에 상자로 놓였고
 *  - 개구부가 된 창문이 3D에서 한 번 더 그려졌다.
 */

/** hero-before.jpg(빈 침실)에서 gemini-3.5-flash가 실제로 읽어 온 값 */
const ANALYSIS: RoomAnalysis = {
  roomType: "bedroom",
  roomDimensions: { width: 3800, length: 4200, height: 2400 },
  objects: [
    {
      type: "window",
      name: "이중창문",
      bbox: [0.31, 0.23, 0.17, 0.26],
      maskUrl: null,
      depth: 0.8,
      material: null,
      color: "#ffffff",
      confidence: 0.9,
      dimensions: { width: 1200, height: 1200, depth: 150 },
    },
    {
      // 오른쪽 벽면을 가득 채운 붙박이장 — 사진 오른쪽 끝에 걸쳐 찍힌다
      type: "cabinet",
      name: "붙박이장",
      bbox: [0.66, 0, 0.34, 0.83],
      maskUrl: null,
      depth: 0.5,
      material: null,
      color: "#ffffff",
      confidence: 0.95,
      dimensions: { width: 2000, height: 2200, depth: 600 },
    },
    {
      // 사진 맨 위에 찍힌 평판형 천장등
      type: "lamp",
      name: "평판형 천장등",
      bbox: [0.43, 0, 0.14, 0.14],
      maskUrl: null,
      depth: 0.5,
      material: null,
      color: "#ffffff",
      confidence: 0.9,
      dimensions: { width: 600, height: 100, depth: 600 },
    },
  ],
  styleGuess: null,
  lightDirection: [0, 0.9, 1],
};

const scene = analysisToScene(createEmptyScene(), ANALYSIS);
const room = scene.room;
const find = (name: string): SceneObject => scene.objects.find((o) => o.name === name)!;

/** 회전을 반영한 평면 점유 영역 */
function footprint(object: SceneObject) {
  const quarter = Math.round((((object.screen.rotation % 360) + 360) % 360) / 90) % 2;
  const { cx, cy } = planCenter(object.screen, object.depth, room);
  return {
    cx,
    cy,
    width: quarter === 0 ? object.dimensions.width : object.dimensions.depth,
    depth: quarter === 0 ? object.dimensions.depth : object.dimensions.width,
  };
}

describe("사진 분석 → 배치", () => {
  it("방 치수와 실명이 분석 결과를 따른다", () => {
    expect(room.dimensions).toEqual(ANALYSIS.roomDimensions);
    expect(room.areas?.[0]?.name).toBe("침실");
  });

  it("모든 가구가 방 안에 들어온다", () => {
    for (const object of scene.objects) {
      const box = footprint(object);
      expect(box.cx - box.width / 2).toBeGreaterThanOrEqual(-1);
      expect(box.cx + box.width / 2).toBeLessThanOrEqual(room.dimensions.width + 1);
      expect(box.cy - box.depth / 2).toBeGreaterThanOrEqual(-1);
      expect(box.cy + box.depth / 2).toBeLessThanOrEqual(room.dimensions.length + 1);
    }
  });

  it("벽에 붙은 붙박이장은 벽을 따라 돌려 세운다", () => {
    const cabinet = find("붙박이장");
    expect(Math.abs(cabinet.screen.rotation) % 180).toBe(90);

    // 오른쪽 벽에 딱 붙는다 (걸레받이 틈만 남긴다)
    const box = footprint(cabinet);
    expect(room.dimensions.width - (box.cx + box.width / 2)).toBeLessThanOrEqual(30);
  });

  it("천장등은 천장 높이에 매달린다", () => {
    const lamp = find("평판형 천장등");
    const y = mountHeight(lamp, room);
    expect(y).toBeCloseTo(room.dimensions.height - lamp.dimensions.height / 2, 5);
    // Scene에 저장되는 월드 좌표(m)도 같은 높이를 가리킨다
    expect(lamp.transform.position[1]).toBeCloseTo(y / 1000, 5);
  });

  it("바닥 가구의 월드 좌표는 방 중심 기준이고 안쪽이 -z다", () => {
    const cabinet = find("붙박이장");
    const box = footprint(cabinet);
    expect(cabinet.transform.position[0]).toBeCloseTo((box.cx - room.dimensions.width / 2) / 1000, 5);
    expect(cabinet.transform.position[2]).toBeCloseTo((room.dimensions.length / 2 - box.cy) / 1000, 5);
  });
});

describe("사진 분석 → 창·문", () => {
  it("창문은 벽 개구부가 된다", () => {
    const openings = (room.walls ?? []).flatMap((wall) => wall.openings ?? []);
    expect(openings).toHaveLength(1);
    expect(openings[0].type).toBe("window");
  });

  it("개구부가 된 창문은 평면도와 3D 어디에도 두 번 그리지 않는다", () => {
    const converted = openingObjectIds(room);
    expect(converted.has(find("이중창문").id)).toBe(true);

    // 평면도와 3D가 같은 기준으로 걸러 낸다
    const plan = toPlanData(scene, "테스트");
    expect(plan.objects.map((o) => o.name)).not.toContain("이중창문");
    expect(scene.objects.filter((o) => !converted.has(o.id)).map((o) => o.name)).not.toContain(
      "이중창문"
    );
  });
});

describe("방 종류 정규화", () => {
  it("모델이 목록 밖의 이름을 줘도 우리 id로 되돌린다", () => {
    expect(normalizeRoomType("livingroom")).toBe("living-room");
    expect(normalizeRoomType("living_room")).toBe("living-room");
    expect(normalizeRoomType("bedroom")).toBe("bedroom");
    expect(normalizeRoomType(undefined)).toBe("living-room");
  });

  it("도면에는 영문 id가 아니라 한글 실명을 적는다", () => {
    expect(toPlanData(scene, "테스트").roomType).toBe("침실");
  });
});

describe("속성 패널이 쓰는 값", () => {
  /*
   * 패널은 평면 좌표(mm)를 보여 주고 그 값으로 move_object를 부른다.
   * planCenter가 되돌려 주는 값과 패널이 넣는 값이 서로 역함수여야 자리가 어긋나지 않는다.
   */
  it("mm 좌표를 넣으면 그 자리에 그대로 놓인다", () => {
    const cabinet = find("붙박이장");
    for (const targetCx of [500, 1900, 3600]) {
      const nextScreenX = targetCx / room.dimensions.width - cabinet.screen.width / 2;
      const moved = { ...cabinet, screen: { ...cabinet.screen, x: nextScreenX } };
      expect(planCenter(moved.screen, moved.depth, room).cx).toBeCloseTo(targetCx, 6);
    }
  });

  it("원하는 각도까지의 차이만큼 돌리면 그 각도가 된다", () => {
    // rotate_object는 상대 회전이라 패널이 (목표 − 현재)를 넘긴다.
    let rotation = 0;
    for (const want of [15, 45, 270, 0]) {
      rotation += want - rotation;
      expect(rotation).toBe(want);
    }
  });
});
