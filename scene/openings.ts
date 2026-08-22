import type { RoomSpec, SceneObject, WallOpening, WallSegment } from "./types";
import { ensureRoom, validateOpening, wallLength } from "./geometry";

/**
 * 사진에서 찾은 창·문을 벽의 개구부로 옮긴다.
 *
 * 분석 결과의 창문·문은 화면 좌표(screen)에만 놓여 있어서 평면도·입면도·3D 어디에도
 * 나타나지 않았다. 실측 치수를 넣는 순간 그 방 구조대로 도면이 나와야 하므로,
 * 화면 좌표를 방 평면 좌표로 바꾼 뒤 가장 가까운 벽에 투영해 개구부로 만든다.
 *
 * 좌표 규칙은 도면 생성기(toPlanData)와 같다.
 *   cx = (screen.x + screen.width / 2) × 방 가로
 *   cy = depth × 방 세로
 */

/** 창의 기본 하단 높이 (mm) — 화면에서 높이를 못 읽을 때 쓴다 */
const DEFAULT_SILL = 900;

/** 개구부로 옮길 수 있는 객체인지 */
export function isOpeningObject(object: SceneObject): boolean {
  return object.type === "window" || object.type === "door";
}

/**
 * 이미 벽 개구부가 된 창·문 객체의 id.
 *
 * 벽에 뚫린 개구부와 객체를 둘 다 그리면 같은 창문이 두 개로 보인다 —
 * 평면도에서는 벽에 하나·바닥에 하나, 3D에서는 벽 구멍 하나·허공에 뜬 판 하나.
 * 평면도·3D가 같은 기준으로 걸러 내도록 여기서 한 번만 계산한다.
 */
export function openingObjectIds(room: RoomSpec): Set<string> {
  return new Set(
    (room.walls ?? [])
      .flatMap((wall) => wall.openings ?? [])
      .map((opening) => opening.id)
      .filter((id) => id.startsWith("op_auto_"))
      .map((id) => id.slice("op_auto_".length))
  );
}

/** 점에서 선분(벽)까지의 거리와, 벽 시작점 기준 투영 거리 */
export function projectOntoWall(
  wall: WallSegment,
  point: [number, number]
): { distance: number; offset: number } {
  const [ax, ay] = wall.start;
  const [bx, by] = wall.end;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) return { distance: Number.POSITIVE_INFINITY, offset: 0 };

  const t = ((point[0] - ax) * dx + (point[1] - ay) * dy) / lengthSq;
  const clamped = Math.min(1, Math.max(0, t));
  const px = ax + dx * clamped;
  const py = ay + dy * clamped;

  return {
    distance: Math.hypot(point[0] - px, point[1] - py),
    offset: clamped * Math.sqrt(lengthSq),
  };
}

export interface DerivedOpenings {
  walls: WallSegment[];
  /** 새로 만들어진 개구부 수 */
  added: number;
  /** 자리가 없어 건너뛴 객체 이름 */
  skipped: string[];
}

/**
 * 창·문 객체를 개구부로 변환해 벽에 붙인 결과를 돌려준다.
 * 이미 같은 객체에서 만든 개구부가 있으면 갈아 끼운다(metadata.fromObjectId로 추적).
 */
export function deriveOpenings(room: RoomSpec, objects: SceneObject[]): DerivedOpenings {
  const filled = ensureRoom(room);
  const walls = (filled.walls ?? []).map((wall) => ({
    ...wall,
    // 이전에 사진에서 따온 개구부는 걷어내고 다시 만든다. 손으로 넣은 것은 남긴다.
    openings: (wall.openings ?? []).filter((opening) => !opening.id.startsWith("op_auto_")),
  }));

  const { width: roomWidth, length: roomLength, height: roomHeight } = filled.dimensions;
  const skipped: string[] = [];
  let added = 0;

  for (const object of objects) {
    if (!isOpeningObject(object) || !object.visibility) continue;

    const cx = (object.screen.x + object.screen.width / 2) * roomWidth;
    const cy = object.depth * roomLength;

    let best: { wall: WallSegment; offset: number; distance: number } | null = null;
    for (const wall of walls) {
      const { distance, offset } = projectOntoWall(wall, [cx, cy]);
      if (!best || distance < best.distance) best = { wall, offset, distance };
    }
    if (!best) continue;

    const length = wallLength(best.wall);
    const width = Math.min(object.dimensions.width, Math.max(200, length - 200));
    const height = Math.min(object.dimensions.height, roomHeight - 100);

    // 투영 지점을 개구부 중앙으로 보고 좌측 끝을 구한 뒤 벽 안으로 밀어 넣는다.
    const offset = Math.round(Math.min(Math.max(0, best.offset - width / 2), length - width));

    const sillHeight =
      object.type === "door"
        ? 0
        : Math.round(
            Math.min(
              Math.max(0, (1 - (object.screen.y + object.screen.height)) * roomHeight),
              Math.max(0, roomHeight - height)
            )
          ) || DEFAULT_SILL;

    const opening: WallOpening = {
      id: `op_auto_${object.id}`,
      name: object.name,
      type: object.type === "door" ? "door" : "window",
      offset,
      width: Math.round(width),
      height: Math.round(height),
      sillHeight,
      ...(object.type === "door" ? { doorType: "hinged" as const, hinge: "start" as const, swing: "in" as const } : {}),
    };

    const check = validateOpening(best.wall, opening);
    if (!check.ok) {
      skipped.push(object.name);
      continue;
    }

    best.wall.openings = [...(best.wall.openings ?? []), opening];
    added += 1;
  }

  return { walls, added, skipped };
}

/**
 * 벽 길이가 바뀔 때 개구부를 비례로 옮긴다.
 *
 * 예전에는 새 벽을 벗어나는 개구부를 그냥 버려서, 평수를 조금 줄이면 창문이 사라졌다.
 * 위치를 비율로 유지하면 "같은 방을 실측값으로 다시 그린" 결과가 된다.
 */
export function rescaleOpenings(
  openings: WallOpening[],
  fromLength: number,
  toLength: number,
  roomHeight: number
): WallOpening[] {
  if (fromLength <= 0) return [];
  const ratio = toLength / fromLength;

  return openings
    .map((opening) => {
      const width = Math.min(Math.round(opening.width * ratio), Math.max(200, toLength - 100));
      const offset = Math.round(
        Math.min(Math.max(0, opening.offset * ratio), Math.max(0, toLength - width))
      );
      const height = Math.min(opening.height, Math.max(100, roomHeight - opening.sillHeight));

      return { ...opening, offset, width, height };
    })
    .filter((opening) => opening.width >= 200 && opening.offset + opening.width <= toLength);
}
