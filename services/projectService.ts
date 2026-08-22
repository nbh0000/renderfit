import type {
  DesignProject,
  DoorType,
  Scene,
  SceneObject,
  SourceKind,
  WallOpening,
  WallSegment,
} from "@/scene/types";
import { SceneEngine, createId, createSceneObject } from "@/scene/engine/SceneEngine";
import {
  createEmptyScene,
  createVersion,
  normalizeScene,
  sceneContextForAI,
} from "@/scene/serialization";
import { getProjectRepository } from "@/lib/db";
import { getQueue, type Job } from "@/lib/queue";
import { getStorage } from "@/lib/storage";
import { createProviders } from "@/ai/providers";
import type { PlanFurniture, PlanOpening, RoomAnalysis, RoomPlan } from "@/ai/providers/types";
import { executeCommand, type ToolExecutionResult, TOOL_DEFINITIONS } from "@/ai/tools";
import { MATERIAL_MAP, materialsForSurface, type MaterialSurface } from "@/models/materials";
import { deriveOpenings } from "@/scene/openings";
import { rectangleWalls } from "@/scene/geometry";
import { arrangeObjects, mountHeight, planCenter, worldXZ } from "@/scene/placement";
import { ROOM_MAP, type RoomId } from "@/config/rooms";
import { STYLE_PRESET_MAP } from "@/models/styles";
import { renderMaskSvg } from "@/ai/providers/mock/sceneRaster";

/**
 * 프로젝트 서비스 — API 라우트와 Scene Engine 사이의 유일한 통로.
 * 저장/복원, AI 파이프라인 실행, operation 기록을 여기서 관리한다.
 */

export interface LoadedProject {
  project: DesignProject;
  engine: SceneEngine;
}

export async function createProject(name: string, ownerId: string | null): Promise<DesignProject> {
  const scene = createEmptyScene();
  const now = new Date().toISOString();

  const project: DesignProject = {
    id: createId("prj"),
    ownerId,
    name: name.trim() || "새 프로젝트",
    status: "draft",
    thumbnailUrl: null,
    createdAt: now,
    updatedAt: now,
    scene,
    operations: [],
    redoStack: [],
    versions: [],
  };

  await getProjectRepository().save(project);
  return project;
}

export async function listProjects(ownerId: string | null): Promise<DesignProject[]> {
  return getProjectRepository().list(ownerId);
}

export async function loadProject(
  id: string,
  ownerId: string | null
): Promise<LoadedProject | null> {
  const project = await getProjectRepository().get(id, ownerId);
  if (!project) return null;

  // 예전 형식으로 저장된 프로젝트도 현재 모델(벽·개구부)로 맞춰 연다.
  const engine = new SceneEngine(normalizeScene(project.scene), {
    operations: project.operations,
    redo: project.redoStack,
  });

  return { project, engine };
}

export async function persist(
  loaded: LoadedProject,
  patch: Partial<DesignProject> = {}
): Promise<DesignProject> {
  const next: DesignProject = {
    ...loaded.project,
    ...patch,
    scene: loaded.engine.getScene(),
    operations: loaded.engine.getOperations(),
    redoStack: loaded.engine.getRedoStack(),
    updatedAt: new Date().toISOString(),
  };
  await getProjectRepository().save(next);
  return next;
}

export async function deleteProject(id: string, ownerId: string | null): Promise<void> {
  await getProjectRepository().delete(id, ownerId);
}

/* ─────────────────────── 이미지 업로드 ─────────────────────── */

export async function attachImage(
  loaded: LoadedProject,
  file: { buffer: Buffer; mimeType: string; name: string; kind?: SourceKind }
): Promise<DesignProject> {
  const extension = file.mimeType.includes("png")
    ? "png"
    : file.mimeType.includes("webp")
      ? "webp"
      : "jpg";

  const url = await getStorage().upload(
    `projects/${loaded.project.id}/source.${extension}`,
    file.buffer,
    file.mimeType
  );

  const scene = loaded.engine.getScene();
  loaded.engine.applyGeneration({ generatedImageUrl: null });

  // source.imageUrl은 operation 대상이 아니라 프로젝트 원본이므로 직접 갱신한다.
  const nextScene: Scene = {
    ...loaded.engine.getScene(),
    source: {
      ...scene.source,
      imageUrl: url,
      generatedImageUrl: null,
      kind: file.kind ?? "photo",
    },
  };

  const engine = new SceneEngine(nextScene, {
    operations: loaded.engine.getOperations(),
    redo: loaded.engine.getRedoStack(),
  });

  return persist({ project: loaded.project, engine }, { thumbnailUrl: url, status: "draft" });
}

