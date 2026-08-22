import type { RoomSpec, SceneObject } from "./types";
import { ensureRoom } from "./geometry";

/**
 * 가구 배치 규칙.
 *
 * 사람이 놓은 것처럼 보이게 하는 최소 규칙을 담는다.
 *  1) 방 밖으로 나가지 않는다
 *  2) 벽 가까이 놓은 가구는 벽에 딱 붙이고, 벽을 등지도록 돌린다
 *  3) 다른 가구와 겹치지 않는다
 *
 * 좌표는 평면 mm (좌측 하단 원점). Scene의 정규화 좌표(screen.x, depth)와의 변환도 여기서 한다.
 */

/** 이 거리 안이면 벽에 붙인다 (mm) */
export const WALL_SNAP_MM = 600;

/** 벽에 붙였을 때 남기는 틈 — 걸레받이·몰딩 두께 (mm) */
export const WALL_GAP_MM = 20;

/** 벽을 등지고 놓는 것이 자연스러운 가구 */
const WALL_HUGGING = new Set(["sofa", "bed", "cabinet", "tv", "appliance", "desk", "shelf"]);

/** 배치 규칙을 적용하지 않는 것 (공간 자체 / 천장에 달리는 것) */
const SKIP = new Set(["wall", "floor", "ceiling", "window", "door", "lamp", "decoration"]);

/**
 * 바닥에 깔리는 것 — 다른 가구와 겹쳐도 정상이다.
 * 러그는 침대·소파 밑에 깔리므로 충돌로 보면 엉뚱한 곳으로 밀려난다.
 */
const FLAT = new Set(["rug"]);

/* ───────────────── 좌표 규칙 (정규화 ↔ 평면 mm ↔ 3D 월드 m) ───────────────── */

/**
 * 정규화 좌표(screen.x·depth) → 평면 중심(mm, 좌측 하단 원점).
 *
 * 평면도·입면도·3D·개구부 추출이 모두 이 한 규칙을 따라야 한다.
 * 예전에는 뷰마다 따로 계산해서, 같은 물체가 평면도와 3D에서 다른 자리에 있었다.
 */
export function planCenter(
  screen: { x: number; width: number },
  depth: number,
  room: RoomSpec
): { cx: number; cy: number } {
  return {
    cx: (screen.x + screen.width / 2) * room.dimensions.width,
    cy: depth * room.dimensions.length,
  };
}

/**
 * 평면 중심(mm) → 3D 월드의 x·z (m).
 * 3D는 방 중심이 원점이고, 안쪽(depth가 큰 쪽)이 -z다.
 */
export function worldXZ(center: { cx: number; cy: number }, room: RoomSpec): [number, number] {
  return [
    (center.cx - room.dimensions.width / 2) / 1000,
    (room.dimensions.length / 2 - center.cy) / 1000,
  ];
}

/** 물체가 바닥·벽·천장 중 어디에 붙는지 */
export type Mounting = "floor" | "wall" | "ceiling";

/**
 * 붙는 자리를 정한다.
 *
 * 조명은 종류만으로는 천장등인지 스탠드인지 알 수 없어서 사진 속 세로 위치로 가른다 —
 * 천장등은 사진 위쪽에, 플로어 스탠드는 아래쪽에 찍힌다.
 * 이 판단이 없으면 천장등이 방 한가운데 바닥에 놓인 상자로 그려진다.
 */
export function mountingOf(object: SceneObject): Mounting {
  // 평면 분석이 붙는 자리를 직접 알려 준 경우엔 추측하지 않는다.
  const declared = object.metadata?.mounting;
  if (declared === "floor" || declared === "wall" || declared === "ceiling") return declared;

  if (object.type === "window" || object.type === "door") return "wall";
  if (object.type === "tv" || object.type === "decoration") return "wall";
  if (object.type === "lamp") {
    return object.screen.y + object.screen.height / 2 < 0.35 ? "ceiling" : "floor";
  }
  return "floor";
}

/** 벽에 걸린 것이 바닥에 처박히지 않도록 두는 최소 높이 (mm) */
const MIN_WALL_MOUNT_MM = 300;

/**
 * 바닥에서 물체 중심까지의 높이 (mm).
 * 벽에 걸리는 것은 사진 속 세로 위치를, 천장에 매다는 것은 천장고를 따른다.
 */
