import type { Annotation, RoomArea, SceneObject, WallSegment } from "@/scene/types";
import { pointInPolygon, wallLength } from "@/scene/geometry";

/**
 * 평면도 히트 테스트.
 *
 * "지금 커서 아래에 무엇이 있는가"를 한곳에서 판단한다.
 * 조작 품질은 대부분 여기서 갈린다 — 벽 끝점을 잡으려는데 벽이 잡히거나,
 * 가구 회전 손잡이를 누르려는데 가구가 잡히면 편집기를 쓸 수 없다.
 *
 * 우선순위는 "작고 정밀한 것 먼저"다: 손잡이 → 끝점/꼭짓점 → 가구 → 벽 → 실.
 */

export type HitTarget =
  | { kind: "wall"; id: string; part: "body" | "start" | "end" }
  | { kind: "object"; id: string; part: "body" | "rotate" | "resize" }
  | { kind: "area"; id: string; part: "body" | "vertex"; vertex?: number }
  | { kind: "annotation"; id: string; part: "body" | "vertex"; vertex?: number };

export interface HitContext {
  walls: WallSegment[];
  objects: SceneObject[];
  areas: RoomArea[];
  annotations: Annotation[];
  /** 가구 중심 좌표를 구하는 함수 (방 치수에 따라 달라진다) */
  objectCenter: (object: SceneObject) => [number, number];
  /** 화면 1px에 해당하는 mm — 손잡이 크기를 화면 기준으로 잡는다 */
  mmPerPixel: number;
  /** 지금 선택된 것들 (선택된 대상에만 손잡이가 뜬다) */
  selectedIds: string[];
}

/** 화면에서 손잡이를 잡는 반경 (px) */
export const HANDLE_PX = 9;
/** 선이나 모서리를 잡는 여유 (px) */
export const EDGE_PX = 7;
/** 회전 손잡이가 가구 위로 떨어져 있는 거리 (px) */
export const ROTATE_OFFSET_PX = 26;

function distance(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** 점에서 선분까지의 거리 */
export function distanceToSegment(
  point: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distance(point, a);

  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq));
  return distance(point, [a[0] + dx * t, a[1] + dy * t]);
}

/** 회전을 반영한 가구의 로컬 좌표계로 점을 옮긴다 */
export function toObjectLocal(
  point: [number, number],
  center: [number, number],
  rotationDeg: number
): [number, number] {
  const rad = (-rotationDeg * Math.PI) / 180;
  const dx = point[0] - center[0];
  const dy = point[1] - center[1];
  return [dx * Math.cos(rad) - dy * Math.sin(rad), dx * Math.sin(rad) + dy * Math.cos(rad)];
}

export function hitTest(point: [number, number], context: HitContext): HitTarget | null {
  const { mmPerPixel, selectedIds } = context;
  const handle = HANDLE_PX * mmPerPixel;
  const edge = EDGE_PX * mmPerPixel;

  /* 1) 선택된 가구의 회전·크기 손잡이 */
  for (const object of context.objects) {
    if (!selectedIds.includes(object.id)) continue;

    const center = context.objectCenter(object);
    const local = toObjectLocal(point, center, object.screen.rotation);
    const halfW = (object.dimensions.width * object.transform.scale[0]) / 2;
    const halfD = (object.dimensions.depth * object.transform.scale[2]) / 2;

    // 회전 손잡이 — 가구 위쪽(도면상 안쪽)에 띄운다
    const rotateAt: [number, number] = [0, halfD + ROTATE_OFFSET_PX * mmPerPixel];
    if (distance(local, rotateAt) <= handle) {
      return { kind: "object", id: object.id, part: "rotate" };
    }

    // 크기 손잡이 — 우하단 모서리
    if (distance(local, [halfW, -halfD]) <= handle) {
      return { kind: "object", id: object.id, part: "resize" };
    }
  }

  /* 2) 선택된 벽의 끝점 */
  for (const wall of context.walls) {
    if (!selectedIds.includes(wall.id)) continue;
    if (distance(point, wall.start) <= handle) {
      return { kind: "wall", id: wall.id, part: "start" };
    }
    if (distance(point, wall.end) <= handle) {
      return { kind: "wall", id: wall.id, part: "end" };
    }
  }

  /* 3) 선택된 실·주석의 꼭짓점 */
  for (const area of context.areas) {
    if (!selectedIds.includes(area.id)) continue;
    const index = area.points.findIndex((vertex) => distance(point, vertex) <= handle);
    if (index >= 0) return { kind: "area", id: area.id, part: "vertex", vertex: index };
  }

  for (const annotation of context.annotations) {
    if (!selectedIds.includes(annotation.id)) continue;
    const index = annotation.points.findIndex((vertex) => distance(point, vertex) <= handle);
    if (index >= 0) {
      return { kind: "annotation", id: annotation.id, part: "vertex", vertex: index };
    }
  }

  /* 4) 가구 본체 — 위에 있는 것부터 */
  const sorted = [...context.objects].sort((a, b) => b.order - a.order);
  for (const object of sorted) {
    const center = context.objectCenter(object);
    const local = toObjectLocal(point, center, object.screen.rotation);
    const halfW = (object.dimensions.width * object.transform.scale[0]) / 2;
    const halfD = (object.dimensions.depth * object.transform.scale[2]) / 2;

    if (Math.abs(local[0]) <= halfW && Math.abs(local[1]) <= halfD) {
      return { kind: "object", id: object.id, part: "body" };
    }
  }

  /* 5) 주석 */
  for (const annotation of context.annotations) {
    if (annotation.type === "text") {
      if (distance(point, annotation.points[0]) <= handle * 2) {
        return { kind: "annotation", id: annotation.id, part: "body" };
      }
      continue;
    }

    for (let i = 0; i < annotation.points.length - 1; i += 1) {
      if (distanceToSegment(point, annotation.points[i], annotation.points[i + 1]) <= edge) {
        return { kind: "annotation", id: annotation.id, part: "body" };
      }
    }
  }

  /* 6) 벽 본체 — 두께의 절반 + 여유 안에 들어오면 잡는다 */
  for (const wall of context.walls) {
    if (wallLength(wall) <= 0) continue;
    if (distanceToSegment(point, wall.start, wall.end) <= wall.thickness / 2 + edge) {
      return { kind: "wall", id: wall.id, part: "body" };
    }
  }

  /* 7) 실 — 가장 마지막. 넓은 면이라 다른 것을 덮으면 안 된다 */
  for (const area of context.areas) {
    if (pointInPolygon(point, area.points)) {
      return { kind: "area", id: area.id, part: "body" };
    }
  }

  return null;
}

