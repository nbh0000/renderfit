import type { Scene, SceneLight, SceneObject, SceneOperation, OperationType } from "../types";

/**
 * Operation 적용/역적용.
 *
 * 모든 operation은 before/after 두 개의 부분 패치를 들고 있고,
 * 적용은 patch merge, 되돌리기는 before merge로 통일한다.
 * 덕분에 Undo/Redo가 operation 종류마다 특수 코드를 갖지 않는다.
 */

type Patch = Record<string, unknown> | null;

export type OperationTarget = "object" | "light" | "camera" | "source" | "scene";

const TARGET_BY_TYPE: Record<OperationType, OperationTarget> = {
  MOVE_OBJECT: "object",
  ROTATE_OBJECT: "object",
  SCALE_OBJECT: "object",
  DELETE_OBJECT: "object",
  ADD_OBJECT: "object",
  REPLACE_OBJECT: "object",
  DUPLICATE_OBJECT: "object",
  CHANGE_MATERIAL: "object",
  CHANGE_COLOR: "object",
  CHANGE_VISIBILITY: "object",
  CHANGE_LOCK: "object",
  RENAME_OBJECT: "object",
  REORDER_OBJECT: "object",
  CHANGE_LIGHT: "light",
  CHANGE_CAMERA: "camera",
  AI_GENERATE: "source",
  AI_INPAINT: "source",
};

export function operationTarget(type: OperationType): OperationTarget {
  return TARGET_BY_TYPE[type] ?? "scene";
}

/** 중첩 객체를 얕게 병합한다 (transform.position처럼 한 단계 깊이까지). */
function mergePatch<T extends object>(base: T, patch: Patch): T {
  if (!patch) return base;
  const next: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    const current = next[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      next[key] = { ...(current as object), ...(value as object) };
    } else {
      next[key] = value;
    }
  }
  return next as T;
}

function replaceObject(scene: Scene, id: string, updater: (o: SceneObject) => SceneObject): Scene {
  return { ...scene, objects: scene.objects.map((o) => (o.id === id ? updater(o) : o)) };
}

function isCreation(type: OperationType): boolean {
  return type === "ADD_OBJECT" || type === "DUPLICATE_OBJECT";
}

/**
 * operation을 정방향(do) 또는 역방향(undo)으로 적용한 새 Scene을 만든다.
 * Scene은 항상 새 객체로 반환한다(불변).
 */
export function applyOperation(
  scene: Scene,
  op: SceneOperation,
  direction: "do" | "undo" = "do"
): Scene {
  const patch = direction === "do" ? op.after : op.before;
  const target = operationTarget(op.type);
  const stamped = (next: Scene): Scene => ({ ...next, updatedAt: new Date().toISOString() });

  if (target === "camera") {
    return stamped({ ...scene, camera: mergePatch(scene.camera, patch) });
  }

  if (target === "source") {
    return stamped({ ...scene, source: mergePatch(scene.source, patch) });
  }

  if (target === "light") {
    if (!op.objectId) return scene;
    return stamped({
      ...scene,
      lights: scene.lights.map((l) =>
        l.id === op.objectId ? (mergePatch(l, patch) as SceneLight) : l
      ),
    });
  }

  // ── object ──
  const creating = isCreation(op.type);
  const removing = op.type === "DELETE_OBJECT";

  // 생성 operation의 undo == 삭제, 삭제 operation의 undo == 복원
  const shouldAdd = (creating && direction === "do") || (removing && direction === "undo");
  const shouldRemove = (creating && direction === "undo") || (removing && direction === "do");

  if (shouldAdd) {
    const object = (direction === "do" ? op.after : op.before) as unknown as SceneObject;
    if (!object) return scene;
    if (scene.objects.some((o) => o.id === object.id)) return scene;
    return stamped({ ...scene, objects: [...scene.objects, object] });
  }

  if (shouldRemove) {
    const id = op.objectId ?? ((op.before ?? op.after) as { id?: string })?.id;
    if (!id) return scene;
    return stamped({ ...scene, objects: scene.objects.filter((o) => o.id !== id) });
  }

  if (!op.objectId) return scene;

  if (op.type === "REPLACE_OBJECT") {
    const object = (direction === "do" ? op.after : op.before) as unknown as SceneObject;
    if (!object) return scene;
    return stamped(replaceObject(scene, op.objectId, () => object));
  }

  return stamped(replaceObject(scene, op.objectId, (o) => mergePatch(o, patch)));
}

/** 사용자에게 보여줄 operation 이름 */
export const OPERATION_LABEL: Record<OperationType, string> = {
  MOVE_OBJECT: "이동",
  ROTATE_OBJECT: "회전",
  SCALE_OBJECT: "크기 변경",
  DELETE_OBJECT: "삭제",
  ADD_OBJECT: "추가",
  REPLACE_OBJECT: "교체",
  DUPLICATE_OBJECT: "복제",
  CHANGE_MATERIAL: "재질 변경",
  CHANGE_COLOR: "색상 변경",
  CHANGE_LIGHT: "조명 변경",
  CHANGE_VISIBILITY: "표시 전환",
  CHANGE_LOCK: "잠금 전환",
  RENAME_OBJECT: "이름 변경",
  REORDER_OBJECT: "순서 변경",
  CHANGE_CAMERA: "카메라 변경",
  AI_GENERATE: "AI 생성",
  AI_INPAINT: "AI 인페인팅",
};