export function mountHeight(object: SceneObject, room: RoomSpec): number {
  const height = object.dimensions.height * object.transform.scale[1];

  switch (mountingOf(object)) {
    case "wall": {
      const fromPhoto = (1 - (object.screen.y + object.screen.height / 2)) * room.dimensions.height;
      return Math.max(MIN_WALL_MOUNT_MM, fromPhoto);
    }
    case "ceiling":
      return Math.max(0, room.dimensions.height - height / 2);
    default:
      return height / 2;
  }
}

export interface Footprint {
  /** 중심 (mm) */
  cx: number;
  cy: number;
  /** 평면상의 폭·깊이 (mm, 회전 반영) */
  width: number;
  depth: number;
}

/** 회전을 반영한 평면 점유 영역 */
export function footprintOf(object: SceneObject, room: RoomSpec): Footprint {
  const width = object.dimensions.width * object.transform.scale[0];
  const depth = object.dimensions.depth * object.transform.scale[2];

  // 90°·270° 회전이면 가로/세로가 바뀐다.
  const quarter = Math.round((((object.screen.rotation % 360) + 360) % 360) / 90) % 2;

  return {
    ...planCenter(object.screen, object.depth, room),
    width: quarter === 0 ? width : depth,
    depth: quarter === 0 ? depth : width,
  };
}

function overlaps(a: Footprint, b: Footprint, margin = 0): boolean {
  return (
    Math.abs(a.cx - b.cx) < (a.width + b.width) / 2 - margin &&
    Math.abs(a.cy - b.cy) < (a.depth + b.depth) / 2 - margin
  );
}

/** 방 안으로 밀어 넣는다 */
function clampToRoom(footprint: Footprint, room: RoomSpec): Footprint {
  const { width: W, length: L } = room.dimensions;
  const halfW = Math.min(footprint.width / 2, W / 2);
  const halfD = Math.min(footprint.depth / 2, L / 2);

  return {
    ...footprint,
    cx: Math.min(Math.max(footprint.cx, halfW), W - halfW),
    cy: Math.min(Math.max(footprint.cy, halfD), L - halfD),
  };
}

export type WallSide = "south" | "north" | "west" | "east";

/**
 * 벽을 등졌을 때의 회전각(도).
 * 3D에서 가구의 등(등받이·뒷판)은 로컬 -Z를 향하고, rotation.y = -screen.rotation 이다.
 */
export const ROTATION_BY_SIDE: Record<WallSide, number> = {
  north: 0,
  south: 180,
  west: -90,
  east: 90,
};

/** 가장 가까운 벽 (스냅 거리 안일 때만) */
export function nearestWall(footprint: Footprint, room: RoomSpec): WallSide | null {
  const { width: W, length: L } = room.dimensions;

  const distances: [WallSide, number][] = [
    ["west", footprint.cx - footprint.width / 2],
    ["east", W - (footprint.cx + footprint.width / 2)],
    ["south", footprint.cy - footprint.depth / 2],
    ["north", L - (footprint.cy + footprint.depth / 2)],
  ];

  const [side, distance] = distances.reduce((best, entry) => (entry[1] < best[1] ? entry : best));
  return distance <= WALL_SNAP_MM ? side : null;
}

/** 벽에 딱 붙인 좌표 (회전 후 크기를 기준으로) */
function snapToWall(footprint: Footprint, room: RoomSpec, side: WallSide): Footprint {
  const { width: W, length: L } = room.dimensions;
  const next = { ...footprint };

  if (side === "west") next.cx = WALL_GAP_MM + next.width / 2;
  if (side === "east") next.cx = W - WALL_GAP_MM - next.width / 2;
  if (side === "south") next.cy = WALL_GAP_MM + next.depth / 2;
  if (side === "north") next.cy = L - WALL_GAP_MM - next.depth / 2;

  return next;
}