/* ─────────────────────── AI 분석 파이프라인 ─────────────────────── */

/**
 * 배치 규칙을 적용하고 3D 좌표를 맞춰 넣는다.
 *
 * transform.position은 예전에 방 크기와 무관한 5m×4m 상자를 기준으로 계산돼 있었고,
 * 안쪽 방향도 평면도·3D와 반대였다. 실제로 화면을 그리는 쪽은 screen.x·depth를 보므로
 * 눈에 띄지는 않았지만, Scene을 내보내거나 AI에게 넘길 때는 이 값이 그대로 나간다.
 */
function withPlacement(room: Scene["room"], objects: SceneObject[]): SceneObject[] {
  const patches = new Map(
    arrangeObjects({ room, objects }).map((entry) => [entry.id, entry.patch])
  );

  return objects.map((object) => {
    const patch = patches.get(object.id);
    const screen = patch
      ? { ...object.screen, x: patch.screen.x, rotation: patch.rotation }
      : object.screen;
    const depth = patch ? patch.depth : object.depth;

    const [x, z] = worldXZ(planCenter(screen, depth, room), room);
    const y = mountHeight({ ...object, screen, depth }, room) / 1000;

    return {
      ...object,
      screen,
      depth,
      transform: { ...object.transform, position: [x, y, z] as [number, number, number] },
    };
  });
}

/**
 * 사진에서 복원한 평면(RoomPlan)을 Scene으로 옮긴다.
 *
 * 여기서 하는 일은 좌표 변환이 거의 전부다 — 모델이 이미 도면 좌표(mm)로 답했기 때문에
 * 예전처럼 화면 bbox를 평면으로 되돌리는 추측이 필요 없다. 그래서 유리 칸막이벽처럼
 * 카메라에서 멀어지며 뻗은 요소도 제 벽에 제 길이로 앉는다.
 */
