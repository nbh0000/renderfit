import { describe, expect, it } from "vitest";
import { ASSETS, ASSET_MAP } from "@/models/assets";
import { DEFAULT_MATERIALS, MATERIAL_MAP, materialsForSurface } from "@/models/materials";

/**
 * 무료(CC0) 메시·텍스처가 카탈로그에 제대로 실렸는지 지킨다.
 * 생성 파일(polyhaven.generated / materials.generated)이 비면 3D가 조용히 상자로 돌아간다.
 */

describe("가구 카탈로그", () => {
  const withModel = ASSETS.filter((asset) => asset.modelUrl);

  it("실제 메시가 붙은 가구가 있다", () => {
    expect(withModel.length).toBeGreaterThanOrEqual(30);
  });

  it("메시 경로가 public/models 아래를 가리킨다", () => {
    for (const asset of withModel) {
      expect(asset.modelUrl).toMatch(/^\/models\/[^/]+\/[^/]+\.gltf$/);
    }
  });

  it("메시가 붙은 가구는 그 메시의 실제 치수를 쓴다", () => {
    // 3D가 보여 주는 크기와 평면도의 발자국이 어긋나면 안 된다
    for (const asset of withModel) {
      expect(asset.dimensions.width).toBeGreaterThan(20);
      expect(asset.dimensions.height).toBeGreaterThan(20);
      expect(asset.dimensions.depth).toBeGreaterThan(20);
      expect(asset.dimensions.width).toBeLessThan(6000);
      expect(asset.dimensions.height).toBeLessThan(3000);
    }
  });

  it("id가 겹치지 않는다", () => {
    expect(Object.keys(ASSET_MAP)).toHaveLength(ASSETS.length);
  });
});

describe("마감재 카탈로그", () => {
  const textured = DEFAULT_MATERIALS.filter((material) => material.textureUrl);

  it("사진 텍스처가 붙은 마감재가 있다", () => {
    expect(textured.length).toBeGreaterThanOrEqual(20);
  });

  it("텍스처 경로가 public/textures 아래를 가리킨다", () => {
    for (const material of textured) {
      expect(material.textureUrl).toMatch(/^\/textures\/[^/]+\/diff\.jpg$/);
    }
  });

  it("바닥·벽·천장마다 고를 것이 있다", () => {
    for (const surface of ["floor", "wall", "ceiling"] as const) {
      expect(materialsForSurface(surface).length).toBeGreaterThan(0);
    }
  });

  it("id가 겹치지 않는다", () => {
    expect(Object.keys(MATERIAL_MAP)).toHaveLength(DEFAULT_MATERIALS.length);
  });
});

describe("씬에 넣을 때 메시가 따라간다", () => {
  it("카탈로그 가구를 추가하면 modelUrl이 객체에 실린다", async () => {
    const { SceneEngine } = await import("@/scene/engine/SceneEngine");
    const { createEmptyScene } = await import("@/scene/serialization");
    const { executeCommand } = await import("@/ai/tools");

    const engine = new SceneEngine(createEmptyScene());
    const result = executeCommand(engine, {
      tool: "add_object",
      arguments: { assetId: "asset_sofa_beige_3" },
      explanation: "",
      confidence: 1,
    });

    expect(result.ok).toBe(true);

    /*
     * 예전에는 createSceneObject가 modelUrl을 흘려서, 카탈로그의 3D 모델이
     * 조용히 사라지고 상자로만 그려졌다.
     */
    const object = engine.getScene().objects.at(-1)!;
    expect(object.modelUrl).toBe(ASSET_MAP.asset_sofa_beige_3.modelUrl);
    expect(object.dimensions).toEqual(ASSET_MAP.asset_sofa_beige_3.dimensions);
  });

  it("AI로 만든 가구 이미지도 객체에 실린다", async () => {
    const { SceneEngine, createSceneObject } = await import("@/scene/engine/SceneEngine");
    const { createEmptyScene } = await import("@/scene/serialization");

    const engine = new SceneEngine(createEmptyScene());
    engine.addObject(
      createSceneObject({ type: "chair", name: "생성 의자", imageUrl: "/api/files/x.png" })
    );

    expect(engine.getScene().objects.at(-1)!.imageUrl).toBe("/api/files/x.png");
  });
});

