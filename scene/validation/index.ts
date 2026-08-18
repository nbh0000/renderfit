import { z } from "zod";
import type { Scene, SceneOperation } from "../types";

/* ─────────────────────────── zod schemas ─────────────────────────── */

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const transformSchema = z.object({
  position: vec3,
  rotation: vec3,
  scale: vec3,
});

export const dimensionsSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
  depth: z.number().positive(),
});

export const screenRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number(),
});

export const wallOpeningSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  type: z.enum(["door", "window"]),
  offset: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
  sillHeight: z.number().min(0),
});

export const wallSegmentSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  start: z.tuple([z.number(), z.number()]),
  end: z.tuple([z.number(), z.number()]),
  thickness: z.number().positive(),
  height: z.number().positive(),
  openings: z.array(wallOpeningSchema),
});

export const sceneObjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().min(1),
  category: z.string(),
  transform: transformSchema,
  dimensions: dimensionsSchema,
  screen: screenRectSchema,
  assetId: z.string().nullable(),
  materialId: z.string().nullable(),
  visibility: z.boolean(),
  locked: z.boolean(),
  mask: z
    .object({
      url: z.string().optional(),
      polygon: z.array(z.tuple([z.number(), z.number()])).optional(),
    })
    .nullable(),
  depth: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  source: z.enum(["vision_model", "user", "ai_command", "seed"]),
  order: z.number(),
  metadata: z.record(z.string(), z.unknown()),
});

export const materialSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  roughness: z.number().min(0).max(1),
  metallic: z.number().min(0).max(1),
  normalMapUrl: z.string().nullable().optional(),
  heightMapUrl: z.string().nullable().optional(),
  textureUrl: z.string().nullable().optional(),
  scale: z.number().positive(),
  tags: z.array(z.string()),
});

export const sceneSchema = z.object({
  sceneId: z.string().min(1),
  version: z.number().int().nonnegative(),
  room: z.object({
    type: z.string(),
    dimensions: z.object({
      width: z.number().positive(),
      length: z.number().positive(),
      height: z.number().positive(),
    }),
    walls: z.array(wallSegmentSchema).optional(),
    measured: z.boolean().optional(),
    measuredNote: z.string().optional(),
  }),
  camera: z.object({
    position: vec3,
    rotation: vec3,
    fov: z.number().positive(),
    near: z.number().positive(),
    far: z.number().positive(),
    projection: z.enum(["perspective", "orthographic"]),
  }),
  source: z.object({
    imageUrl: z.string().nullable(),
    generatedImageUrl: z.string().nullable(),
    depthMapUrl: z.string().nullable(),
    segmentationUrl: z.string().nullable(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  objects: z.array(sceneObjectSchema),
  materials: z.array(materialSchema),
  lights: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      type: z.enum(["ambient", "directional", "point", "spot", "area"]),
      intensity: z.number().min(0),
      color: z.string(),
      temperature: z.number().positive(),
      position: vec3,
      rotation: vec3,
      enabled: z.boolean(),
    })
  ),
  renderSettings: z.object({
    resolution: z.tuple([z.number().positive(), z.number().positive()]),
    quality: z.enum(["preview", "final"]),
  }),
  styleId: z.string().nullable(),
  updatedAt: z.string(),
});

export function parseScene(input: unknown): Scene {
  return sceneSchema.parse(input) as Scene;
}

export function isValidScene(input: unknown): boolean {
  return sceneSchema.safeParse(input).success;
}

/* ───────────────────────── operation validation ───────────────────────── */

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

const OBJECT_TARGET_OPS = new Set([
  "MOVE_OBJECT",
  "ROTATE_OBJECT",
  "SCALE_OBJECT",
  "DELETE_OBJECT",
  "REPLACE_OBJECT",
  "CHANGE_MATERIAL",
  "CHANGE_COLOR",
  "CHANGE_VISIBILITY",
  "CHANGE_LOCK",
  "RENAME_OBJECT",
  "REORDER_OBJECT",
  "CHANGE_DIMENSIONS",
]);

