import type {
  Material,
  Scene,
  SceneLight,
  SceneObject,
  SceneOperation,
  OperationType,
  Vec3,
} from "../types";
import { OBJECT_GROUP_OF } from "../types";
import { applyOperation, OPERATION_LABEL } from "../operations";
import { validateOperation, type ValidationResult } from "../validation";

/**
 * Scene Engine — 이 제품의 핵심.
 *
 * React와 완전히 분리된 순수 모듈이다. UI는 엔진을 호출하고 결과를 렌더링만 한다.
 * 모든 변경은 operation으로 기록되므로 Undo/Redo, 버전 관리, AI 커맨드 실행이
 * 같은 경로를 통과한다.
 */

export interface CommitResult {
  ok: boolean;
  error?: string;
  operation?: SceneOperation;
}

let idCounter = 0;

export function createId(prefix: string): string {
  idCounter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${random}${idCounter.toString(36)}`;
}

export class SceneEngine {
  private scene: Scene;
  private undoStack: SceneOperation[] = [];
  private redoStack: SceneOperation[] = [];
  private listeners = new Set<(scene: Scene) => void>();

  constructor(scene: Scene, history: { operations?: SceneOperation[]; redo?: SceneOperation[] } = {}) {
    this.scene = scene;
    this.undoStack = history.operations ?? [];
    this.redoStack = history.redo ?? [];
  }

  /* ── 상태 ── */

  getScene(): Scene {
    return this.scene;
  }

  getOperations(): SceneOperation[] {
    return this.undoStack;
  }

  getRedoStack(): SceneOperation[] {
    return this.redoStack;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  subscribe(listener: (scene: Scene) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const listener of this.listeners) listener(this.scene);
  }

  getObject(id: string): SceneObject | undefined {
    return this.scene.objects.find((o) => o.id === id);
  }

  getMaterial(id: string): Material | undefined {
    return this.scene.materials.find((m) => m.id === id);
  }

  /* ── operation 실행 ── */

  private makeOperation(
    type: OperationType,
    objectId: string | undefined,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    label?: string
  ): SceneOperation {
    return {
      id: createId("op"),
      type,
      objectId,
      before,
      after,
      label: label ?? OPERATION_LABEL[type],
      createdAt: new Date().toISOString(),
    };
  }

  /** 검증 후 적용하고 undo 스택에 쌓는다. 새 작업이 들어오면 redo 스택은 비운다. */
  commit(operation: SceneOperation): CommitResult {
    const validation: ValidationResult = validateOperation(this.scene, operation);
    if (!validation.ok) return { ok: false, error: validation.error };

    this.scene = applyOperation(this.scene, operation, "do");
    this.undoStack = [...this.undoStack, operation];
    this.redoStack = [];
    this.emit();
    return { ok: true, operation };
  }

  undo(): SceneOperation | null {
    const operation = this.undoStack[this.undoStack.length - 1];
    if (!operation) return null;
    this.scene = applyOperation(this.scene, operation, "undo");
    this.undoStack = this.undoStack.slice(0, -1);
    this.redoStack = [...this.redoStack, operation];
    this.emit();
    return operation;
  }

  redo(): SceneOperation | null {
    const operation = this.redoStack[this.redoStack.length - 1];
    if (!operation) return null;
    this.scene = applyOperation(this.scene, operation, "do");
    this.redoStack = this.redoStack.slice(0, -1);
    this.undoStack = [...this.undoStack, operation];
    this.emit();
    return operation;
  }

  /* ── 고수준 API (React/AI는 이 메서드만 호출한다) ── */

  moveObject(
    id: string,
    delta: { screen?: { x?: number; y?: number }; position?: Vec3; depth?: number }
  ): CommitResult {
    const object = this.getObject(id);
    if (!object) return { ok: false, error: "대상 객체를 찾을 수 없습니다." };

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (delta.screen) {
      before.screen = { x: object.screen.x, y: object.screen.y };
      after.screen = {
        x: clamp01(delta.screen.x ?? object.screen.x),
        y: clamp01(delta.screen.y ?? object.screen.y),
      };
    }
    if (delta.position) {
      before.transform = { position: object.transform.position };
      after.transform = { position: delta.position };
    }
    // 3D 뷰에서 안쪽/바깥쪽으로 옮기면 depth가 바뀐다 (2.5D의 앞뒤 순서와 같은 값)
    if (delta.depth !== undefined) {
      before.depth = object.depth;
      after.depth = clamp01(delta.depth);
    }

    return this.commit(this.makeOperation("MOVE_OBJECT", id, before, after));
  }

  rotateObject(id: string, rotation: { screen?: number; world?: Vec3 }): CommitResult {
    const object = this.getObject(id);
    if (!object) return { ok: false, error: "대상 객체를 찾을 수 없습니다." };

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (rotation.screen !== undefined) {
      before.screen = { rotation: object.screen.rotation };
      after.screen = { rotation: normalizeAngle(rotation.screen) };
    }
    if (rotation.world) {
      before.transform = { rotation: object.transform.rotation };
      after.transform = { rotation: rotation.world };
    }

    return this.commit(this.makeOperation("ROTATE_OBJECT", id, before, after));
  }

  scaleObject(
    id: string,
    scale: { screen?: { width?: number; height?: number }; world?: Vec3; factor?: number }
  ): CommitResult {
    const object = this.getObject(id);
    if (!object) return { ok: false, error: "대상 객체를 찾을 수 없습니다." };

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (scale.factor !== undefined) {
      before.screen = { width: object.screen.width, height: object.screen.height };
      after.screen = {
        width: object.screen.width * scale.factor,
        height: object.screen.height * scale.factor,
      };
      before.transform = { scale: object.transform.scale };
      after.transform = {
        scale: object.transform.scale.map((v) => v * scale.factor!) as Vec3,
      };
    }
    if (scale.screen) {
      before.screen = { ...(before.screen as object), width: object.screen.width, height: object.screen.height };
      after.screen = {
        ...(after.screen as object),
        width: scale.screen.width ?? object.screen.width,
        height: scale.screen.height ?? object.screen.height,
      };
    }
    if (scale.world) {
      before.transform = { ...(before.transform as object), scale: object.transform.scale };
      after.transform = { ...(after.transform as object), scale: scale.world };
    }

    return this.commit(this.makeOperation("SCALE_OBJECT", id, before, after));
  }

  deleteObject(id: string): CommitResult {
    const object = this.getObject(id);
    if (!object) return { ok: false, error: "대상 객체를 찾을 수 없습니다." };
    return this.commit(
      this.makeOperation("DELETE_OBJECT", id, object as unknown as Record<string, unknown>, null)
    );
  }

  addObject(object: Partial<SceneObject> & { type: SceneObject["type"]; name: string }): CommitResult {
    const created = createSceneObject(object, this.scene.objects.length);
    return this.commit(
      this.makeOperation("ADD_OBJECT", created.id, null, created as unknown as Record<string, unknown>)
    );
  }

  duplicateObject(id: string): CommitResult {
    const object = this.getObject(id);
    if (!object) return { ok: false, error: "대상 객체를 찾을 수 없습니다." };

    const copy: SceneObject = {
      ...structuredCloneSafe(object),
      id: createId(object.type),
      name: `${object.name} 복사본`,
      locked: false,
      order: this.scene.objects.length,
      screen: {
        ...object.screen,
        x: clamp01(object.screen.x + 0.04),
        y: clamp01(object.screen.y + 0.04),
      },
      source: "user",
    };

    return this.commit(
      this.makeOperation("DUPLICATE_OBJECT", copy.id, null, copy as unknown as Record<string, unknown>)
    );
  }

  replaceObject(id: string, replacement: Partial<SceneObject>): CommitResult {
    const object = this.getObject(id);
    if (!object) return { ok: false, error: "대상 객체를 찾을 수 없습니다." };

    const next: SceneObject = {
      ...structuredCloneSafe(object),
      ...replacement,
      // 같은 자리·같은 id를 유지해야 교체로 보인다.
      id: object.id,
      screen: { ...object.screen, ...(replacement.screen ?? {}) },
      transform: { ...object.transform, ...(replacement.transform ?? {}) },
      source: "ai_command",
    };

    return this.commit(
      this.makeOperation(
        "REPLACE_OBJECT",
        id,
        object as unknown as Record<string, unknown>,
        next as unknown as Record<string, unknown>
      )
    );
  }

  changeMaterial(id: string, materialId: string): CommitResult {
    const object = this.getObject(id);
    if (!object) return { ok: false, error: "대상 객체를 찾을 수 없습니다." };
    return this.commit(
      this.makeOperation("CHANGE_MATERIAL", id, { materialId: object.materialId }, { materialId })
    );
  }

  /** 재질 자체의 색을 바꾸지 않고, 객체 전용 재질을 만들어 색만 교체한다. */
  changeColor(id: string, hexColor: string, materialName?: string): CommitResult {
    const object = this.getObject(id);
    if (!object) return { ok: false, error: "대상 객체를 찾을 수 없습니다." };

    const base = object.materialId ? this.getMaterial(object.materialId) : undefined;
    const material: Material = {
      id: createId("material"),
      name: materialName ?? `${object.name} 컬러`,
      baseColor: hexColor,
      roughness: base?.roughness ?? 0.6,
      metallic: base?.metallic ?? 0,
      textureUrl: base?.textureUrl ?? null,
      scale: base?.scale ?? 1,
      tags: [...(base?.tags ?? []), "custom"],
    };

    // 재질 추가는 operation 이전에 Scene에 반영해야 validation을 통과한다.
    this.scene = { ...this.scene, materials: [...this.scene.materials, material] };

    return this.commit(
      this.makeOperation(
        "CHANGE_COLOR",
        id,
        { materialId: object.materialId },
        { materialId: material.id }
      )
    );
  }

  changeLight(id: string, patch: Partial<SceneLight>): CommitResult {
    const light = this.scene.lights.find((l) => l.id === id);
    if (!light) return { ok: false, error: "대상 조명을 찾을 수 없습니다." };

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of Object.keys(patch) as (keyof SceneLight)[]) {
      before[key] = light[key];
      after[key] = patch[key];
    }

    return this.commit(this.makeOperation("CHANGE_LIGHT", id, before, after));
  }

  setVisibility(id: string, visibility: boolean): CommitResult {
    const object = this.getObject(id);
    if (!object) return { ok: false, error: "대상 객체를 찾을 수 없습니다." };
    return this.commit(
      this.makeOperation("CHANGE_VISIBILITY", id, { visibility: object.visibility }, { visibility })
    );
  }

  setLocked(id: string, locked: boolean): CommitResult {
    const object = this.getObject(id);
    if (!object) return { ok: false, error: "대상 객체를 찾을 수 없습니다." };
    return this.commit(this.makeOperation("CHANGE_LOCK", id, { locked: object.locked }, { locked }));
  }

  renameObject(id: string, name: string): CommitResult {
    const object = this.getObject(id);
    if (!object) return { ok: false, error: "대상 객체를 찾을 수 없습니다." };
    if (!name.trim()) return { ok: false, error: "이름은 비워 둘 수 없습니다." };
    return this.commit(
      this.makeOperation("RENAME_OBJECT", id, { name: object.name }, { name: name.trim() })
    );
  }

  reorderObject(id: string, order: number): CommitResult {
    const object = this.getObject(id);
    if (!object) return { ok: false, error: "대상 객체를 찾을 수 없습니다." };
    return this.commit(this.makeOperation("REORDER_OBJECT", id, { order: object.order }, { order }));
  }

  setCamera(patch: Partial<Scene["camera"]>): CommitResult {
    const before: Record<string, unknown> = {};
    for (const key of Object.keys(patch) as (keyof Scene["camera"])[]) {
      before[key] = this.scene.camera[key];
    }
    return this.commit(this.makeOperation("CHANGE_CAMERA", undefined, before, patch));
  }

  /** AI 생성 결과를 Scene에 반영한다 (원본은 보존). */
  applyGeneration(patch: {
    generatedImageUrl?: string | null;
    depthMapUrl?: string | null;
    segmentationUrl?: string | null;
  }, type: "AI_GENERATE" | "AI_INPAINT" = "AI_GENERATE"): CommitResult {
    const before: Record<string, unknown> = {};
    for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
      before[key] = this.scene.source[key];
    }
    return this.commit(this.makeOperation(type, undefined, before, patch));
  }

  /** 스타일 프리셋 교체 (operation 없이 메타 정보만 갱신) */
  setStyle(styleId: string | null): void {
    this.scene = { ...this.scene, styleId, updatedAt: new Date().toISOString() };
    this.emit();
  }

  addMaterial(material: Material): void {
    if (this.scene.materials.some((m) => m.id === material.id)) return;
    this.scene = { ...this.scene, materials: [...this.scene.materials, material] };
    this.emit();
  }

  /** 레이어 패널용 그룹핑 */
  getLayerGroups(): { group: string; objects: SceneObject[] }[] {
    const groups = new Map<string, SceneObject[]>();
    for (const object of [...this.scene.objects].sort((a, b) => b.order - a.order)) {
      const group = OBJECT_GROUP_OF[object.type] ?? "furniture";
      groups.set(group, [...(groups.get(group) ?? []), object]);
    }
    return [...groups.entries()].map(([group, objects]) => ({ group, objects }));
  }
}

/* ─────────────────────────── helpers ─────────────────────────── */

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeAngle(value: number): number {
  return ((value % 360) + 360) % 360;
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createSceneObject(
  partial: Partial<SceneObject> & { type: SceneObject["type"]; name: string },
  orderFallback = 0
): SceneObject {
  return {
    id: partial.id ?? createId(partial.type),
    name: partial.name,
    type: partial.type,
    category: partial.category ?? partial.type,
    transform: partial.transform ?? {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    dimensions: partial.dimensions ?? { width: 1000, height: 800, depth: 800 },
    screen: partial.screen ?? { x: 0.4, y: 0.5, width: 0.2, height: 0.2, rotation: 0 },
    assetId: partial.assetId ?? null,
    materialId: partial.materialId ?? null,
    visibility: partial.visibility ?? true,
    locked: partial.locked ?? false,
    mask: partial.mask ?? null,
    depth: partial.depth ?? 0.5,
    confidence: partial.confidence ?? 1,
    source: partial.source ?? "user",
    order: partial.order ?? orderFallback,
    metadata: partial.metadata ?? {},
  };
}