describe("메시가 없는 가구는 생성 이미지로 채운다", () => {
  /*
   * Poly Haven에는 붙박이장·주방 상하부장·4도어 냉장고처럼 한국 주거의 핵심 품목이 없다.
   * 그 자리를 AI 제품 사진이 메운다 — 비어 있으면 3D가 흰 상자로 돌아간다.
   */
  it("모든 가구가 메시나 사진 중 하나는 갖는다", () => {
    const bare = ASSETS.filter((asset) => !asset.modelUrl && !asset.imageUrl);
    expect(bare.map((asset) => asset.name)).toEqual([]);
  });

  it("사진 경로가 public/assets 아래를 가리킨다", () => {
    for (const asset of ASSETS.filter((item) => item.imageUrl)) {
      expect(asset.imageUrl).toMatch(/^\/assets\/asset_[a-z0-9_]+\.png$/);
    }
  });

  it("사진으로 채운 가구도 국내 규격 치수를 지킨다", () => {
    // 사진은 크기를 알려 주지 않는다 — 치수는 카탈로그에 적어 둔 값을 그대로 써야 한다.
    const wardrobe = ASSET_MAP.asset_wardrobe_slide;
    expect(wardrobe.imageUrl).toBeTruthy();
    expect(wardrobe.dimensions).toEqual({ width: 2400, height: 2400, depth: 600 });
  });

  it("씬에 넣으면 사진이 객체에 실린다", async () => {
    const { SceneEngine } = await import("@/scene/engine/SceneEngine");
    const { createEmptyScene } = await import("@/scene/serialization");
    const { executeCommand } = await import("@/ai/tools");

    const engine = new SceneEngine(createEmptyScene());
    executeCommand(engine, {
      tool: "add_object",
      arguments: { assetId: "asset_fridge_4door" },
      explanation: "",
      confidence: 1,
    });

    expect(engine.getScene().objects.at(-1)!.imageUrl).toBe(ASSET_MAP.asset_fridge_4door.imageUrl);
  });
});

describe("가구를 여러 개 넣어도 겹치지 않는다", () => {
  /*
   * 예전에는 새 가구가 늘 같은 자리에서 시작해 한 점에 쌓였다.
   * 놓는 시점에 배치 규칙을 돌리므로 서로 비켜 앉아야 한다.
   */
  it("연달아 넣은 가구가 서로 다른 자리에 놓인다", async () => {
    const { SceneEngine } = await import("@/scene/engine/SceneEngine");
    const { createEmptyScene } = await import("@/scene/serialization");
    const { executeCommand } = await import("@/ai/tools");
    const { planCenter, footprintOf } = await import("@/scene/placement");
    const { ensureRoom } = await import("@/scene/geometry");

    const engine = new SceneEngine(createEmptyScene());
    // 넉넉한 방 — 자리가 정말 없으면 겹쳐 두는 것 말고 방법이 없다.
    engine.setRoomDimensions({ width: 7000, length: 9000, height: 2400 });

    for (const assetId of [
      "asset_bed_king",
      "asset_wardrobe_slide",
      "asset_fridge_4door",
      "asset_sofa_corner",
    ]) {
      executeCommand(engine, {
        tool: "add_object",
        arguments: { assetId },
        explanation: "",
        confidence: 1,
      });
    }

    const scene = engine.getScene();
    const room = ensureRoom(scene.room);
    expect(scene.objects).toHaveLength(4);

    // 같은 좌표에 두 개가 놓이면 안 된다
    const spots = scene.objects.map((object) => {
      const { cx, cy } = planCenter(object.screen, object.depth, room);
      return `${Math.round(cx)},${Math.round(cy)}`;
    });
    expect(new Set(spots).size).toBe(spots.length);

    // 발자국이 실제로 겹치지도 않아야 한다 (10mm 여유)
    const boxes = scene.objects.map((object) => footprintOf(object, room));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const apart =
          Math.abs(a.cx - b.cx) >= (a.width + b.width) / 2 - 10 ||
          Math.abs(a.cy - b.cy) >= (a.depth + b.depth) / 2 - 10;
        expect(apart).toBe(true);
      }
    }
  });
});
