import { expect, it } from "vitest";
import { deriveOpenings } from "@/scene/openings";
import { rectangleWalls, wallLength } from "@/scene/geometry";
import { buildPlanSvg, toPlanData } from "@/services/cadExport";
import { buildElevationSvg } from "@/services/elevationExport";
import type { RoomSpec, Scene, SceneObject } from "@/scene/types";

/**
 * 사진 분석이 실제로 도면까지 이어지는지 지키는 회귀 테스트.
 *
 * 예전에는 존재하지 않는 모델 이름을 쓰는 바람에 분석이 늘 실패하고 조용히
 * 기본 배치로 떨어졌다. 그래서 사진을 바꿔도 평면도가 그대로였다.
 */

/** 실제 분석 결과(gemini-3.5-flash가 hero-after.jpg에서 읽은 값)를 그대로 넣어 도면을 만든다 */
const ANALYSIS = {
  roomType: "bedroom",
  dimensions: { width: 4200, length: 5000, height: 2500 },
  objects: [
    { type: "window", name: "창문", x: 0.24, y: 0.22, width: 0.18, height: 0.32, depth: 0.9, w: 1400, h: 1300, d: 200 },
    { type: "bed", name: "침대", x: 0.42, y: 0.5, width: 0.42, height: 0.3, depth: 0.6, w: 1700, h: 600, d: 2100 },
    { type: "rug", name: "러그", x: 0.15, y: 0.68, width: 0.62, height: 0.28, depth: 0.4, w: 2300, h: 20, d: 1700 },
    { type: "cabinet", name: "협탁", x: 0.78, y: 0.55, width: 0.14, height: 0.14, depth: 0.65, w: 650, h: 550, d: 450 },
    { type: "lamp", name: "침대 조명 우측", x: 0.8, y: 0.44, width: 0.07, height: 0.09, depth: 0.65, w: 300, h: 450, d: 300 },
  ],
};

function object(item: (typeof ANALYSIS.objects)[number], index: number): SceneObject {
  return {
    id: `o${index}`,
    name: item.name,
    type: item.type as SceneObject["type"],
    category: "furniture",
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    dimensions: { width: item.w, height: item.h, depth: item.d },
    screen: { x: item.x, y: item.y, width: item.width, height: item.height, rotation: 0 },
    assetId: null,
    materialId: null,
    visibility: true,
    locked: false,
    mask: null,
    depth: item.depth,
    confidence: 0.9,
    source: "vision_model",
    order: index,
    metadata: {},
  } as SceneObject;
}

it("사진 분석 → 벽 → 개구부 → 평면도·입면도", () => {
  const objects = ANALYSIS.objects.map(object);

  const room: RoomSpec = {
    type: ANALYSIS.roomType,
    dimensions: ANALYSIS.dimensions,
    walls: rectangleWalls(ANALYSIS.dimensions),
  };

  // 1) 분석된 창문이 벽 개구부로 옮겨진다
  const derived = deriveOpenings(room, objects);
  expect(derived.added).toBe(1);

  const wallWithWindow = derived.walls.find((wall) => (wall.openings ?? []).length > 0)!;
  const opening = wallWithWindow.openings[0];
  expect(opening.type).toBe("window");
  expect(opening.width).toBe(1400);
  expect(opening.offset + opening.width).toBeLessThanOrEqual(wallLength(wallWithWindow));

  // 2) 평면도에 방 크기와 가구가 반영된다
  const scene = {
    room: { ...room, walls: derived.walls },
    objects,
    materials: [],
  } as unknown as Scene;

  const plan = toPlanData(scene, "분석 테스트");
  expect(plan.roomWidth).toBe(4200);
  expect(plan.roomLength).toBe(5000);
  expect(plan.objects.map((o) => o.name)).toContain("침대");
  // 개구부로 옮겨진 창문은 가구로 중복해 그리지 않는다
  expect(plan.objects.map((o) => o.name)).not.toContain("창문");

  const planSvg = buildPlanSvg(plan);
  expect(planSvg).toContain("침대");
  expect(planSvg).toContain("창문");
  expect(planSvg).not.toContain("NaN");

  // 3) 창문이 있는 벽의 입면도에 크기와 하부고가 찍힌다
  const elevation = buildElevationSvg({ plan, wall: wallWithWindow });
  expect(elevation).toContain("입면도");
  expect(elevation).toContain("창문 1400×1300");
  expect(elevation).toContain("SILL");
  expect(elevation).not.toContain("NaN");
});