/**
 * 잘못된 operation은 Scene에 적용하지 않는다.
 * 존재하지 않는 객체, 잠긴 객체, 음수 스케일, 없는 재질/에셋을 걸러 낸다.
 */
export function validateOperation(scene: Scene, op: SceneOperation): ValidationResult {
  if (OBJECT_TARGET_OPS.has(op.type)) {
    if (!op.objectId) return { ok: false, error: "대상 객체가 지정되지 않았습니다." };
    const target = scene.objects.find((o) => o.id === op.objectId);
    if (!target) return { ok: false, error: "대상 객체를 찾을 수 없습니다." };
    // 잠금 해제 자체는 잠긴 객체에도 허용한다.
    if (target.locked && op.type !== "CHANGE_LOCK") {
      return { ok: false, error: "잠긴 객체는 수정할 수 없습니다." };
    }
  }

  if (op.type === "ADD_OBJECT" || op.type === "DUPLICATE_OBJECT") {
    const parsed = sceneObjectSchema.safeParse(op.after);
    if (!parsed.success) return { ok: false, error: "추가할 객체 데이터가 올바르지 않습니다." };
    if (scene.objects.some((o) => o.id === (op.after as { id: string }).id)) {
      return { ok: false, error: "이미 존재하는 객체 ID입니다." };
    }
  }

  if (op.type === "SCALE_OBJECT") {
    const after = op.after as { transform?: { scale?: number[] }; screen?: { width?: number; height?: number } };
    const scale = after?.transform?.scale;
    if (scale && scale.some((v) => !Number.isFinite(v) || v <= 0)) {
      return { ok: false, error: "스케일은 0보다 커야 합니다." };
    }
    if (after?.screen) {
      const { width, height } = after.screen;
      if ((width !== undefined && width <= 0) || (height !== undefined && height <= 0)) {
        return { ok: false, error: "크기는 0보다 커야 합니다." };
      }
    }
  }

  if (op.type === "CHANGE_MATERIAL") {
    const materialId = (op.after as { materialId?: string })?.materialId;
    if (materialId && !scene.materials.some((m) => m.id === materialId)) {
      return { ok: false, error: "존재하지 않는 재질입니다." };
    }
  }

  if (op.type === "REPLACE_OBJECT") {
    const parsed = sceneObjectSchema.safeParse(op.after);
    if (!parsed.success) return { ok: false, error: "교체할 객체 데이터가 올바르지 않습니다." };
  }

  if (op.type === "CHANGE_DIMENSIONS") {
    const dimensions = (op.after as { dimensions?: Record<string, number> })?.dimensions;
    if (dimensions && Object.values(dimensions).some((value) => !Number.isFinite(value) || value <= 0)) {
      return { ok: false, error: "치수는 0보다 커야 합니다." };
    }
  }

  if (op.type === "RESIZE_ROOM") {
    const after = op.after as { room?: { dimensions?: Record<string, number> }; objects?: unknown[] };
    const dimensions = after?.room?.dimensions;
    if (dimensions && Object.values(dimensions).some((v) => !Number.isFinite(v) || v <= 0)) {
      return { ok: false, error: "방 치수는 0보다 커야 합니다." };
    }
    if (after?.objects && !Array.isArray(after.objects)) {
      return { ok: false, error: "객체 데이터가 올바르지 않습니다." };
    }
  }

  if (op.type === "CHANGE_ROOM") {
    const room = op.after as { dimensions?: Record<string, number>; walls?: unknown[] };
    if (room?.dimensions && Object.values(room.dimensions).some((v) => !Number.isFinite(v) || v <= 0)) {
      return { ok: false, error: "방 치수는 0보다 커야 합니다." };
    }
    if (room?.walls && !z.array(wallSegmentSchema).safeParse(room.walls).success) {
      return { ok: false, error: "벽 데이터가 올바르지 않습니다." };
    }
  }

  if (op.type === "CHANGE_LIGHT") {
    if (!op.objectId) return { ok: false, error: "대상 조명이 지정되지 않았습니다." };
    if (!scene.lights.some((l) => l.id === op.objectId)) {
      return { ok: false, error: "대상 조명을 찾을 수 없습니다." };
    }
  }

  return { ok: true };
}
