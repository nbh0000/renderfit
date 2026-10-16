import type { FloorPlanDoc, Point } from "@renderfit/plan-schema";
import { centroid, pointInPolygon, recomputeRooms } from "@/scene/planPolygonize";

/**
 * 검수 화면의 편집 도구 — 전부 순수 계산이다.
 *
 * ── 왜 여기 모아 두나 ──
 *
 * 화면 코드 안에서 문서를 조금씩 고치기 시작하면, 벽을 옮기는 규칙이 세 군데로
 * 흩어지고 시험할 수가 없다. 여기 있는 함수는 전부 문서를 받아 **새 문서와 무엇을
 * 고쳤는지**를 돌려준다. 화면은 그것을 상태에 넣기만 한다.
 *
 * ── 무엇을 고쳤는지 남기는 이유 ──
 *
 * 확인할 때 `plan_review_edits` 에 함께 저장한다. 사람이 매번 같은 자리를 고치고
 * 있다면 그건 파서가 거기서 틀린다는 뜻이다. 무엇이 자주 틀리는지 알아야 다음에
 * 무엇을 고칠지 정할 수 있다.
 */

export type PlanEditKind =
  | "wall-move"
  | "wall-add"
  | "wall-delete"
  | "wall-thickness"
  | "room-merge"
  | "room-split"
  | "room-rename"
  | "opening-move"
  | "opening-width"
  | "opening-delete"
  | "fixture-move"
  | "fixture-rotate"
  | "fixture-kind"
  | "fixture-delete"
  | "scale";

export interface PlanEdit {
  kind: PlanEditKind;
  /** 무엇을 고쳤나 — 벽·방·개구부·설비의 id */
  target: string;
  /** 통계로 볼 값. 사람이 읽을 수 있게 담는다 */
  before?: string | number | null;
  after?: string | number | null;
}

export interface EditResult {
  doc: FloorPlanDoc;
  edit: PlanEdit;
}