function planToScene(scene: Scene, plan: RoomPlan): Scene {
  const { outline, ceilingHeightMm: height } = plan;
  const width = Math.max(...outline.map((point) => point.x));
  const length = Math.max(...outline.map((point) => point.y));
  const dimensions = { width, length, height };

  const walls: WallSegment[] = outline.map((start, index) => {
    const end = outline[(index + 1) % outline.length];
    const source = plan.walls[index];

    return {
      id: createId("wall"),
      name: source?.name ?? `벽 ${index + 1}`,
      start: [start.x, start.y] as [number, number],
      end: [end.x, end.y] as [number, number],
      thickness: source?.thicknessMm ?? 150,
      height,
      openings: (source?.openings ?? []).map((opening) => toWallOpening(opening, height)),
    };
  });

  const objects = plan.furniture.map((item, index) =>
    createSceneObject(
      {
        type: item.type,
        name: item.name,
        category: item.type,
        materialId: item.material,
        dimensions: { width: item.widthMm, height: item.heightMm, depth: item.depthMm },
        /*
         * 화면 좌표는 이제 평면 좌표를 담는 그릇으로만 쓴다.
         * screen.x·width는 planCenter가 중심을 되돌릴 수 있게, screen.y·height는
         * 입면 높이를 되돌릴 수 있게 역산해 둔다.
         */
        screen: {
          x: item.xMm / width - item.widthMm / width / 2,
          y: 1 - (item.elevationMm + item.heightMm) / height,
          width: item.widthMm / width,
          height: item.heightMm / height,
          rotation: item.rotationDeg,
        },
        transform: {
          position: planWorldPosition(item, dimensions),
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        depth: Math.min(1, Math.max(0, item.yMm / length)),
        confidence: 0.8,
        source: "vision_model",
        mask: null,
        metadata: { detectedColor: item.color, mounting: item.mountedOn },
      },
      index
    )
  );

  const finishes = matchFinishes(plan.finishes);
  // 마감재와 가구 재질을 Scene에 담는다 — 3D는 scene.materials에서 맵을 찾는다.
  const have = new Set(scene.materials.map((material) => material.id));
  const wanted = new Set(
    [...Object.values(finishes ?? {}), ...objects.map((object) => object.materialId)].filter(
      (id): id is string => typeof id === "string" && id.length > 0 && !have.has(id)
    )
  );
  const extraMaterials = [...wanted].map((id) => MATERIAL_MAP[id]).filter(Boolean);

  return {
    ...scene,
    room: {
      ...scene.room,
      type: plan.roomType,
      dimensions,
      walls,
      finishes,
      areas: [
        {
          id: createId("area"),
          name: ROOM_MAP[plan.roomType as RoomId]?.label ?? "실",
          points: outline.map((point) => [point.x, point.y] as [number, number]),
          showArea: true,
        },
      ],
    },
    objects,
    materials: [...scene.materials, ...extraMaterials],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 사진에서 읽은 마감("회색 포세린 타일")을 카탈로그 재질로 옮긴다.
 *
 * 이게 없으면 3D가 Scene의 재질 중 "floor" 태그가 붙은 것을 아무거나 집어 쓴다 —
 * 가구에 딸려 온 오크가 잡혀서, 회색 타일 바닥인 사진이 원목 마루 방으로 그려졌다.
 */
function matchFinishes(
  finishes: RoomPlan["finishes"]
): NonNullable<Scene["room"]["finishes"]> | undefined {
  if (!finishes) return undefined;

  /*
   * "벽"·"바닥" 같은 면 이름은 후보 전체가 공통으로 달고 있는 태그라 아무것도 가려 주지 못한다.
   * 이걸 세면 "노란 도장 벽"이 엉뚱한 대리석에 걸린다 — 실제로 그렇게 잡혔다.
   */
  const NOISE = new Set([
    "바닥", "벽", "천장", "floor", "wall", "ceiling", "마감", "재질", "색", "느낌", "및", "과", "와",
  ]);

  const pick = (text: string | null, surface: MaterialSurface) => {
    if (!text) return null;

    const words = text
      .toLowerCase()
      .split(/[s·,()/]+/)
      .map((word) => word.replace(/(으로|입니다|이다)$/, ""))
      .filter((word) => word.length > 1 && !NOISE.has(word));
    if (words.length === 0) return null;

    // 같은 면에 바를 수 있는 것 중에서만 고른다 — 벽 마감이 바닥으로 가면 안 된다.
    let best: { id: string; score: number } | null = null;
    for (const material of materialsForSurface(surface)) {
      const tags = material.tags.map((tag) => tag.toLowerCase()).filter((tag) => !NOISE.has(tag));
      const name = material.name.toLowerCase();

      let score = 0;
      for (const word of words) {
        if (name.includes(word)) score += 3;
        else if (tags.some((tag) => tag === word)) score += 2;
        // "데코타일"이 "타일"을 품는 경우 — 실제 도면 용어는 대개 이런 합성어다.
        else if (tags.some((tag) => tag.length > 1 && (tag.includes(word) || word.includes(tag)))) {
          score += 2;
        }
      }
      if (!best || score > best.score) best = { id: material.id, score };
    }

    // 스치듯 걸린 것은 버린다 — 엉뚱한 마감을 바르느니 기본값이 낫다.
    return best && best.score >= 2 ? best.id : null;
  };

  return {
    floor: pick(finishes.floor, "floor"),
    wall: pick(finishes.wall, "wall"),
    ceiling: pick(finishes.ceiling, "ceiling"),
  };
}

/** 평면 좌표(mm) → 3D 월드 좌표(m). 높이는 바닥에서 물체 중심까지. */
function planWorldPosition(
  item: PlanFurniture,
  dimensions: Scene["room"]["dimensions"]
): [number, number, number] {
  const [x, z] = worldXZ({ cx: item.xMm, cy: item.yMm }, { dimensions } as Scene["room"]);
  return [x, (item.elevationMm + item.heightMm / 2) / 1000, z];
}

/** 평면 개구부 → 벽 개구부. Scene은 문/창 둘만 알아서 유리 칸막이는 큰 창으로 앉힌다. */
function toWallOpening(opening: PlanOpening, wallHeight: number): WallOpening {
  const isDoor = opening.kind === "door" || opening.kind === "opening";
  const height = Math.min(opening.heightMm, Math.max(200, wallHeight - opening.sillMm));

  return {
    id: `op_auto_${createId("plan")}`,
    name: opening.name,
    type: isDoor ? "door" : "window",
    offset: opening.offsetMm,
    width: opening.widthMm,
    height,
    sillHeight: isDoor ? 0 : opening.sillMm,
    // 문틀만 있는 통로는 문짝을 그리지 않는다.
    ...(isDoor
      ? {
          doorType: (opening.kind === "opening" ? "opening" : "hinged") as DoorType,
          hinge: "start" as const,
          swing: "in" as const,
        }
      : {}),
  };
}

/** vision 분석 결과를 Scene 객체로 변환한다 */
export function analysisToScene(scene: Scene, analysis: RoomAnalysis): Scene {
  // 평면을 복원해 왔으면 그대로 세운다 — 화면 bbox를 되돌리는 추측이 필요 없다.
  if (analysis.plan) return planToScene(scene, analysis.plan);

  const dimensions = analysis.roomDimensions;
  const thickness = scene.room.walls?.[0]?.thickness;
  const walls = rectangleWalls(dimensions, thickness);

  const baseRoom = {
    ...scene.room,
    type: analysis.roomType,
    dimensions,
    walls,
  };

  const detected: SceneObject[] = analysis.objects.map((item, index) =>
    createSceneObject(
      {
        type: item.type,
        name: item.name,
        category: item.type,
        materialId: item.material,
        dimensions: item.dimensions ?? { width: 1000, height: 800, depth: 800 },
        screen: {
          x: item.bbox[0],
          y: item.bbox[1],
          width: item.bbox[2],
          height: item.bbox[3],
          rotation: 0,
        },
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        depth: item.depth,
        confidence: item.confidence,
        source: "vision_model",
        mask: item.maskUrl ? { url: item.maskUrl } : null,
        metadata: { detectedColor: item.color },
      },
      index
    )
  );

  /*
   * 분석기는 물체를 사진 안에서만 본다 — 방 밖으로 삐져나가거나, 벽에 붙은 붙박이장이
   * 방 한가운데 가로로 놓이는 일이 그래서 생긴다. 편집기에 이미 있는 배치 규칙을
   * 여기서 한 번 돌려, 첫 화면부터 사람이 놓은 것처럼 정리된 평면을 보여 준다.
   */
  const objects = withPlacement(baseRoom, detected);

  // 감지 결과가 참조하는 재질을 Scene에 채워 넣는다.
  const materialIds = new Set(scene.materials.map((m) => m.id));
  const extraMaterials = objects
    .map((object) => object.materialId)
    .filter((id): id is string => Boolean(id) && !materialIds.has(id!))
    .map((id) => MATERIAL_MAP[id])
    .filter(Boolean);

  /*
   * 사진에서 찾은 창·문을 벽의 개구부로 옮긴다.
   * 이걸 하지 않으면 평면도·측면도·3D가 사진과 무관한 빈 사각형 방을 그린다.
   */
  const derived = deriveOpenings(baseRoom, objects);

  // 방 전체를 실 하나로 잡아 둔다 — 실명과 면적이 도면에 바로 나오게 한다.
  const areas = baseRoom.areas?.length
    ? baseRoom.areas
    : [
        {
          id: `area_${Math.random().toString(36).slice(2, 10)}`,
          name: ROOM_MAP[analysis.roomType as RoomId]?.label ?? "실",
          points: [
            [0, 0],
            [dimensions.width, 0],
            [dimensions.width, dimensions.length],
            [0, dimensions.length],
          ] as [number, number][],
          showArea: true,
        },
      ];

  return {
    ...scene,
    room: { ...baseRoom, walls: derived.walls, areas },
    objects,
    materials: [...scene.materials, ...extraMaterials],
    styleId: scene.styleId ?? analysis.styleGuess,
    updatedAt: new Date().toISOString(),
  };
}

/** 업로드 이미지 → 분석 → Scene 생성 (background job) */
export function enqueueAnalyze(loaded: LoadedProject): Job {
  const projectId = loaded.project.id;

  return getQueue().enqueue({
    type: "ANALYZE_IMAGE",
    projectId,
    handler: async (update) => {
      const reloaded = await loadProject(projectId, loaded.project.ownerId);
      if (!reloaded) throw new Error("프로젝트를 찾을 수 없습니다.");

      const imageUrl = reloaded.engine.getScene().source.imageUrl;
      if (!imageUrl) throw new Error("먼저 방 사진을 업로드해 주세요.");

      const providers = createProviders({ getScene: () => reloaded.engine.getScene() });

      update(15, "방 종류를 인식하고 있습니다...");
      const analysis = await providers.vision.analyzeRoom({
        url: imageUrl,
        kind: reloaded.engine.getScene().source.kind ?? "photo",
      });

      update(45, "객체를 분리하고 있습니다...");
      const scene = analysisToScene(reloaded.engine.getScene(), analysis);
      const engine = new SceneEngine(scene, {
        operations: reloaded.engine.getOperations(),
        redo: reloaded.engine.getRedoStack(),
      });

      const segmentation = await providers.segmentation.segment({ url: imageUrl });

      update(70, "깊이를 추정하고 있습니다...");
      const depth = await providers.depth.estimateDepth({ url: imageUrl });

      const withMaps: Scene = {
        ...engine.getScene(),
        source: {
          ...engine.getScene().source,
          segmentationUrl: segmentation.segmentationUrl,
          depthMapUrl: depth.depthMapUrl,
        },
      };

      const finalEngine = new SceneEngine(withMaps, {
        operations: engine.getOperations(),
        redo: engine.getRedoStack(),
      });

      update(90, "장면을 구성하고 있습니다...");
      const saved = await persist(
        { project: reloaded.project, engine: finalEngine },
        { status: "ready" }
      );

      return { objectCount: saved.scene.objects.length, roomType: saved.scene.room.type };
    },
  });
}

/**
 * 생성 프롬프트.
 * 편집기는 방 치수를 이미 알고 있으므로 가구 규모를 그 면적에 맞추도록 함께 알려 준다.
 */
function buildGeneratePrompt(scene: Scene, styleFragment?: string, extra?: string): string {
  const { width, length, height } = scene.room.dimensions;
  const areaM2 = ((width / 1000) * (length / 1000)).toFixed(1);

  return [
    "Redesign this interior space.",
    "Keep the position and structure of walls, windows, doors and ceiling exactly as in the original.",
    "Keep the original camera angle and perspective.",
    `The room measures ${Math.round(width)} x ${Math.round(length)} mm ` +
      `(${areaM2} m2) with a ceiling height of ${Math.round(height)} mm ` +
      `(${scene.room.measured ? "measured on site" : "estimated"}). ` +
      "Use furniture sizes, counts and circulation widths that actually fit this area.",
    styleFragment ?? "",
    extra ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Scene + 스타일 → 이미지 생성 (background job) */
export function enqueueGenerate(
  loaded: LoadedProject,
  options: { styleId?: string | null; prompt?: string }
): Job {
  const projectId = loaded.project.id;
  const ownerId = loaded.project.ownerId;

  return getQueue().enqueue({
    type: "GENERATE_INTERIOR",
    projectId,
    handler: async (update) => {
      const reloaded = await loadProject(projectId, ownerId);
      if (!reloaded) throw new Error("프로젝트를 찾을 수 없습니다.");

      const scene = reloaded.engine.getScene();
      const imageUrl = scene.source.imageUrl;
      if (!imageUrl) throw new Error("먼저 방 사진을 업로드해 주세요.");

      const styleId = options.styleId ?? scene.styleId ?? "modern";
      const style = STYLE_PRESET_MAP[styleId];
      const providers = createProviders({ getScene: () => reloaded.engine.getScene() });

      if (options.styleId) reloaded.engine.setStyle(options.styleId);

      update(30, "디자인을 생성하고 있습니다...");

      const prompt = buildGeneratePrompt(scene, style?.promptFragment, options.prompt);

      const result = await providers.generation.generate({
        image: { url: imageUrl },
        prompt,
        depthMap: scene.source.depthMapUrl ? { url: scene.source.depthMapUrl } : null,
        segmentation: scene.source.segmentationUrl ? { url: scene.source.segmentationUrl } : null,
        styleId,
        settings: { objects: scene.objects.length },
      });

      update(80, "장면에 반영하고 있습니다...");
      reloaded.engine.applyGeneration({ generatedImageUrl: result.imageUrl });

      const version = createVersion(
        reloaded.engine.getScene(),
        style ? `${style.label} 생성` : "AI 생성"
      );

      const saved = await persist(reloaded, {
        status: "ready",
        thumbnailUrl: result.imageUrl,
        versions: [...reloaded.project.versions, version].slice(-20),
      });

      return { imageUrl: result.imageUrl, cached: result.cached, version: saved.versions.length };
    },
  });
}

/**
 * 시안 두 개를 만들어 고르게 한다.
 *
 * 한 번에 적용하지 않고 결과만 돌려주며, 사용자가 고른 뒤 applyGeneratedImage로 반영한다.
 * 같은 프롬프트로 두 번 부르면 캐시 때문에 같은 그림이 나오므로 방향을 다르게 준다.
 */
const VARIANT_DIRECTIONS = [
  { label: "A · 따뜻하게", fragment: "Layered warm textiles, softer lighting, cosier styling." },
  {
    label: "B · 담백하게",
    fragment: "Cleaner and more minimal styling, fewer objects, calmer palette.",
  },
];

export function enqueueGenerateVariants(
  loaded: LoadedProject,
  options: { styleId?: string | null; prompt?: string }
): Job {
  const projectId = loaded.project.id;
  const ownerId = loaded.project.ownerId;

  return getQueue().enqueue({
    type: "GENERATE_INTERIOR",
    projectId,
    handler: async (update) => {
      const reloaded = await loadProject(projectId, ownerId);
      if (!reloaded) throw new Error("프로젝트를 찾을 수 없습니다.");

      const scene = reloaded.engine.getScene();
      const imageUrl = scene.source.imageUrl;
      if (!imageUrl) throw new Error("먼저 방 사진을 업로드해 주세요.");

      const styleId = options.styleId ?? scene.styleId ?? "modern";
      const style = STYLE_PRESET_MAP[styleId];
      const providers = createProviders({ getScene: () => reloaded.engine.getScene() });

      const variants: { label: string; imageUrl: string }[] = [];

      for (const [index, direction] of VARIANT_DIRECTIONS.entries()) {
        update(
          20 + index * 40,
          `${index + 1}번째 시안을 만들고 있습니다... (${VARIANT_DIRECTIONS.length}개 중)`
        );

        const result = await providers.generation.generate({
          image: { url: imageUrl },
          prompt: [
            buildGeneratePrompt(scene, style?.promptFragment, options.prompt),
            direction.fragment,
          ].join("\n"),
          depthMap: scene.source.depthMapUrl ? { url: scene.source.depthMapUrl } : null,
          segmentation: scene.source.segmentationUrl ? { url: scene.source.segmentationUrl } : null,
          styleId,
          settings: { objects: scene.objects.length, variant: direction.label },
        });

        variants.push({ label: direction.label, imageUrl: result.imageUrl });
      }

      return { variants };
    },
  });
}

/** 고른 시안을 장면에 반영한다 */
export async function applyGeneratedImage(
  loaded: LoadedProject,
  imageUrl: string,
  label = "AI 생성"
): Promise<DesignProject> {
  loaded.engine.applyGeneration({ generatedImageUrl: imageUrl });
  const version = createVersion(loaded.engine.getScene(), label);

  return persist(loaded, {
    status: "ready",
    thumbnailUrl: imageUrl,
    versions: [...loaded.project.versions, version].slice(-20),
  });
}

/** 특정 객체 영역만 다시 그리기 */
export function enqueueInpaint(
  loaded: LoadedProject,
  options: { objectId: string; prompt: string }
): Job {
  const projectId = loaded.project.id;
  const ownerId = loaded.project.ownerId;

  return getQueue().enqueue({
    type: "INPAINT",
    projectId,
    handler: async (update) => {
      const reloaded = await loadProject(projectId, ownerId);
      if (!reloaded) throw new Error("프로젝트를 찾을 수 없습니다.");

      const scene = reloaded.engine.getScene();
      const object = reloaded.engine.getObject(options.objectId);
      if (!object) throw new Error("대상 객체를 찾을 수 없습니다.");

      const baseImage = scene.source.generatedImageUrl ?? scene.source.imageUrl;
      if (!baseImage) throw new Error("기준 이미지가 없습니다.");

      update(25, "마스크를 만들고 있습니다...");
      const maskSvg = renderMaskSvg(object.screen);
      const maskUrl = await getStorage().upload(
        `projects/${projectId}/mask_${object.id}.svg`,
        maskSvg,
        "image/svg+xml"
      );

      const providers = createProviders({ getScene: () => reloaded.engine.getScene() });

      update(55, "선택 영역을 다시 그리고 있습니다...");
      const result = await providers.generation.inpaint({
        image: { url: baseImage },
        mask: { url: maskUrl },
        prompt: options.prompt || `${object.name} 영역을 자연스럽게 다시 그린다.`,
        styleId: scene.styleId,
      });

      reloaded.engine.applyGeneration({ generatedImageUrl: result.imageUrl }, "AI_INPAINT");
      await persist(reloaded);

      return { imageUrl: result.imageUrl };
    },
  });
}

/** 렌더 (preview/final) */
export function enqueueRender(
  loaded: LoadedProject,
  quality: "preview" | "final",
  options: { viewportImage?: string } = {}
): Job {
  const projectId = loaded.project.id;
  const ownerId = loaded.project.ownerId;

  return getQueue().enqueue({
    type: quality === "final" ? "RENDER_FINAL" : "RENDER_PREVIEW",
    projectId,
    handler: async (update) => {
      const reloaded = await loadProject(projectId, ownerId);
      if (!reloaded) throw new Error("프로젝트를 찾을 수 없습니다.");

      const providers = createProviders({ getScene: () => reloaded.engine.getScene() });
      update(40, quality === "final" ? "최종 렌더링 중입니다..." : "미리보기 렌더링 중입니다...");

      const scene = reloaded.engine.getScene();
      const renderOptions = options.viewportImage
        ? { viewportImage: { url: options.viewportImage } }
        : undefined;
      const result =
        quality === "final"
          ? await providers.rendering.finalRender(scene, renderOptions)
          : await providers.rendering.preview(scene, renderOptions);

      if (quality === "final") {
        await persist(reloaded, { thumbnailUrl: result.imageUrl });
      }

      return result;
    },
  });
}

/* ─────────────────────── AI Command ─────────────────────── */

export interface AICommandResult {
  ok: boolean;
  message: string;
  results: ToolExecutionResult[];
  jobs: Job[];
  project: DesignProject;
}

/** 자연어 명령 실행: Router/LLM → tool call → Scene Engine → 저장 */
export async function runAICommand(
  loaded: LoadedProject,
  instruction: string,
  selectedObjectId: string | null
): Promise<AICommandResult> {
  const providers = createProviders({ getScene: () => loaded.engine.getScene() });
  const context = {
    ...sceneContextForAI(loaded.engine.getScene()),
    selectedObjectId,
  };

  const commands = await providers.llm.structuredCommand({
    instruction,
    tools: TOOL_DEFINITIONS,
    context,
  });

  const results: ToolExecutionResult[] = [];
  const jobs: Job[] = [];

  for (const command of commands) {
    const result = executeCommand(loaded.engine, command);
    results.push(result);

    if (result.ok && result.job) {
      // Scene 변경을 먼저 저장한 뒤 비동기 작업을 건다.
      await persist(loaded);
      if (result.job.type === "GENERATE_INTERIOR") {
        jobs.push(enqueueGenerate(loaded, result.job.params));
      } else if (result.job.type === "INPAINT") {
        jobs.push(enqueueInpaint(loaded, result.job.params));
      } else if (result.job.type === "RENDER_PREVIEW") {
        jobs.push(enqueueRender(loaded, "preview"));
      } else if (result.job.type === "RENDER_FINAL") {
        jobs.push(enqueueRender(loaded, "final"));
      }
    }
  }

  const project = await persist(loaded);
  const failed = results.filter((r) => !r.ok);

  return {
    ok: failed.length < results.length,
    message:
      results.length === 0
        ? "실행할 명령을 찾지 못했습니다."
        : results.map((r) => r.message).join(" "),
    results,
    jobs,
    project,
  };
}

/* ─────────────────────── Undo / Redo / Version ─────────────────────── */

export async function undo(
  loaded: LoadedProject
): Promise<{ ok: boolean; project: DesignProject }> {
  const operation = loaded.engine.undo();
  const project = await persist(loaded);
  return { ok: Boolean(operation), project };
}

export async function redo(
  loaded: LoadedProject
): Promise<{ ok: boolean; project: DesignProject }> {
  const operation = loaded.engine.redo();
  const project = await persist(loaded);
  return { ok: Boolean(operation), project };
}

export async function saveVersion(loaded: LoadedProject, label: string): Promise<DesignProject> {
  const version = createVersion(loaded.engine.getScene(), label);
  return persist(loaded, { versions: [...loaded.project.versions, version].slice(-20) });
}

export async function restoreVersion(
  loaded: LoadedProject,
  versionId: string
): Promise<DesignProject | null> {
  const version = loaded.project.versions.find((v) => v.id === versionId);
  if (!version) return null;

  const engine = new SceneEngine(version.scene, {
    operations: loaded.engine.getOperations(),
    redo: [],
  });

  return persist({ project: loaded.project, engine });
}
