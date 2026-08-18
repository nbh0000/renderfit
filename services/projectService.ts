import type { DesignProject, Scene, SceneObject } from "@/scene/types";
import { SceneEngine, createId, createSceneObject } from "@/scene/engine/SceneEngine";
import { createEmptyScene, createVersion, sceneContextForAI } from "@/scene/serialization";
import { getProjectRepository } from "@/lib/db";
import { getQueue, type Job } from "@/lib/queue";
import { getStorage } from "@/lib/storage";
import { createProviders } from "@/ai/providers";
import type { RoomAnalysis } from "@/ai/providers/types";
import { executeCommand, type ToolExecutionResult, TOOL_DEFINITIONS } from "@/ai/tools";
import { MATERIAL_MAP } from "@/models/materials";
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

  const engine = new SceneEngine(project.scene, {
    operations: project.operations,
    redo: project.redoStack,
  });

  return { project, engine };
}

export async function persist(loaded: LoadedProject, patch: Partial<DesignProject> = {}): Promise<DesignProject> {
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
  file: { buffer: Buffer; mimeType: string; name: string }
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
    source: { ...scene.source, imageUrl: url, generatedImageUrl: null },
  };

  const engine = new SceneEngine(nextScene, {
    operations: loaded.engine.getOperations(),
    redo: loaded.engine.getRedoStack(),
  });

  return persist({ project: loaded.project, engine }, { thumbnailUrl: url, status: "draft" });
}

/* ─────────────────────── AI 분석 파이프라인 ─────────────────────── */

/** vision 분석 결과를 Scene 객체로 변환한다 */
export function analysisToScene(scene: Scene, analysis: RoomAnalysis): Scene {
  const objects: SceneObject[] = analysis.objects.map((detected, index) =>
    createSceneObject(
      {
        type: detected.type,
        name: detected.name,
        category: detected.type,
        materialId: detected.material,
        dimensions: detected.dimensions ?? { width: 1000, height: 800, depth: 800 },
        screen: {
          x: detected.bbox[0],
          y: detected.bbox[1],
          width: detected.bbox[2],
          height: detected.bbox[3],
          rotation: 0,
        },
        transform: {
          position: [(detected.bbox[0] - 0.5) * 5, 0, (1 - detected.depth) * 4],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        },
        depth: detected.depth,
        confidence: detected.confidence,
        source: "vision_model",
        mask: detected.maskUrl ? { url: detected.maskUrl } : null,
        metadata: { detectedColor: detected.color },
      },
      index
    )
  );

  // 감지 결과가 참조하는 재질을 Scene에 채워 넣는다.
  const materialIds = new Set(scene.materials.map((m) => m.id));
  const extraMaterials = objects
    .map((object) => object.materialId)
    .filter((id): id is string => Boolean(id) && !materialIds.has(id!))
    .map((id) => MATERIAL_MAP[id])
    .filter(Boolean);

  return {
    ...scene,
    room: { ...scene.room, type: analysis.roomType, dimensions: analysis.roomDimensions },
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
      const analysis = await providers.vision.analyzeRoom({ url: imageUrl });

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

      const prompt = [
        "Redesign this interior space.",
        "Keep the position and structure of walls, windows, doors and ceiling exactly as in the original.",
        "Keep the original camera angle and perspective.",
        style ? style.promptFragment : "",
        options.prompt ?? "",
      ]
        .filter(Boolean)
        .join("\n");

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

      const version = createVersion(reloaded.engine.getScene(), style ? `${style.label} 생성` : "AI 생성");

      const saved = await persist(reloaded, {
        status: "ready",
        thumbnailUrl: result.imageUrl,
        versions: [...reloaded.project.versions, version].slice(-20),
      });

      return { imageUrl: result.imageUrl, cached: result.cached, version: saved.versions.length };
    },
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
export function enqueueRender(loaded: LoadedProject, quality: "preview" | "final"): Job {
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
      const result =
        quality === "final"
          ? await providers.rendering.finalRender(scene)
          : await providers.rendering.preview(scene);

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

export async function undo(loaded: LoadedProject): Promise<{ ok: boolean; project: DesignProject }> {
  const operation = loaded.engine.undo();
  const project = await persist(loaded);
  return { ok: Boolean(operation), project };
}

export async function redo(loaded: LoadedProject): Promise<{ ok: boolean; project: DesignProject }> {
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
