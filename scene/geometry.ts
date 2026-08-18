import type { RoomSpec, WallOpening, WallSegment } from "./types";

/**
 * 평면 기하 계산.
 *
 * 좌표계: 방의 좌측 하단이 원점(0,0), 단위 mm.
 * DXF·평면도·3D 뷰가 모두 이 좌표계를 공유하므로, 여기서 계산한 값이 곧 도면 값이다.
 */

/** 국내 공동주택 내벽 표준 두께 */
export const DEFAULT_WALL_THICKNESS = 150;

let wallCounter = 0;

function nextId(prefix: string): string {
  wallCounter += 1;
  return `${prefix}_${Math.random().toString(36).slice(2, 7)}${wallCounter.toString(36)}`;
}

/** 직사각형 방의 벽 4개를 만든다 (반시계 방향) */
export function rectangleWalls(
  dimensions: RoomSpec["dimensions"],
  thickness = DEFAULT_WALL_THICKNESS
): WallSegment[] {
  const { width: W, length: L, height: H } = dimensions;

  const corners: [number, number][] = [
    [0, 0],
    [W, 0],
    [W, L],
    [0, L],
  ];

  const names = ["남측 벽", "동측 벽", "북측 벽", "서측 벽"];

  return corners.map((start, index) => ({
    id: nextId("wall"),
    name: names[index] ?? `벽 ${index + 1}`,
    start,
    end: corners[(index + 1) % corners.length],
    thickness,
    height: H,
    openings: [],
  }));
}

/** 저장된 Scene이 예전 형식(벽 없음)이면 직사각형 벽을 채워 준다 */
export function ensureRoom(room: RoomSpec): RoomSpec {
  if (room.walls && room.walls.length > 0) return room;
  return { ...room, walls: rectangleWalls(room.dimensions), measured: room.measured ?? false };
}

export function wallLength(wall: WallSegment): number {
  const dx = wall.end[0] - wall.start[0];
  const dy = wall.end[1] - wall.start[1];
  return Math.hypot(dx, dy);
}

/** 벽 방향 단위벡터 */
export function wallDirection(wall: WallSegment): [number, number] {
  const length = wallLength(wall);
  if (length === 0) return [1, 0];
  return [(wall.end[0] - wall.start[0]) / length, (wall.end[1] - wall.start[1]) / length];
}

/** 벽 시작점에서 distance만큼 떨어진 평면 좌표 */
export function pointAlongWall(wall: WallSegment, distance: number): [number, number] {
  const [dx, dy] = wallDirection(wall);
  return [wall.start[0] + dx * distance, wall.start[1] + dy * distance];
}

