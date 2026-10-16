import type { DesignProject, Scene, SourceKind } from "@/scene/types";
import { SceneEngine, createId } from "@/scene/engine/SceneEngine";
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
import { executeCommand, type ToolExecutionResult, TOOL_DEFINITIONS } from "@/ai/tools";
import { classifyImage, drawingReadability } from "@/scene/imageKind";
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

  /*
   * 원본을 한 번 재 둔다 — 크기와 "사진인가 도면인가".
   *
   * 크기는 밑그림(원본 도면을 평면 뒤에 까는 기능)이 "픽셀당 몇 mm" 로 축척을 잡는 데
   * 쓴다. 여기가 버퍼를 손에 쥐고 있는 유일한 자리다 — 나중에 알아내려면 이미지를
   * 다시 내려받아야 한다.
   *
   * 종류는 더 중요하다. 사진과 도면은 분석 경로가 통째로 다른데, 지금까지는 사용자가
   * 올리기 전에 직접 골라야 했고 기본값이 사진이었다. 실제로 박물관 평면도가 사진으로
   * 올라가 "실내 사진에서 방을 복원" 하는 경로를 탔고, 방 25개짜리 도면이 4개로 나왔다.
   * 사용자는 무엇을 잘못 눌렀는지 알 길이 없고 크레딧은 이미 나간 뒤였다.
   *
   * sharp 가 없는 환경에서도 업로드 자체는 되어야 하므로, 못 읽으면 예전 값을 둔다.
   */
  let size = { width: scene.source.width, height: scene.source.height };
  let kind: SourceKind = file.kind ?? "photo";

  try {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(file.buffer).metadata();
    if (meta.width && meta.height) size = { width: meta.width, height: meta.height };

    /*
     * 작은 그림으로 줄여서 센다.
     *
     * 원본 그대로 세면 4천만 픽셀을 도는 일이 생긴다. 흰 바탕 비율과 채도는 줄여도
     * 거의 그대로라, 200px 짜리 축소본이면 충분하다.
     */
    const { data, info } = await sharp(file.buffer)
      .resize(200, 200, { fit: "inside" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let nearWhite = 0;
    let saturation = 0;
    const pixels = info.width * info.height;

    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      if (r > 235 && g > 235 && b > 235) nearWhite += 1;
      saturation += Math.max(r, g, b) - Math.min(r, g, b);
    }

    const verdict = classifyImage(
      {
        nearWhiteRatio: pixels > 0 ? nearWhite / pixels : 0,
        meanSaturation: pixels > 0 ? saturation / pixels : 0,
        width: size.width,
        height: size.height,
      },
      kind
    );

    kind = verdict.kind;
    if (verdict.overrode) console.info(`[project] ${verdict.reason}`);

    const note = drawingReadability(size);
    if (kind === "floorplan" && note) console.info(`[project] ${note}`);
  } catch {
    console.warn("[project] 원본 이미지를 재지 못했습니다 — 고른 종류를 그대로 씁니다.");
  }

  // source.imageUrl은 operation 대상이 아니라 프로젝트 원본이므로 직접 갱신한다.
  const nextScene: Scene = {
    ...loaded.engine.getScene(),
    source: {
      ...scene.source,
      imageUrl: url,
      generatedImageUrl: null,
      kind,
      width: size.width,
      height: size.height,
    },
  };

  const engine = new SceneEngine(nextScene, {
    operations: loaded.engine.getOperations(),
    redo: loaded.engine.getRedoStack(),
  });

  return persist({ project: loaded.project, engine }, { thumbnailUrl: url, status: "draft" });
}

/**
 * 잡이 실패했을 때 부를 것 — 미리 걷은 크레딧을 돌려주는 데 쓴다.
 *
 * 잡은 응답을 보낸 뒤 백그라운드에서 도는지라, 라우트에서는 실패를 알 수 없다.
 * 그래서 실패 처리를 잡 안으로 들여보낸다.
 */
type OnFailure = () => Promise<void>;



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
  options: { styleId?: string | null; prompt?: string },
  onFailure?: OnFailure
): Job {
  const projectId = loaded.project.id;
  const ownerId = loaded.project.ownerId;

  return getQueue().enqueue({
    type: "GENERATE_INTERIOR",
    projectId,
    handler: async (update) => {
      /* 실패하면 미리 걷은 크레딧을 돌려준다 */
      try {
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
      } catch (error) {
        await onFailure?.();
        throw error;
      }
    },
  });
}

/**
 * 시안 두 개를 만들어 고르게 한다.
 *
 * 한 번에 적용하지 않고 결과만 돌려주며, 사용자가 고른 뒤 applyGeneratedImage로 반영한다.
 * 같은 프롬프트로 두 번 부르면 캐시 때문에 같은 그림이 나오므로 방향을 다르게 준다.
 */
/**
 * 2안 비교에서 만들 방향의 수.
 *
 * 라우트가 이 값을 보고 크레딧을 매긴다. 여기만 늘리고 과금을 안 고치면 원가의
 * 절반만 받게 되므로 함께 내보낸다.
 */
export const VARIANT_COUNT = 2;

const VARIANT_DIRECTIONS = [
  { label: "A · 따뜻하게", fragment: "Layered warm textiles, softer lighting, cosier styling." },
  {
    label: "B · 담백하게",
    fragment: "Cleaner and more minimal styling, fewer objects, calmer palette.",
  },
];

export function enqueueGenerateVariants(
  loaded: LoadedProject,
  options: { styleId?: string | null; prompt?: string },
  onFailure?: OnFailure
): Job {
  const projectId = loaded.project.id;
  const ownerId = loaded.project.ownerId;

  return getQueue().enqueue({
    type: "GENERATE_INTERIOR",
    projectId,
    handler: async (update) => {
      /* 실패하면 미리 걷은 크레딧을 돌려준다 */
      try {
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
      } catch (error) {
        await onFailure?.();
        throw error;
      }
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
  options: { viewportImage?: string } = {},
  onFailure?: OnFailure
): Job {
  const projectId = loaded.project.id;
  const ownerId = loaded.project.ownerId;

  return getQueue().enqueue({
    type: quality === "final" ? "RENDER_FINAL" : "RENDER_PREVIEW",
    projectId,
    handler: async (update) => {
      /* 실패하면 미리 걷은 크레딧을 돌려준다 */
      try {
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
      } catch (error) {
        await onFailure?.();
        throw error;
      }
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