/**
 * 벽 끝점 자석.
 *
 * 벽을 이어 그릴 때 끝점이 몇 mm씩 어긋나면 도면이 닫히지 않는다.
 * 격자 스냅보다 먼저 걸어서, 근처에 기존 끝점이 있으면 정확히 그 자리에 붙인다.
 */
export function magnetToEndpoints(
  point: [number, number],
  walls: WallSegment[],
  toleranceMm: number
): [number, number] | null {
  let best: { point: [number, number]; distance: number } | null = null;

  for (const wall of walls) {
    for (const candidate of [wall.start, wall.end]) {
      const d = distance(point, candidate);
      if (d <= toleranceMm && (!best || d < best.distance)) {
        best = { point: [candidate[0], candidate[1]], distance: d };
      }
    }
  }

  return best?.point ?? null;
}

/** 사각형 선택 영역 안에 들어오는 대상들 */
export function itemsInMarquee(
  from: [number, number],
  to: [number, number],
  context: HitContext
): string[] {
  const minX = Math.min(from[0], to[0]);
  const maxX = Math.max(from[0], to[0]);
  const minY = Math.min(from[1], to[1]);
  const maxY = Math.max(from[1], to[1]);

  const inside = ([x, y]: [number, number]) => x >= minX && x <= maxX && y >= minY && y <= maxY;

  const ids: string[] = [];

  for (const object of context.objects) {
    if (inside(context.objectCenter(object))) ids.push(object.id);
  }
  for (const wall of context.walls) {
    if (inside(wall.start) && inside(wall.end)) ids.push(wall.id);
  }
  for (const area of context.areas) {
    if (area.points.every(inside)) ids.push(area.id);
  }
  for (const annotation of context.annotations) {
    if (annotation.points.every(inside)) ids.push(annotation.id);
  }

  return ids;
}

/**
 * 벽으로 둘러싸인 영역을 찾아 실 폴리곤을 만든다.
 *
 * Sweet Home 3D에서 벽 안쪽을 더블클릭하면 방이 자동으로 잡히는 동작이다.
 * 벽 끝점을 이어 붙여 닫힌 고리를 찾고, 클릭한 점을 품는 고리를 고른다.
 */
export function findEnclosingLoop(
  point: [number, number],
  walls: WallSegment[],
  toleranceMm = 200
): [number, number][] | null {
  if (walls.length < 3) return null;

  const key = (p: [number, number]) =>
    `${Math.round(p[0] / toleranceMm)}:${Math.round(p[1] / toleranceMm)}`;

  // 끝점을 노드로 보는 인접 그래프를 만든다.
  const nodes = new Map<string, [number, number]>();
  const edges = new Map<string, Set<string>>();

  for (const wall of walls) {
    const a = key(wall.start);
    const b = key(wall.end);
    if (a === b) continue;

    nodes.set(a, wall.start);
    nodes.set(b, wall.end);
    if (!edges.has(a)) edges.set(a, new Set());
    if (!edges.has(b)) edges.set(b, new Set());
    edges.get(a)!.add(b);
    edges.get(b)!.add(a);
  }

  /** 고리를 하나 찾을 때까지 깊이 우선으로 훑는다 (벽 수가 적어 충분히 빠르다) */
  const loops: [number, number][][] = [];

  const walk = (start: string, current: string, visited: string[], depth: number) => {
    if (loops.length > 20 || depth > 12) return;

    for (const next of edges.get(current) ?? []) {
      if (next === start && visited.length >= 3) {
        loops.push(visited.map((id) => nodes.get(id)!));
        continue;
      }
      if (visited.includes(next)) continue;
      walk(start, next, [...visited, next], depth + 1);
    }
  };

  for (const node of edges.keys()) {
    walk(node, node, [node], 0);
    if (loops.length > 0) break;
  }

  // 클릭한 점을 품는 고리 중 가장 작은 것을 고른다 (가장 안쪽 방).
  const containing = loops.filter((loop) => pointInPolygon(point, loop));
  if (containing.length === 0) return null;

  return containing.sort((a, b) => polygonSize(a) - polygonSize(b))[0];
}

function polygonSize(points: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}