/** 벽 각도(도) — 도면 텍스트 회전에 쓴다 */
export function wallAngle(wall: WallSegment): number {
  const [dx, dy] = wallDirection(wall);
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export interface WallSpan {
  /** 벽 시작점 기준 시작 거리(mm) */
  from: number;
  /** 벽 시작점 기준 끝 거리(mm) */
  to: number;
  /** 바닥에서의 시작 높이(mm) */
  bottom: number;
  /** 바닥에서의 끝 높이(mm) */
  top: number;
}

/**
 * 개구부를 제외한 실제 벽체 덩어리를 계산한다.
 *
 * 문·창이 뚫린 벽을 3D에서 그리려면 벽을 여러 조각으로 나눠야 한다.
 *  - 개구부 사이의 온전한 벽
 *  - 창 아래(하인방)와 개구부 위(상인방)
 */
export function wallSpans(wall: WallSegment): WallSpan[] {
  const length = wallLength(wall);
  const height = wall.height;
  const openings = [...(wall.openings ?? [])]
    .filter((opening) => opening.width > 0)
    .sort((a, b) => a.offset - b.offset);

  if (openings.length === 0) {
    return [{ from: 0, to: length, bottom: 0, top: height }];
  }

  const spans: WallSpan[] = [];
  let cursor = 0;

  for (const opening of openings) {
    const start = Math.max(0, Math.min(length, opening.offset));
    const end = Math.max(start, Math.min(length, opening.offset + opening.width));

    // 개구부 앞쪽의 온전한 벽
    if (start > cursor) {
      spans.push({ from: cursor, to: start, bottom: 0, top: height });
    }

    // 창 아래(하인방)
    if (opening.sillHeight > 0) {
      spans.push({ from: start, to: end, bottom: 0, top: opening.sillHeight });
    }

    // 개구부 위(상인방)
    const head = opening.sillHeight + opening.height;
    if (head < height) {
      spans.push({ from: start, to: end, bottom: head, top: height });
    }

    cursor = Math.max(cursor, end);
  }

  if (cursor < length) {
    spans.push({ from: cursor, to: length, bottom: 0, top: height });
  }

  return spans.filter((span) => span.to - span.from > 1 && span.top - span.bottom > 1);
}

/**
 * 새 개구부를 놓을 빈 자리를 찾는다.
 *
 * 기본 위치에 그대로 추가하면 기존 문·창과 겹쳐 거부되므로,
 * 벽을 훑어 폭이 들어가는 첫 구간의 가운데를 돌려준다. 자리가 없으면 null.
 */
export function findFreeOffset(wall: WallSegment, width: number, margin = 100): number | null {
  const total = wallLength(wall);
  const taken = [...(wall.openings ?? [])].sort((a, b) => a.offset - b.offset);

  let cursor = margin;
  for (const opening of taken) {
    if (opening.offset - cursor >= width + margin) {
      return Math.round(cursor + (opening.offset - cursor - width) / 2);
    }
    cursor = Math.max(cursor, opening.offset + opening.width + margin);
  }

  if (total - margin - cursor >= width) {
    return Math.round(cursor + (total - margin - cursor - width) / 2);
  }
  return null;
}

/** 개구부가 벽 범위를 벗어나는지 검사한다 */
export function validateOpening(
  wall: WallSegment,
  opening: WallOpening
): { ok: boolean; error?: string } {
  const length = wallLength(wall);

  if (opening.width <= 0) return { ok: false, error: "개구부 폭은 0보다 커야 합니다." };
  if (opening.height <= 0) return { ok: false, error: "개구부 높이는 0보다 커야 합니다." };
  if (opening.offset < 0) return { ok: false, error: "개구부 위치는 0 이상이어야 합니다." };
  if (opening.offset + opening.width > length) {
    return {
      ok: false,
      error: `개구부가 벽 길이(${Math.round(length)}mm)를 벗어납니다.`,
    };
  }
  if (opening.sillHeight < 0) return { ok: false, error: "하부 높이는 0 이상이어야 합니다." };
  if (opening.sillHeight + opening.height > wall.height) {
    return {
      ok: false,
      error: `개구부가 벽 높이(${Math.round(wall.height)}mm)를 벗어납니다.`,
    };
  }

  const others = (wall.openings ?? []).filter((other) => other.id !== opening.id);
  const overlaps = others.some(
    (other) =>
      opening.offset < other.offset + other.width && other.offset < opening.offset + opening.width
  );
  if (overlaps) return { ok: false, error: "다른 개구부와 겹칩니다." };

  return { ok: true };
}

/** 벽 배치로부터 방의 외곽 치수를 다시 계산한다 */
export function boundsFromWalls(walls: WallSegment[]): { width: number; length: number } {
  if (walls.length === 0) return { width: 0, length: 0 };

  const xs = walls.flatMap((wall) => [wall.start[0], wall.end[0]]);
  const ys = walls.flatMap((wall) => [wall.start[1], wall.end[1]]);

  return {
    width: Math.max(...xs) - Math.min(...xs),
    length: Math.max(...ys) - Math.min(...ys),
  };
}

/**
 * 방을 줄였을 때 벽 밖으로 밀려난 객체를 안으로 들여놓는다.
 *
 * 객체 위치는 정규화 좌표(screen.x, depth)라 방 크기가 바뀌어도 값은 그대로지만,
 * 실제 mm로 환산하면 벽을 뚫고 나간다. 도면·3D가 모두 이 좌표를 쓰므로 여기서 한 번에 보정한다.
 * 벽·천장·바닥처럼 공간 자체를 나타내는 객체는 건드리지 않는다.
 */
export function fitObjectsToRoom<
  T extends {
    type: string;
    screen: { x: number; width: number };
    depth: number;
    dimensions: { width: number; depth: number };
    transform: { scale: [number, number, number] };
  },
>(objects: T[], dimensions: RoomSpec["dimensions"]): { objects: T[]; changed: number } {
  const { width: roomWidth, length: roomLength } = dimensions;
  let changed = 0;

  const next = objects.map((object) => {
    if (object.type === "wall" || object.type === "ceiling" || object.type === "floor") {
      return object;
    }

    const halfWidth = Math.min(
      (object.dimensions.width * object.transform.scale[0]) / 2,
      roomWidth / 2
    );
    const halfDepth = Math.min(
      (object.dimensions.depth * object.transform.scale[2]) / 2,
      roomLength / 2
    );

    // 도면과 같은 방식으로 중심 좌표(mm)를 구한다.
    const centerX = (object.screen.x + object.screen.width / 2) * roomWidth;
    const centerY = object.depth * roomLength;

    const fittedX = Math.min(Math.max(centerX, halfWidth), roomWidth - halfWidth);
    const fittedY = Math.min(Math.max(centerY, halfDepth), roomLength - halfDepth);

    if (Math.abs(fittedX - centerX) < 1 && Math.abs(fittedY - centerY) < 1) return object;

    changed += 1;
    return {
      ...object,
      screen: { ...object.screen, x: fittedX / roomWidth - object.screen.width / 2 },
      depth: Math.min(1, Math.max(0, fittedY / roomLength)),
    };
  });

  return { objects: next, changed };
}

/** 바닥 면적 (m²) — 요약 표시용 */
export function floorArea(dimensions: RoomSpec["dimensions"]): number {
  return (dimensions.width / 1000) * (dimensions.length / 1000);
}

export function createOpening(
  type: WallOpening["type"],
  patch: Partial<WallOpening> = {}
): WallOpening {
  const defaults: WallOpening =
    type === "door"
      ? {
          id: nextId("door"),
          type: "door",
          name: "문",
          offset: 300,
          width: 900,
          height: 2100,
          sillHeight: 0,
        }
      : {
          id: nextId("window"),
          type: "window",
          name: "창문",
          offset: 500,
          width: 1500,
          height: 1200,
          sillHeight: 900,
        };

  return { ...defaults, ...patch, id: patch.id ?? defaults.id, type };
}

export function createWall(
  patch: Partial<WallSegment> & { start: [number, number]; end: [number, number] }
): WallSegment {
  return {
    id: patch.id ?? nextId("wall"),
    name: patch.name ?? "벽",
    start: patch.start,
    end: patch.end,
    thickness: patch.thickness ?? DEFAULT_WALL_THICKNESS,
    height: patch.height ?? 2700,
    openings: patch.openings ?? [],
  };
}
