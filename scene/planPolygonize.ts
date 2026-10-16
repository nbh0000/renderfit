import type { FloorPlanDoc, Point, Room } from "@renderfit/plan-schema";

/**
 * 벽에서 방을 다시 만든다.
 *
 * ── 왜 브라우저에서 하나 ──
 *
 * 검수 화면에서 벽 끝점을 끌면 방 모양과 면적이 **그 자리에서** 바뀌어야 한다.
 * 끌 때마다 파이썬 서비스에 다녀오면 한 번에 100ms 씩 걸리고, 손을 떼기 전까지
 * 면적이 옛날 값으로 남아 있어 무엇을 고치는 중인지 알 수 없다.
 *
 * 그래서 같은 일을 순수 계산으로 여기 옮겼다. 파이썬 쪽(shapely.polygonize)과
 * 결과가 같아야 하므로, 하는 일을 그대로 따라 한다 — 끝점을 붙이고, 교차점에서
 * 자르고, 최소 고리를 찾는다.
 *
 * ── 면적은 폴리곤에서만 낸다 ──
 *
 * 도면에 적힌 면적을 믿거나 방 크기를 짐작하지 않는다. 벽이 그리는 고리의 넓이가
 * 곧 면적이다. 벽을 옮기면 면적도 따라 움직이는 것이 맞다.
 */

/** 이 안에 있는 두 점은 같은 자리로 본다 (mm). 손으로 끈 끝점은 딱 맞지 않는다 */
const SNAP_MM = 20;

/** 이보다 작은 고리는 방이 아니다 (mm²) — 0.5㎡. 파이썬 쪽과 같은 값이다 */
const MIN_AREA_MM2 = 500_000;

type Node = { x: number; y: number };
type Edge = { from: number; to: number };

export function polygonArea(ring: readonly Point[]): number {
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    total += x1 * y2 - x2 * y1;
  }
  return total / 2;
}

export function pointInPolygon(point: Point, ring: readonly Point[]): boolean {
  const [x, y] = point;
  let inside = false;

  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];

    if (y1 > y !== y2 > y) {
      const cross = x1 + ((y - y1) / (y2 - y1)) * (x2 - x1);
      if (cross > x) inside = !inside;
    }
  }

  return inside;
}

export function centroid(ring: readonly Point[]): Point {
  const sum = ring.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y] as Point, [0, 0] as Point);
  return [sum[0] / ring.length, sum[1] / ring.length];
}

/* ───────────────────────── 평면 그래프 ───────────────────────── */

class Nodes {
  readonly list: Node[] = [];

  /** 가까운 점은 하나로 묶는다. 이걸 안 하면 방이 닫히지 않아 통째로 사라진다 */
  add(x: number, y: number): number {
    for (let index = 0; index < this.list.length; index += 1) {
      const node = this.list[index];
      if (Math.abs(node.x - x) <= SNAP_MM && Math.abs(node.y - y) <= SNAP_MM) return index;
    }
    this.list.push({ x, y });
    return this.list.length - 1;
  }
}

/** 두 선분이 만나는 점. 끝만 닿거나 나란하면 null */
function crossing(
  a: Point,
  b: Point,
  c: Point,
  d: Point
): { x: number; y: number } | null {
  const rx = b[0] - a[0];
  const ry = b[1] - a[1];
  const sx = d[0] - c[0];
  const sy = d[1] - c[1];

  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < 1e-9) return null;

  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denominator;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denominator;

  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a[0] + rx * t, y: a[1] + ry * t };
}

/** 점이 선분 위에 있으면 그 위치(0~1), 아니면 null */
function positionOn(a: Node, b: Node, point: Node): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 1e-9) return null;

  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
  if (t <= 0 || t >= 1) return null;

  const gap = Math.hypot(a.x + dx * t - point.x, a.y + dy * t - point.y);
  return gap <= SNAP_MM ? t : null;
}

/**
 * 벽을 교차점에서 잘라 평면 그래프로 만든다.
 *
 * T 자로 만나는 곳(끝점이 다른 벽 중간에 닿는 곳)도 잘라야 한다. 안 자르면 그 벽은
 * 고리에 끼지 못하고, 방 두 개가 하나로 뭉친다.
 */
