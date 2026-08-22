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
