import type { DesignProject, RoomSpec, SceneObject } from "@/scene/types";
import { SceneEngine, createId, createSceneObject } from "@/scene/engine/SceneEngine";
import { createEmptyScene, createVersion } from "@/scene/serialization";
import { getProjectRepository } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { renderSceneToSvg } from "@/ai/providers/mock/sceneRaster";
import { ASSET_MAP } from "@/models/assets";
import { MATERIAL_MAP } from "@/models/materials";
import { planCenter, worldXZ } from "@/scene/placement";

/**
 * Demo Mode 시드.
 * 외부 API key 없이도 제품을 끝까지 체험할 수 있도록 완성된 샘플 프로젝트를 만든다.
 */

interface Placement {
  assetId: string;
  name: string;
  screen: { x: number; y: number; width: number; height: number };
  depth: number;
  materialId?: string;
}

const JAPANDI_LIVING_ROOM: Placement[] = [
  { assetId: "asset_rug_jute", name: "주트 러그", screen: { x: 0.24, y: 0.72, width: 0.48, height: 0.14 }, depth: 0.5 },
  { assetId: "asset_sofa_japandi", name: "재팬디 로우 소파", screen: { x: 0.17, y: 0.5, width: 0.34, height: 0.2 }, depth: 0.45 },
  { assetId: "asset_coffee_table_oak", name: "오크 커피 테이블", screen: { x: 0.42, y: 0.64, width: 0.17, height: 0.1 }, depth: 0.35 },
  { assetId: "asset_tv_cabinet", name: "TV 수납장", screen: { x: 0.63, y: 0.58, width: 0.26, height: 0.11 }, depth: 0.7, materialId: "mat_oak" },
  { assetId: "asset_plant_large", name: "대형 화분", screen: { x: 0.07, y: 0.44, width: 0.09, height: 0.28 }, depth: 0.55 },
  { assetId: "asset_floor_lamp", name: "플로어 램프", screen: { x: 0.87, y: 0.32, width: 0.06, height: 0.32 }, depth: 0.6 },
];

/** 시드 배치의 월드 좌표 (m) — screen.x·depth가 가리키는 자리와 같아야 한다 */
function worldPosition(
  placement: Placement,
  heightMm: number,
  room: RoomSpec
): [number, number, number] {
  const [x, z] = worldXZ(planCenter(placement.screen, placement.depth, room), room);
  return [x, heightMm / 2000, z];
}

export async function seedDemoProject(ownerId: string | null): Promise<DesignProject> {
  const scene = createEmptyScene("living-room");
  const engine = new SceneEngine({ ...scene, styleId: "japandi" });

  // 창문은 구조물이므로 잠가 둔다 (실수로 옮기지 않도록).
  const window: SceneObject = createSceneObject(
    {
      type: "window",
      name: "창문",
      category: "window",
      materialId: "mat_white_paint",
      dimensions: { width: 1800, height: 2000, depth: 120 },
      screen: { x: 0.05, y: 0.14, width: 0.24, height: 0.36, rotation: 0 },
      depth: 0.9,
      confidence: 0.95,
      source: "seed",
      locked: true,
    },
    0
  );
  engine.addObject(window);

  JAPANDI_LIVING_ROOM.forEach((placement, index) => {
    const asset = ASSET_MAP[placement.assetId];
    if (!asset) return;

    const materialId = placement.materialId ?? asset.materials[0] ?? null;
    if (materialId && !engine.getScene().materials.some((m) => m.id === materialId)) {
      const material = MATERIAL_MAP[materialId];
      if (material) engine.addMaterial(material);
    }

    engine.addObject(
      createSceneObject(
        {
          type: asset.type,
          name: placement.name,
          category: asset.category,
          assetId: asset.id,
          materialId,
          dimensions: asset.dimensions,
          screen: { ...placement.screen, rotation: 0 },
          transform: {
            position: worldPosition(placement, asset.dimensions.height, scene.room),
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
          depth: placement.depth,
          confidence: 0.9,
          source: "seed",
        },
        index + 1
      )
    );
  });

  // 시드 프로젝트는 히스토리를 비운 상태로 시작한다 (undo로 데모가 지워지면 안 된다).
  const finalScene = engine.getScene();
  const preview = renderSceneToSvg(finalScene, { caption: "Japandi Living Room (demo)" });
  const imageUrl = await getStorage().upload(
    `demo/japandi_${Date.now().toString(36)}.svg`,
    preview,
    "image/svg+xml"
  );

  const now = new Date().toISOString();
  const project: DesignProject = {
    id: createId("prj"),
    ownerId,
    name: "Japandi Living Room",
    status: "ready",
    thumbnailUrl: imageUrl,
    createdAt: now,
    updatedAt: now,
    scene: {
      ...finalScene,
      source: { ...finalScene.source, imageUrl, generatedImageUrl: imageUrl },
    },
    operations: [],
    redoStack: [],
    versions: [createVersion(finalScene, "데모 초기 버전")],
  };

  await getProjectRepository().save(project);
  return project;
}