function buildGraph(walls: readonly { a: Point; b: Point }[]): { nodes: Nodes; edges: Edge[] } {
  const nodes = new Nodes();

  /* 먼저 교차점을 전부 절점으로 등록한다 */
  const ends = walls.map((wall) => ({
    a: nodes.add(wall.a[0], wall.a[1]),
    b: nodes.add(wall.b[0], wall.b[1]),
  }));

  for (let i = 0; i < walls.length; i += 1) {
    for (let j = i + 1; j < walls.length; j += 1) {
      const point = crossing(walls[i].a, walls[i].b, walls[j].a, walls[j].b);
      if (point) nodes.add(point.x, point.y);
    }
  }

  const edges: Edge[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < walls.length; index += 1) {
    const a = nodes.list[ends[index].a];
    const b = nodes.list[ends[index].b];

    /* 이 벽 위에 놓인 절점을 전부 모아 순서대로 잇는다 */
    const along: { t: number; node: number }[] = [
      { t: 0, node: ends[index].a },
      { t: 1, node: ends[index].b },
    ];

    for (let candidate = 0; candidate < nodes.list.length; candidate += 1) {
      if (candidate === ends[index].a || candidate === ends[index].b) continue;
      const t = positionOn(a, b, nodes.list[candidate]);
      if (t !== null) along.push({ t, node: candidate });
    }

    along.sort((one, two) => one.t - two.t);

    for (let step = 0; step + 1 < along.length; step += 1) {
      const from = along[step].node;
      const to = along[step + 1].node;
      if (from === to) continue;

      const key = from < to ? `${from}-${to}` : `${to}-${from}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from, to });
    }
  }

  return { nodes, edges };
}

/**
 * 최소 고리(방)를 전부 찾는다.
 *
 * 절점마다 이웃을 각도순으로 세워 두고, 들어온 방향의 **바로 이전 이웃**으로 나간다.
 * 언제나 가장 안쪽으로 도는 셈이라 큰 고리 대신 최소 고리가 나온다. 바깥 테두리는
 * 반대 방향으로 돌아 넓이의 부호가 반대라, 그것으로 걸러 낸다.
 */
function faces(nodes: Nodes, edges: Edge[]): Point[][] {
  const neighbours = new Map<number, number[]>();

  const link = (from: number, to: number) => {
    const list = neighbours.get(from);
    if (list) list.push(to);
    else neighbours.set(from, [to]);
  };

  for (const edge of edges) {
    link(edge.from, edge.to);
    link(edge.to, edge.from);
  }

  const angle = (from: number, to: number) =>
    Math.atan2(nodes.list[to].y - nodes.list[from].y, nodes.list[to].x - nodes.list[from].x);

  for (const [from, list] of neighbours) {
    list.sort((one, two) => angle(from, one) - angle(from, two));
  }

  const visited = new Set<string>();
  const rings: Point[][] = [];

  for (const edge of edges) {
    for (const [start, next] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ]) {
      if (visited.has(`${start}>${next}`)) continue;

      const ring: number[] = [];
      let from = start;
      let to = next;

      /* 절점 수의 두 배를 넘게 돌면 뭔가 잘못된 것이다 — 무한 반복을 막는다 */
      for (let guard = 0; guard <= edges.length * 2 + 4; guard += 1) {
        visited.add(`${from}>${to}`);
        ring.push(from);

        const list = neighbours.get(to);
        if (!list || list.length === 0) break;

        const index = list.indexOf(from);
        const back = list[(index - 1 + list.length) % list.length];

        from = to;
        to = back;

        if (from === start && to === next) break;
      }

      if (ring.length >= 3) {
        rings.push(ring.map((node) => [nodes.list[node].x, nodes.list[node].y] as Point));
      }
    }
  }

  return rings;
}

/** 한 줄로 늘어선 점을 없앤다 — 벽을 자른 자리마다 꼭짓점이 생기기 때문이다 */
function dropCollinear(ring: readonly Point[]): Point[] {
  const out: Point[] = [];

  for (let index = 0; index < ring.length; index += 1) {
    const previous = ring[(index - 1 + ring.length) % ring.length];
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];

    const cross =
      (current[0] - previous[0]) * (next[1] - previous[1]) -
      (current[1] - previous[1]) * (next[0] - previous[0]);

    /* 세 점이 이루는 삼각형 넓이가 사실상 0 이면 가운데 점은 없어도 된다 */
    if (Math.abs(cross) > 1000) out.push(current);
  }

  return out.length >= 3 ? out : [...ring];
}

/** 벽이 그리는 방 폴리곤들 */
export function polygonizeWalls(walls: readonly { a: Point; b: Point }[]): Point[][] {
  if (walls.length < 3) return [];

  const { nodes, edges } = buildGraph(walls);
  if (edges.length < 3) return [];

  const rings = faces(nodes, edges)
    .map(dropCollinear)
    /* 안쪽 고리는 반시계라 넓이가 양수다. 바깥 테두리는 음수라 여기서 빠진다 */
    .filter((ring) => polygonArea(ring) >= MIN_AREA_MM2);

  /* 같은 고리를 두 번 담지 않는다 — 시작점만 다른 같은 방이 있을 수 있다 */
  const unique: Point[][] = [];
  for (const ring of rings) {
    if (unique.some((other) => keyOf(other) === keyOf(ring))) continue;
    unique.push(ring);
  }

  return unique;
}

function keyOf(ring: readonly Point[]): string {
  return [...ring]
    .map(([x, y]) => `${Math.round(x)},${Math.round(y)}`)
    .sort()
    .join("|");
}

/**
 * 벽이 바뀐 뒤 방을 다시 만든다. **이름은 지키고 기하만 새로 낸다.**
 *
 * 사용자가 "주방" 이라고 적어 넣었는데 벽 하나 옮겼다고 이름이 날아가면, 고칠수록
 * 일이 늘어난다. 예전 방의 무게중심이 새 방 안에 들어오면 같은 방으로 본다.
 */
export function recomputeRooms(doc: FloorPlanDoc): FloorPlanDoc {
  const polygons = polygonizeWalls(doc.walls);

  /* 방이 하나도 안 나오면 벽이 아직 닫히지 않은 것이다. 있던 방을 지우지는 않는다 —
     끌고 있는 도중에 방이 통째로 사라지면 무엇을 하는 중인지 알 수 없다 */
  if (polygons.length === 0) return doc;

  const taken = new Set<string>();

  const rooms: Room[] = polygons.map((polygon) => {
    const previous = doc.rooms.find(
      (room) =>
        !taken.has(room.id) &&
        room.polygon.length >= 3 &&
        pointInPolygon(centroid(room.polygon), polygon)
    );
    if (previous) taken.add(previous.id);

    return {
      id: previous?.id ?? `room_${Math.random().toString(36).slice(2, 12)}`,
      polygon,
      ...(previous?.name ? { name: previous.name } : {}),
      nameConfidence: previous?.nameConfidence ?? 0,
      areaMm2: Math.round(Math.abs(polygonArea(polygon)) * 10) / 10,
    };
  });

  return { ...doc, rooms };
}