function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 12)}`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function place(point: Point): string {
  return `${Math.round(point[0])},${Math.round(point[1])}`;
}

/* ───────────────────────── 벽 ───────────────────────── */

/**
 * 벽 끝점을 옮긴다.
 *
 * 같은 자리에 있던 다른 벽의 끝점도 함께 데려간다. 안 그러면 모서리가 벌어져 방이
 * 열리고, 사용자는 벽 하나를 옮겼는데 방이 통째로 사라지는 것을 본다.
 */
export function moveWallEnd(
  doc: FloorPlanDoc,
  wallId: string,
  end: "a" | "b",
  to: Point,
  /** 이 안에 있던 끝점은 붙어 있던 것으로 본다 (mm) */
  weld = 30
): EditResult {
  const wall = doc.walls.find((item) => item.id === wallId);
  if (!wall) return { doc, edit: { kind: "wall-move", target: wallId } };

  const from = wall[end];
  const near = (point: Point) =>
    Math.abs(point[0] - from[0]) <= weld && Math.abs(point[1] - from[1]) <= weld;

  const walls = doc.walls.map((item) => ({
    ...item,
    a: item.id === wallId ? (end === "a" ? to : item.a) : near(item.a) ? to : item.a,
    b: item.id === wallId ? (end === "b" ? to : item.b) : near(item.b) ? to : item.b,
  }));

  return {
    doc: recomputeRooms({ ...doc, walls }),
    edit: { kind: "wall-move", target: wallId, before: place(from), after: place(to) },
  };
}

export function addWall(doc: FloorPlanDoc, a: Point, b: Point, thickness = 100): EditResult {
  const id = newId("wall");
  const walls = [
    ...doc.walls,
    /* 사람이 그린 벽이므로 확실하다. 낮게 잡으면 자기가 그린 것을 다시 검수해야 한다 */
    { id, a, b, thickness, confidence: 1 },
  ];

  return {
    doc: recomputeRooms({ ...doc, walls }),
    edit: { kind: "wall-add", target: id, after: `${place(a)} → ${place(b)}` },
  };
}

/** 벽을 지운다. 그 벽에 달려 있던 문·창도 함께 사라진다 — 붙을 곳이 없다 */
export function deleteWall(doc: FloorPlanDoc, wallId: string): EditResult {
  const wall = doc.walls.find((item) => item.id === wallId);

  return {
    doc: recomputeRooms({
      ...doc,
      walls: doc.walls.filter((item) => item.id !== wallId),
      openings: doc.openings.filter((item) => item.wallId !== wallId),
    }),
    edit: {
      kind: "wall-delete",
      target: wallId,
      before: wall ? `${place(wall.a)} → ${place(wall.b)}` : null,
    },
  };
}

export function setWallThickness(doc: FloorPlanDoc, wallId: string, thickness: number): EditResult {
  const wall = doc.walls.find((item) => item.id === wallId);

  return {
    doc: {
      ...doc,
      walls: doc.walls.map((item) =>
        item.id === wallId ? { ...item, thickness: Math.max(10, round(thickness)) } : item
      ),
    },
    edit: {
      kind: "wall-thickness",
      target: wallId,
      before: wall?.thickness ?? null,
      after: round(thickness),
    },
  };
}

/* ───────────────────────── 방 ───────────────────────── */

export function renameRoom(doc: FloorPlanDoc, roomId: string, name: string): EditResult {
  const room = doc.rooms.find((item) => item.id === roomId);
  const trimmed = name.trim();

  return {
    doc: {
      ...doc,
      rooms: doc.rooms.map((item) =>
        item.id === roomId
          ? {
              ...item,
              ...(trimmed ? { name: trimmed } : {}),
              /* 사람이 직접 적었으므로 더 물어볼 것이 없다 */
              nameConfidence: trimmed ? 1 : 0,
            }
          : item
      ),
    },
    edit: { kind: "room-rename", target: roomId, before: room?.name ?? null, after: trimmed },
  };
}

/** 벽 하나가 두 방 사이에 서 있는가 */
function separates(
  wall: { a: Point; b: Point },
  one: readonly Point[],
  two: readonly Point[],
  probe = 60
): boolean {
  const middle: Point = [(wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2];

  const dx = wall.b[0] - wall.a[0];
  const dy = wall.b[1] - wall.a[1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return false;

  /* 벽 한가운데에서 양옆으로 조금 나가 본다 */
  const left: Point = [middle[0] - (dy / length) * probe, middle[1] + (dx / length) * probe];
  const right: Point = [middle[0] + (dy / length) * probe, middle[1] - (dx / length) * probe];

  return (
    (pointInPolygon(left, one) && pointInPolygon(right, two)) ||
    (pointInPolygon(right, one) && pointInPolygon(left, two))
  );
}

/**
 * 방 둘을 합친다 — **사이에 선 벽을 지우는 일**이다.
 *
 * 폴리곤을 합쳐서 새 방을 만드는 것이 아니다. 그렇게 하면 방은 합쳐졌는데 벽은 그대로
 * 남아 3D 에서 없어야 할 칸막이가 서 있다. 벽을 지우고 방을 다시 만들면 둘이 맞는다.
 */
export function mergeRooms(doc: FloorPlanDoc, oneId: string, twoId: string): EditResult {
  const one = doc.rooms.find((item) => item.id === oneId);
  const two = doc.rooms.find((item) => item.id === twoId);
  if (!one || !two) return { doc, edit: { kind: "room-merge", target: oneId } };

  const between = doc.walls.filter((wall) => separates(wall, one.polygon, two.polygon));
  if (between.length === 0) {
    /* 맞닿아 있지 않으면 합칠 수 없다. 조용히 아무 일도 없던 것으로 둔다 */
    return { doc, edit: { kind: "room-merge", target: oneId, after: null } };
  }

  const removed = new Set(between.map((wall) => wall.id));

  return {
    doc: recomputeRooms({
      ...doc,
      walls: doc.walls.filter((wall) => !removed.has(wall.id)),
      openings: doc.openings.filter((opening) => !removed.has(opening.wallId)),
      /* 이름은 첫 번째 방 것을 남긴다 — 둘 중 하나는 골라야 한다 */
      rooms: doc.rooms.filter((room) => room.id !== twoId),
    }),
    edit: {
      kind: "room-merge",
      target: oneId,
      before: two.name ?? twoId,
      after: `벽 ${between.length}개 삭제`,
    },
  };
}

/** 선분에서 폴리곤 **안쪽** 부분만 남긴다 */
function clipToPolygon(a: Point, b: Point, ring: readonly Point[]): [Point, Point] | null {
  const cuts: number[] = [0, 1];

  for (let index = 0; index < ring.length; index += 1) {
    const c = ring[index];
    const d = ring[(index + 1) % ring.length];

    const rx = b[0] - a[0];
    const ry = b[1] - a[1];
    const sx = d[0] - c[0];
    const sy = d[1] - c[1];

    const denominator = rx * sy - ry * sx;
    if (Math.abs(denominator) < 1e-9) continue;

    const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denominator;
    const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denominator;

    if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
  }

  cuts.sort((one, two) => one - two);

  const at = (t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

  /* 토막마다 가운데가 방 안인지 보고, 안쪽 토막들을 이어 붙인다 */
  let start: number | null = null;
  let end: number | null = null;

  for (let index = 0; index + 1 < cuts.length; index += 1) {
    const middle = at((cuts[index] + cuts[index + 1]) / 2);
    if (!pointInPolygon(middle, ring)) continue;

    if (start === null) start = cuts[index];
    end = cuts[index + 1];
  }

  if (start === null || end === null) return null;
  return [at(start), at(end)];
}

/**
 * 방을 선 하나로 나눈다.
 *
 * 그은 선을 방 안쪽만 남기고 잘라서 벽으로 세운다. 자르지 않으면 선이 바깥 벽을 넘어
 * 나가 도면 밖에 쓸데없는 조각 방이 생긴다.
 */
export function splitRoom(
  doc: FloorPlanDoc,
  roomId: string,
  a: Point,
  b: Point,
  thickness = 100
): EditResult {
  const room = doc.rooms.find((item) => item.id === roomId);
  if (!room) return { doc, edit: { kind: "room-split", target: roomId } };

  const inside = clipToPolygon(a, b, room.polygon);
  if (!inside) return { doc, edit: { kind: "room-split", target: roomId, after: null } };

  const id = newId("wall");
  const doc2 = recomputeRooms({
    ...doc,
    walls: [...doc.walls, { id, a: inside[0], b: inside[1], thickness, confidence: 1 }],
  });

  return {
    doc: doc2,
    edit: {
      kind: "room-split",
      target: roomId,
      before: room.name ?? roomId,
      after: `${place(inside[0])} → ${place(inside[1])}`,
    },
  };
}

/* ───────────────────────── 문·창 ───────────────────────── */

/** 문·창을 벽을 따라 민다. 벽 밖으로는 나가지 않는다 */
export function moveOpening(doc: FloorPlanDoc, openingId: string, offset: number): EditResult {
  const opening = doc.openings.find((item) => item.id === openingId);
  if (!opening) return { doc, edit: { kind: "opening-move", target: openingId } };

  const wall = doc.walls.find((item) => item.id === opening.wallId);
  const length = wall ? Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) : Infinity;
  const limited = Math.max(0, Math.min(offset, length - opening.width));

  return {
    doc: {
      ...doc,
      openings: doc.openings.map((item) =>
        item.id === openingId ? { ...item, offset: round(limited), confidence: 1 } : item
      ),
    },
    edit: {
      kind: "opening-move",
      target: openingId,
      before: opening.offset,
      after: round(limited),
    },
  };
}

export function setOpeningWidth(doc: FloorPlanDoc, openingId: string, width: number): EditResult {
  const opening = doc.openings.find((item) => item.id === openingId);
  if (!opening) return { doc, edit: { kind: "opening-width", target: openingId } };

  const wall = doc.walls.find((item) => item.id === opening.wallId);
  const length = wall ? Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]) : Infinity;
  const limited = Math.max(100, Math.min(width, length - opening.offset));

  return {
    doc: {
      ...doc,
      openings: doc.openings.map((item) =>
        item.id === openingId ? { ...item, width: round(limited), confidence: 1 } : item
      ),
    },
    edit: {
      kind: "opening-width",
      target: openingId,
      before: opening.width,
      after: round(limited),
    },
  };
}

export function deleteOpening(doc: FloorPlanDoc, openingId: string): EditResult {
  const opening = doc.openings.find((item) => item.id === openingId);

  return {
    doc: { ...doc, openings: doc.openings.filter((item) => item.id !== openingId) },
    edit: { kind: "opening-delete", target: openingId, before: opening?.kind ?? null },
  };
}

/* ───────────────────────── 설비 ───────────────────────── */

export function moveFixture(doc: FloorPlanDoc, fixtureId: string, to: Point): EditResult {
  const fixture = doc.fixtures.find((item) => item.id === fixtureId);
  if (!fixture) return { doc, edit: { kind: "fixture-move", target: fixtureId } };

  return {
    doc: {
      ...doc,
      fixtures: doc.fixtures.map((item) =>
        item.id === fixtureId
          ? {
              ...item,
              bbox: [round(to[0]), round(to[1]), item.bbox[2], item.bbox[3]],
              /* 사람이 놓은 자리다 */
              source: "user",
              confidence: 1,
            }
          : item
      ),
    },
    edit: {
      kind: "fixture-move",
      target: fixtureId,
      before: place([fixture.bbox[0], fixture.bbox[1]]),
      after: place(to),
    },
  };
}

export function rotateFixture(doc: FloorPlanDoc, fixtureId: string, rotation: number): EditResult {
  const fixture = doc.fixtures.find((item) => item.id === fixtureId);
  const normalized = ((rotation % 360) + 360) % 360;

  return {
    doc: {
      ...doc,
      fixtures: doc.fixtures.map((item) =>
        item.id === fixtureId
          ? { ...item, rotation: normalized, source: "user", confidence: 1 }
          : item
      ),
    },
    edit: {
      kind: "fixture-rotate",
      target: fixtureId,
      before: fixture?.rotation ?? null,
      after: normalized,
    },
  };
}

export function setFixtureKind(
  doc: FloorPlanDoc,
  fixtureId: string,
  kind: string,
  label?: string
): EditResult {
  const fixture = doc.fixtures.find((item) => item.id === fixtureId);

  return {
    doc: {
      ...doc,
      fixtures: doc.fixtures.map((item) =>
        item.id === fixtureId
          ? {
              ...item,
              kind,
              ...(label ? { label } : {}),
              source: "user",
              confidence: 1,
            }
          : item
      ),
    },
    edit: {
      kind: "fixture-kind",
      target: fixtureId,
      before: fixture?.kind ?? null,
      after: kind,
    },
  };
}

export function deleteFixture(doc: FloorPlanDoc, fixtureId: string): EditResult {
  const fixture = doc.fixtures.find((item) => item.id === fixtureId);

  return {
    doc: { ...doc, fixtures: doc.fixtures.filter((item) => item.id !== fixtureId) },
    edit: { kind: "fixture-delete", target: fixtureId, before: fixture?.kind ?? null },
  };
}

/* ───────────────────────── 축척 ───────────────────────── */

/**
 * 축척을 다시 잡는다 — 두 점을 찍고 그 사이가 실제로 몇 mm 인지 적는다.
 *
 * 래스터 도면에서 치수 글자를 못 읽었거나 잘못 읽었을 때 마지막으로 기대는 길이다.
 * 배율이 틀리면 3m 짜리 방이 30m 가 되는데, 그 사실은 도면을 아는 사람만 안다.
 * 그래서 자동으로 고치지 않고 사람이 재서 넣게 한다.
 *
 * 문서 전체가 같은 비율로 늘어난다 — 좌표·두께·개구부·설비·면적까지. 한 군데라도
 * 빠뜨리면 벽은 커졌는데 문은 그대로인 도면이 된다.
 */
export function rescale(doc: FloorPlanDoc, a: Point, b: Point, realMm: number): EditResult {
  const measured = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (measured < 1e-6 || realMm <= 0) return { doc, edit: { kind: "scale", target: "scale" } };

  const factor = realMm / measured;
  const point = (value: Point): Point => [round(value[0] * factor), round(value[1] * factor)];

  return {
    doc: {
      ...doc,
      scale: {
        mmPerUnit: doc.scale.mmPerUnit * factor,
        /* 사람이 재서 넣은 값이라 더 이상 의심할 것이 없다 */
        confidence: 1,
        source: "user",
      },
      bounds: { w: round(doc.bounds.w * factor), h: round(doc.bounds.h * factor) },
      walls: doc.walls.map((wall) => ({
        ...wall,
        a: point(wall.a),
        b: point(wall.b),
        thickness: round(wall.thickness * factor),
      })),
      openings: doc.openings.map((opening) => ({
        ...opening,
        offset: round(opening.offset * factor),
        width: round(opening.width * factor),
      })),
      rooms: doc.rooms.map((room) => ({
        ...room,
        polygon: room.polygon.map(point),
        /* 넓이는 길이의 제곱으로 늘어난다 */
        areaMm2: round(room.areaMm2 * factor * factor),
      })),
      fixtures: doc.fixtures.map((fixture) => ({
        ...fixture,
        bbox: [
          round(fixture.bbox[0] * factor),
          round(fixture.bbox[1] * factor),
          round(fixture.bbox[2] * factor),
          round(fixture.bbox[3] * factor),
        ],
      })),
      annotations: doc.annotations.map((annotation) => ({
        ...annotation,
        position: point(annotation.position),
      })),
      /* 겹쳐 놓은 그림도 같이 늘어나야 자리가 맞는다 */
      ...(doc.underlay
        ? { underlay: { ...doc.underlay, mmPerPixel: doc.underlay.mmPerPixel * factor } }
        : {}),
    },
    edit: {
      kind: "scale",
      target: "scale",
      before: round(measured),
      after: round(realMm),
    },
  };
}

/* ───────────────────────── 검수 상태 ───────────────────────── */

/** 지적 하나를 어떻게 했나 */
export type FlagVerdict = "resolved" | "ignored";

/**
 * 확인 버튼을 눌러도 되는가.
 *
 * **모든 지적을 해결하거나 무시해야** 넘어간다. 남은 것이 있는 채로 확정하면 그
 * 문서는 "사람이 봤다" 는 뜻이 아니게 되고, 그러면 검수 단계를 둔 이유가 없다.
 */
export function readyToConfirm(
  doc: FloorPlanDoc,
  verdicts: Record<string, FlagVerdict | undefined>
): boolean {
  return doc.review.flags.every((_, index) => Boolean(verdicts[String(index)]));
}

/** 지적이 가리키는 자리 (mm). 목록에서 누르면 그리로 간다 */
export function flagPosition(doc: FloorPlanDoc, target: string): Point | null {
  const wall = doc.walls.find((item) => item.id === target);
  if (wall) return [(wall.a[0] + wall.b[0]) / 2, (wall.a[1] + wall.b[1]) / 2];

  const room = doc.rooms.find((item) => item.id === target);
  if (room && room.polygon.length >= 3) return centroid(room.polygon);

  const fixture = doc.fixtures.find((item) => item.id === target);
  if (fixture) {
    return [fixture.bbox[0] + fixture.bbox[2] / 2, fixture.bbox[1] + fixture.bbox[3] / 2];
  }

  const opening = doc.openings.find((item) => item.id === target);
  if (opening) {
    const host = doc.walls.find((item) => item.id === opening.wallId);
    if (!host) return null;

    const length = Math.hypot(host.b[0] - host.a[0], host.b[1] - host.a[1]);
    if (length < 1e-6) return host.a;

    const t = (opening.offset + opening.width / 2) / length;
    return [
      host.a[0] + (host.b[0] - host.a[0]) * t,
      host.a[1] + (host.b[1] - host.a[1]) * t,
    ];
  }

  return null;
}
