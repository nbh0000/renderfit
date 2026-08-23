import type {
  Annotation,
  Level,
  RoomArea,
  ElectricalFixture,
  Material,
  RoomSpec,
  Scene,
  SceneLight,
  SceneObject,
  SceneOperation,
  OperationType,
  Vec3,
  WallOpening,
  WallSegment,
} from "../types";
import { OBJECT_GROUP_OF } from "../types";
import {
  DEFAULT_WALL_THICKNESS,
  ensureRoom,
  fitObjectsToRoom,
  levelsOf,
  polygonArea,
  rectangleWalls,
  validateOpening,
  wallLength,
} from "../geometry";
import { deriveOpenings, rescaleOpenings } from "../openings";

/** 주석 종류별 undo 라벨 */
const ANNOTATION_LABEL: Record<string, string> = {
  dimension: "치수선 추가",
  text: "텍스트 추가",
  polyline: "폴리라인 추가",
};

import { arrangeObjects, placeObject } from "../placement";
import { isSaneRoomSize, resizeArea as resizeAreaGeometry } from "../resizeArea";
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

  /**
   * 배치 규칙(벽 스냅·겹침 회피·방 안 유지)을 적용해 옮긴다.
   * target을 주면 그 지점으로 옮긴 뒤 정리하고, 없으면 현재 자리를 정리한다.
   */
  placeObject(id: string, target?: { cx: number; cy: number }): CommitResult {
    const object = this.getObject(id);
    if (!object) return { ok: false, error: "대상 객체를 찾을 수 없습니다." };

    const patch = placeObject(this.scene, id, target);
    if (!patch) return { ok: false, error: "이 객체는 자동 배치 대상이 아닙니다." };

    const before = {
      screen: { x: object.screen.x, rotation: object.screen.rotation },
      depth: object.depth,
    };
    const after = {
      screen: { x: patch.screen.x, rotation: patch.rotation },
      depth: patch.depth,
    };

    return this.commit(this.makeOperation("MOVE_OBJECT", id, before, after, "배치"));
  }

  /** 방 안의 가구를 한 번에 정리한다 (undo 한 번으로 되돌아간다) */
  arrangeObjects(): CommitResult {
    const patches = arrangeObjects(this.scene);
    if (patches.length === 0) return { ok: false, error: "정리할 가구가 없습니다." };

    const byId = new Map(patches.map((entry) => [entry.id, entry.patch]));
    const objects = this.scene.objects.map((object) => {
      const patch = byId.get(object.id);
      if (!patch) return object;
      return {
        ...object,
        screen: { ...object.screen, x: patch.screen.x, rotation: patch.rotation },
        depth: patch.depth,
      };
    });

    return this.commit(
      this.makeOperation(
        "RESIZE_ROOM",
        undefined,
        { objects: this.scene.objects },
        { objects },
        `가구 ${patches.length}개 자동 배치`
      )
    );
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

  /* ── 공간(실측 치수 · 벽 · 개구부) ── */

  getWalls(): WallSegment[] {
    return ensureRoom(this.scene.room).walls ?? [];
  }

  getWall(id: string): WallSegment | undefined {
    return this.getWalls().find((wall) => wall.id === id);
  }

  private commitRoom(patch: Partial<RoomSpec>, label: string): CommitResult {
    const room = ensureRoom(this.scene.room);
    const before: Record<string, unknown> = {};
    for (const key of Object.keys(patch) as (keyof RoomSpec)[]) {
      before[key] = room[key];
    }
    // 예전 형식(벽 없음)에서 넘어온 경우 현재 벽도 함께 기록해 undo가 정확하도록 한다.
    if (!this.scene.room.walls) before.walls = room.walls;

    return this.commit(
      this.makeOperation("CHANGE_ROOM", undefined, before, patch as Record<string, unknown>, label)
    );
  }

  /**
   * 면 마감재를 바꾼다 (바닥·벽·천장).
   *
   * 재질이 Scene에 없으면 함께 담는다 — 3D는 scene.materials에서 맵을 찾는다.
   * CHANGE_ROOM으로 커밋하므로 실행 취소가 그대로 동작한다.
   */
  setSurfaceFinish(
    surface: "floor" | "wall" | "ceiling",
    material: Material | null
  ): CommitResult {
    const room = ensureRoom(this.scene.room);

    if (material && !this.scene.materials.some((item) => item.id === material.id)) {
      this.scene = { ...this.scene, materials: [...this.scene.materials, material] };
    }

    const label = { floor: "바닥재", wall: "벽 마감", ceiling: "천장 마감" }[surface];
    return this.commitRoom(
      { finishes: { ...room.finishes, [surface]: material?.id ?? null } },
      `${label} 변경`
    );
  }

  /**
   * 한 변의 실제 길이로 평면 전체를 비례 보정한다.
   *
   * 사진에서 읽은 치수는 비례는 꽤 맞는데 절대 크기가 흔들린다 — 같은 사진에서
   * 방 면적이 60㎡와 81㎡로 갈렸다. 그래서 모든 치수를 AI에게 맞히게 하는 대신,
   * 사람이 줄자로 잰 한 변만 받아 나머지를 그 비율로 끌어당긴다.
   *
   * 가구는 크기를 바꾸지 않는다 — 제품 규격이라 방 크기와 달리 따로 확정된 값이고,
   * 위치는 정규화 좌표라 방이 커지면 알아서 따라 벌어진다.
   */
  calibrateScale(wallId: string, actualMm: number): CommitResult {
    const room = ensureRoom(this.scene.room);
    const wall = (room.walls ?? []).find((item) => item.id === wallId);
    if (!wall) return { ok: false, error: "기준으로 삼을 벽을 찾을 수 없습니다." };

    const current = wallLength(wall);
    if (current <= 0) return { ok: false, error: "길이가 0인 벽은 기준이 될 수 없습니다." };
    if (!Number.isFinite(actualMm) || actualMm < 300 || actualMm > 100000) {
      return { ok: false, error: "실제 길이를 300~100000mm 사이로 입력해 주세요." };
    }

    const k = actualMm / current;
    if (Math.abs(k - 1) < 0.001) {
      return { ok: false, error: "이미 그 길이입니다." };
    }

    const mm = (value: number) => Math.round(value * k);

    return this.commitRoom(
      {
        dimensions: {
          width: mm(room.dimensions.width),
          length: mm(room.dimensions.length),
          // 천장고는 사람이 서서 재기 쉬워 따로 입력받는다 — 여기서 건드리지 않는다.
          height: room.dimensions.height,
        },
        walls: (room.walls ?? []).map((item) => ({
          ...item,
          start: [mm(item.start[0]), mm(item.start[1])] as [number, number],
          end: [mm(item.end[0]), mm(item.end[1])] as [number, number],
          openings: (item.openings ?? []).map((opening) => ({
            ...opening,
            offset: mm(opening.offset),
            width: mm(opening.width),
          })),
        })),
        areas: (room.areas ?? []).map((area) => ({
          ...area,
          points: area.points.map(([x, y]) => [mm(x), mm(y)] as [number, number]),
        })),
        annotations: (room.annotations ?? []).map((annotation) => ({
          ...annotation,
          points: annotation.points.map(([x, y]) => [mm(x), mm(y)] as [number, number]),
        })),
        electrical: (room.electrical ?? []).map((fixture) => ({
          ...fixture,
          offset: mm(fixture.offset),
          point: fixture.point
            ? ([mm(fixture.point[0]), mm(fixture.point[1])] as [number, number])
            : undefined,
        })),
        measured: true,
      },
      `축척 보정 (×${k.toFixed(3)})`
    );
  }

  /** 실측 치수 입력 — 벽이 자동 생성된 직사각형이면 새 치수로 다시 만든다 */
  setRoomDimensions(
    dimensions: Partial<RoomSpec["dimensions"]>,
    options: { measured?: boolean; note?: string; rebuildWalls?: boolean } = {}
  ): CommitResult {
    const room = ensureRoom(this.scene.room);
    const next = { ...room.dimensions, ...dimensions };

    if (next.width <= 0 || next.length <= 0 || next.height <= 0) {
      return { ok: false, error: "치수는 0보다 커야 합니다." };
    }
    if (next.width > 50000 || next.length > 50000 || next.height > 10000) {
      return { ok: false, error: "치수가 너무 큽니다. mm 단위로 입력해 주세요." };
    }

    const patch: Partial<RoomSpec> = { dimensions: next };
    if (options.measured !== undefined) patch.measured = options.measured;
    if (options.note !== undefined) patch.measuredNote = options.note;

    // 사용자가 벽을 직접 편집하지 않았다면 새 치수에 맞춰 다시 만든다.
    if (options.rebuildWalls !== false) {
      const thickness = room.walls?.[0]?.thickness ?? DEFAULT_WALL_THICKNESS;
      const rebuilt = rectangleWalls(next, thickness);
      // 기존 개구부는 벽 순서를 유지해 그대로 옮긴다.
      patch.walls = rebuilt.map((wall, index) => {
        const previous = room.walls?.[index];
        if (!previous) return wall;
        const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
        const previousLength = Math.hypot(
          previous.end[0] - previous.start[0],
          previous.end[1] - previous.start[1]
        );

        return {
          ...wall,
          id: previous.id,
          name: previous.name,
          // 벽이 길어지거나 짧아져도 창·문은 같은 비율 자리에 남는다.
          openings: rescaleOpenings(previous.openings ?? [], previousLength, length, next.height),
        };
      });
    }

    // 방이 줄면서 벽 밖으로 나간 가구는 같은 operation 안에서 안으로 들여놓는다.
    const fitted = fitObjectsToRoom(this.scene.objects, next);
    if (fitted.changed === 0) return this.commitRoom(patch, "실측 치수 반영");

    const before: Record<string, unknown> = {
      room: Object.fromEntries(
        (Object.keys(patch) as (keyof RoomSpec)[]).map((key) => [key, room[key]])
      ),
      objects: this.scene.objects,
    };

    return this.commit(
      this.makeOperation(
        "RESIZE_ROOM",
        undefined,
        before,
        { room: patch, objects: fitted.objects },
        `실측 치수 반영 (가구 ${fitted.changed}개 위치 보정)`
      )
    );
  }


  /**
   * 실 하나의 폭·깊이를 실측값으로 고친다.
   *
   * 도면 스캔은 치수선이 그어진 실만 정확하다. 치수선이 없는 실은 모델이 눈대중으로
   * 그리므로 같은 도면을 두 번 넣어도 달라진다 — 그건 AI를 조여서 없앨 수 있는
   * 오차가 아니라, 사람이 줄자로 잰 값을 넣을 길을 열어 두는 게 맞다.
   *
   * 그 실이 차지한 칸만 늘이므로 이웃 실과 벽은 붙어 있는 관계를 그대로 지킨다.
   * 방과 가구가 함께 바뀌므로 RESIZE_ROOM 하나로 커밋한다 — 되돌리기 한 번이면 원래대로다.
   */
  resizeArea(areaId: string, wanted: { width?: number; length?: number }): CommitResult {
    const area = this.getAreas().find((item) => item.id === areaId);
    if (!area) return { ok: false, error: "실을 찾을 수 없습니다." };

    for (const value of [wanted.width, wanted.length]) {
      if (value !== undefined && !isSaneRoomSize(value)) {
        return { ok: false, error: "치수를 600~30000mm 사이로 입력해 주세요." };
      }
    }

    const next = resizeAreaGeometry(this.scene.room, this.scene.objects, areaId, wanted);
    if (!next) return { ok: false, error: "바꿀 치수를 입력해 주세요." };

    const room = ensureRoom(this.scene.room);
    const patch: Partial<RoomSpec> = {
      dimensions: next.room.dimensions,
      walls: next.room.walls,
      areas: next.room.areas,
      annotations: next.room.annotations,
      measured: true,
    };

    const before: Record<string, unknown> = {
      room: Object.fromEntries(
        (Object.keys(patch) as (keyof RoomSpec)[]).map((key) => [key, room[key]])
      ),
      objects: this.scene.objects,
    };

    return this.commit(
      this.makeOperation(
        "RESIZE_ROOM",
        undefined,
        before,
        { room: patch, objects: next.objects },
        `${area.name} 치수 입력`
      )
    );
  }

  setWalls(walls: WallSegment[], label = "벽 편집"): CommitResult {
    if (walls.some((wall) => wall.thickness <= 0 || wall.height <= 0)) {
      return { ok: false, error: "벽 두께와 높이는 0보다 커야 합니다." };
    }
    return this.commitRoom({ walls }, label);
  }

  addWall(wall: WallSegment): CommitResult {
    return this.setWalls([...this.getWalls(), wall], "벽 추가");
  }

  updateWall(id: string, patch: Partial<WallSegment>): CommitResult {
    const walls = this.getWalls();
    const target = walls.find((wall) => wall.id === id);
    if (!target) return { ok: false, error: "벽을 찾을 수 없습니다." };

    const next = { ...target, ...patch, id: target.id };

    // 벽을 짧게 만들거나 낮추면 개구부가 벽을 벗어날 수 있다 — 그 경우는 막는다.
    const invalid = (next.openings ?? []).find(
      (opening) => !validateOpening({ ...next, openings: [] }, opening).ok
    );
    if (invalid) {
      return {
        ok: false,
        error: `${invalid.name}이(가) 새 벽 크기를 벗어납니다. 개구부를 먼저 조정해 주세요.`,
      };
    }

    return this.setWalls(
      walls.map((wall) => (wall.id === id ? next : wall)),
      "벽 수정"
    );
  }

  deleteWall(id: string): CommitResult {
    const walls = this.getWalls();
    if (!walls.some((wall) => wall.id === id)) return { ok: false, error: "벽을 찾을 수 없습니다." };
    return this.setWalls(
      walls.filter((wall) => wall.id !== id),
      "벽 삭제"
    );
  }

  addOpening(wallId: string, opening: WallOpening): CommitResult {
    const wall = this.getWall(wallId);
    if (!wall) return { ok: false, error: "벽을 찾을 수 없습니다." };

    const check = validateOpening(wall, opening);
    if (!check.ok) return { ok: false, error: check.error };

    return this.updateWall(wallId, { openings: [...(wall.openings ?? []), opening] });
  }

  updateOpening(wallId: string, openingId: string, patch: Partial<WallOpening>): CommitResult {
    const wall = this.getWall(wallId);
    if (!wall) return { ok: false, error: "벽을 찾을 수 없습니다." };

    const current = (wall.openings ?? []).find((opening) => opening.id === openingId);
    if (!current) return { ok: false, error: "개구부를 찾을 수 없습니다." };

    const next = { ...current, ...patch, id: current.id };
    const check = validateOpening(wall, next);
    if (!check.ok) return { ok: false, error: check.error };

    return this.updateWall(wallId, {
      openings: (wall.openings ?? []).map((opening) => (opening.id === openingId ? next : opening)),
    });
  }

  /**
   * 사진에서 찾은 창·문을 벽 개구부로 반영한다.
   * 평면도·입면도·3D가 모두 개구부를 보고 그리므로, 이 한 번으로 세 곳이 같이 바뀐다.
   */
  syncOpeningsFromObjects(): CommitResult & { added?: number; skipped?: string[] } {
    const room = ensureRoom(this.scene.room);
    const { walls, added, skipped } = deriveOpenings(room, this.scene.objects);

    if (added === 0 && skipped.length === 0) {
      return { ok: false, error: "사진에서 찾은 창문이나 문이 없습니다." };
    }

    const result = this.setWalls(walls, `사진 속 창·문 ${added}개 반영`);
    return { ...result, added, skipped };
  }

  /* ─────────────────────────────── 층 ─────────────────────────────── */

  getLevels(): Level[] {
    return levelsOf(this.scene.room);
  }

  /**
   * 층 추가.
   *
   * 바로 아래 층 위에 얹는 게 기본이다 — 층을 만들 때마다 높이를 계산하게 하면
   * 복층 하나 만드는 데도 손이 많이 간다.
   */
  addLevel(input: { name?: string; height?: number; elevation?: number } = {}): CommitResult {
    const levels = this.getLevels();
    const top = levels[levels.length - 1];
    const height = input.height ?? top.height;
    const elevation = input.elevation ?? top.elevation + top.height;

    if (height <= 0) return { ok: false, error: "층 높이는 0보다 커야 합니다." };

    const level: Level = {
      id: `level_${Math.random().toString(36).slice(2, 10)}`,
      name: input.name?.trim() || `${levels.length + 1}층`,
      elevation,
      height,
      visible: true,
    };

    return this.commitRoom({ levels: [...levels, level] }, `${level.name} 추가`);
  }

  updateLevel(id: string, patch: Partial<Level>): CommitResult {
    const levels = this.getLevels();
    const target = levels.find((level) => level.id === id);
    if (!target) return { ok: false, error: "층을 찾을 수 없습니다." };

    const next = { ...target, ...patch, id: target.id };
    if (next.height <= 0) return { ok: false, error: "층 높이는 0보다 커야 합니다." };
    if (!next.name.trim()) return { ok: false, error: "층 이름을 입력해 주세요." };

    return this.commitRoom(
      { levels: levels.map((level) => (level.id === id ? next : level)) },
      "층 수정"
    );
  }

  /**
   * 층 삭제.
   *
   * 그 층에 놓인 벽·실·가구도 함께 사라진다 — 남겨 두면 어느 층에도 속하지 않은
   * 요소가 되어 도면에 유령처럼 남는다. 마지막 층은 지울 수 없다.
   */
  deleteLevel(id: string): CommitResult {
    const levels = this.getLevels();
    if (levels.length <= 1) return { ok: false, error: "마지막 층은 지울 수 없습니다." };
    if (!levels.some((level) => level.id === id)) {
      return { ok: false, error: "층을 찾을 수 없습니다." };
    }

    const remaining = levels.filter((level) => level.id !== id);
    const fallback = remaining[0].id;
    const belongsHere = (item: { levelId?: string }) => (item.levelId ?? levels[0].id) === id;

    const room = ensureRoom(this.scene.room);
    const patch: Partial<RoomSpec> = {
      levels: remaining,
      walls: (room.walls ?? []).filter((wall) => !belongsHere(wall)),
      areas: (room.areas ?? []).filter((area) => !belongsHere(area)),
      annotations: (room.annotations ?? []).filter((item) => !belongsHere(item)),
      electrical: (room.electrical ?? []).filter((item) => !belongsHere(item)),
    };

    // 기준층을 지우면 남은 층 중 첫 번째가 기준층 자리를 이어받는다.
    const objects = this.scene.objects
      .filter((object) => !belongsHere(object))
      .map((object) => (object.levelId === id ? { ...object, levelId: fallback } : object));

    const before: Record<string, unknown> = {
      room: Object.fromEntries(
        (Object.keys(patch) as (keyof RoomSpec)[]).map((key) => [key, room[key]])
      ),
      objects: this.scene.objects,
    };

    return this.commit(
      this.makeOperation("RESIZE_ROOM", undefined, before, { room: patch, objects }, "층 삭제")
    );
  }

  /* ─────────────────────────── 실(방) 영역 ─────────────────────────── */

  private getAreas(): RoomArea[] {
    return this.scene.room.areas ?? [];
  }

  addArea(area: RoomArea): CommitResult {
    const invalid = this.validateArea(area);
    if (invalid) return { ok: false, error: invalid };
    return this.commitRoom({ areas: [...this.getAreas(), area] }, `실 추가 — ${area.name}`);
  }

  updateArea(id: string, patch: Partial<RoomArea>): CommitResult {
    const list = this.getAreas();
    const target = list.find((item) => item.id === id);
    if (!target) return { ok: false, error: "실을 찾을 수 없습니다." };

    const next = { ...target, ...patch, id: target.id };
    const invalid = this.validateArea(next);
    if (invalid) return { ok: false, error: invalid };

    return this.commitRoom(
      { areas: list.map((item) => (item.id === id ? next : item)) },
      "실 수정"
    );
  }

  deleteArea(id: string): CommitResult {
    const list = this.getAreas();
    if (!list.some((item) => item.id === id)) return { ok: false, error: "실을 찾을 수 없습니다." };
    return this.commitRoom({ areas: list.filter((item) => item.id !== id) }, "실 삭제");
  }

  /** 방 외곽 전체를 실 하나로 만든다 — 한 칸짜리 방에서 빠르게 시작하는 길 */
  addAreaFromRoomBounds(name = "거실"): CommitResult {
    const { width, length } = this.scene.room.dimensions;
    return this.addArea({
      id: `area_${Math.random().toString(36).slice(2, 10)}`,
      name,
      points: [
        [0, 0],
        [width, 0],
        [width, length],
        [0, length],
      ],
      showArea: true,
    });
  }

  private validateArea(area: RoomArea): string | null {
    if (area.points.length < 3) return "실은 점이 3개 이상 필요합니다.";
    if (!area.name.trim()) return "실 이름을 입력해 주세요.";
    // 면적이 0에 가까우면 한 줄로 눌린 폴리곤이라 도면에 쓸 수 없다.
    if (polygonArea(area.points) < 100_000) return "실 넓이가 너무 작습니다.";
    return null;
  }

  /* ───────────────────────── 도면 주석 ───────────────────────── */

  private getAnnotations(): Annotation[] {
    return this.scene.room.annotations ?? [];
  }

  addAnnotation(annotation: Annotation): CommitResult {
    const invalid = this.validateAnnotation(annotation);
    if (invalid) return { ok: false, error: invalid };
    return this.commitRoom(
      { annotations: [...this.getAnnotations(), annotation] },
      ANNOTATION_LABEL[annotation.type] ?? "주석 추가"
    );
  }

  updateAnnotation(id: string, patch: Partial<Annotation>): CommitResult {
    const list = this.getAnnotations();
    const target = list.find((item) => item.id === id);
    if (!target) return { ok: false, error: "주석을 찾을 수 없습니다." };

    const next = { ...target, ...patch, id: target.id, type: target.type };
    const invalid = this.validateAnnotation(next);
    if (invalid) return { ok: false, error: invalid };

    return this.commitRoom(
      { annotations: list.map((item) => (item.id === id ? next : item)) },
      "주석 수정"
    );
  }

  deleteAnnotation(id: string): CommitResult {
    const list = this.getAnnotations();
    if (!list.some((item) => item.id === id)) {
      return { ok: false, error: "주석을 찾을 수 없습니다." };
    }
    return this.commitRoom({ annotations: list.filter((item) => item.id !== id) }, "주석 삭제");
  }

  private validateAnnotation(annotation: Annotation): string | null {
    const needed = annotation.type === "text" ? 1 : 2;
    if (annotation.points.length < needed) {
      return `${ANNOTATION_LABEL[annotation.type]}에는 점이 ${needed}개 이상 필요합니다.`;
    }
    if (annotation.type === "text" && !annotation.text?.trim()) {
      return "텍스트 내용을 입력해 주세요.";
    }
    return null;
  }

  /* ─────────────────────── 전기 · 통신 설비 ─────────────────────── */

  private getElectrical(): ElectricalFixture[] {
    return this.scene.room.electrical ?? [];
  }

  addFixture(fixture: ElectricalFixture): CommitResult {
    const invalid = this.validateFixture(fixture);
    if (invalid) return { ok: false, error: invalid };
    return this.commitRoom({ electrical: [...this.getElectrical(), fixture] }, "설비 추가");
  }

  updateFixture(id: string, patch: Partial<ElectricalFixture>): CommitResult {
    const list = this.getElectrical();
    const target = list.find((fixture) => fixture.id === id);
    if (!target) return { ok: false, error: "설비를 찾을 수 없습니다." };

    const next = { ...target, ...patch, id: target.id };
    const invalid = this.validateFixture(next);
    if (invalid) return { ok: false, error: invalid };

    return this.commitRoom(
      { electrical: list.map((fixture) => (fixture.id === id ? next : fixture)) },
      "설비 수정"
    );
  }

  deleteFixture(id: string): CommitResult {
    const list = this.getElectrical();
    if (!list.some((fixture) => fixture.id === id)) {
      return { ok: false, error: "설비를 찾을 수 없습니다." };
    }
    return this.commitRoom(
      { electrical: list.filter((fixture) => fixture.id !== id) },
      "설비 삭제"
    );
  }

  /** 벽 밖이나 천장 위에 설비가 놓이지 않게 막는다 */
  private validateFixture(fixture: ElectricalFixture): string | null {
    const ceiling = this.scene.room.dimensions.height;
    if (fixture.height < 0 || fixture.height > ceiling) {
      return `설치 높이는 0~${ceiling}mm 사이여야 합니다.`;
    }

    if (!fixture.wallId) return null;

    const wall = this.getWall(fixture.wallId);
    if (!wall) return "설비를 붙일 벽을 찾을 수 없습니다.";

    const length = wallLength(wall);
    if (fixture.offset < 0 || fixture.offset > length) {
      return `벽 길이(${Math.round(length)}mm)를 벗어난 위치입니다.`;
    }

    return null;
  }

  deleteOpening(wallId: string, openingId: string): CommitResult {
    const wall = this.getWall(wallId);
    if (!wall) return { ok: false, error: "벽을 찾을 수 없습니다." };

    return this.updateWall(wallId, {
      openings: (wall.openings ?? []).filter((opening) => opening.id !== openingId),
    });
  }

  /** 가구 실측 치수 입력 */
  setDimensions(id: string, dimensions: Partial<SceneObject["dimensions"]>): CommitResult {
    const object = this.getObject(id);
    if (!object) return { ok: false, error: "대상 객체를 찾을 수 없습니다." };

    const next = { ...object.dimensions, ...dimensions };
    if (next.width <= 0 || next.height <= 0 || next.depth <= 0) {
      return { ok: false, error: "치수는 0보다 커야 합니다." };
    }

    return this.commit(
      this.makeOperation(
        "CHANGE_DIMENSIONS",
        id,
        { dimensions: object.dimensions },
        { dimensions: next }
      )
    );
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
    /*
     * 메시·생성 이미지·저작자 표시·층.
     * 여기서 빠뜨리면 카탈로그의 3D 모델이 조용히 사라지고 상자로만 그려진다 —
     * 실제로 그래서 add_object가 modelUrl을 나중에 따로 붙이고 있었다.
     */
    modelUrl: partial.modelUrl ?? null,
    imageUrl: partial.imageUrl ?? null,
    attribution: partial.attribution ?? null,
    ...(partial.levelId ? { levelId: partial.levelId } : {}),
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