/** 겹치면 벽을 따라 옆으로 비켜 놓는다 */
function slideUntilFree(
  footprint: Footprint,
  others: Footprint[],
  room: RoomSpec,
  side: WallSide | null
): Footprint {
  if (!others.some((other) => overlaps(footprint, other, 10))) return footprint;

  // 벽에 붙은 가구는 벽을 따라, 그 외에는 가로 방향으로 비킨다.
  const alongX = side === "north" || side === "south" || side === null;
  const step = 100;
  const limit = Math.max(room.dimensions.width, room.dimensions.length);

  for (let offset = step; offset <= limit; offset += step) {
    for (const direction of [1, -1]) {
      const candidate = clampToRoom(
        {
          ...footprint,
          cx: alongX ? footprint.cx + direction * offset : footprint.cx,
          cy: alongX ? footprint.cy : footprint.cy + direction * offset,
        },
        room
      );
      if (!others.some((other) => overlaps(candidate, other, 10))) return candidate;
    }
  }

  return footprint;
}

export interface PlacementPatch {
  screen: { x: number };
  depth: number;
  rotation: number;
}

/**
 * 한 객체를 "사람이 놓은 것처럼" 정리한다.
 * target을 주면 그 위치(mm)로 옮긴 뒤 규칙을 적용하고, 없으면 현재 위치를 정리한다.
 */
export function placeObject(
  scene: { room: RoomSpec; objects: SceneObject[] },
  objectId: string,
  target?: { cx: number; cy: number }
): PlacementPatch | null {
  const room = ensureRoom(scene.room);
  const object = scene.objects.find((candidate) => candidate.id === objectId);
  if (!object || SKIP.has(object.type)) return null;

  const others = scene.objects
    .filter(
      (other) =>
        other.id !== objectId && other.visibility && !SKIP.has(other.type) && !FLAT.has(other.type)
    )
    .map((other) => footprintOf(other, room));

  let footprint = footprintOf(object, room);
  if (target) footprint = { ...footprint, cx: target.cx, cy: target.cy };
  footprint = clampToRoom(footprint, room);

  let rotation = object.screen.rotation;
  const side = nearestWall(footprint, room);

  if (side && WALL_HUGGING.has(object.type)) {
    rotation = ROTATION_BY_SIDE[side];
    // 회전이 바뀌면 평면 점유도 바뀐다.
    const quarter = Math.round((((rotation % 360) + 360) % 360) / 90) % 2;
    const width = object.dimensions.width * object.transform.scale[0];
    const depth = object.dimensions.depth * object.transform.scale[2];
    footprint = {
      ...footprint,
      width: quarter === 0 ? width : depth,
      depth: quarter === 0 ? depth : width,
    };
    footprint = snapToWall(footprint, room, side);
  }

  // 러그는 가구 밑에 깔리는 것이 정상이라 비켜 놓지 않는다.
  if (!FLAT.has(object.type)) footprint = slideUntilFree(footprint, others, room, side);
  footprint = clampToRoom(footprint, room);

  return {
    screen: { x: footprint.cx / room.dimensions.width - object.screen.width / 2 },
    depth: Math.min(1, Math.max(0, footprint.cy / room.dimensions.length)),
    rotation,
  };
}

/**
 * 방 안의 가구를 한 번에 정리한다.
 * 큰 가구부터 자리를 잡아야 작은 가구가 밀려나므로 면적 내림차순으로 처리한다.
 */
export function arrangeObjects(scene: { room: RoomSpec; objects: SceneObject[] }): {
  id: string;
  patch: PlacementPatch;
}[] {
  const room = ensureRoom(scene.room);
  const order = [...scene.objects]
    .filter((object) => object.visibility && !SKIP.has(object.type))
    .sort((a, b) => {
      const areaOf = (object: SceneObject) =>
        object.dimensions.width * object.dimensions.depth * object.transform.scale[0];
      return areaOf(b) - areaOf(a);
    });

  // 이미 배치한 것만 충돌 대상으로 삼기 위해 장면을 점진적으로 갱신한다.
  let working: SceneObject[] = scene.objects.map((object) => ({ ...object }));
  const results: { id: string; patch: PlacementPatch }[] = [];

  for (const object of order) {
    const patch = placeObject({ room, objects: working }, object.id);
    if (!patch) continue;

    results.push({ id: object.id, patch });
    working = working.map((candidate) =>
      candidate.id === object.id
        ? {
            ...candidate,
            screen: { ...candidate.screen, x: patch.screen.x, rotation: patch.rotation },
            depth: patch.depth,
          }
        : candidate
    );
  }

  return results;
}
