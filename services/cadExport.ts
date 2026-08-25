import { symbolFor } from "@/services/planSymbols";
import { footprintPath } from "@/scene/footprint";
import type {
  Annotation,
  RoomArea,
  ElectricalFixture,
  Scene,
  SceneObject,
  WallOpening,
  WallSegment,
} from "@/scene/types";
import { electricalSpec } from "@/config/electrical";
import { OBJECT_GROUP_OF } from "@/scene/types";
import {
  ensureRoom,
  pointAlongWall,
  polygonArea,
  polygonCentroid,
  toSquareMeters,
  wallAngle,
  wallDirection,
  wallLength,
} from "@/scene/geometry";
import { openingObjectIds } from "@/scene/openings";
import { planCenter } from "@/scene/placement";
import { ROOM_MAP, type RoomId } from "@/config/rooms";

/**
 * CAD 산출물 생성.
 *
 * Scene의 객체 배치를 실제 도면 좌표(mm, 1:1)로 변환해 DXF와 치수 평면도(SVG)를 만든다.
 * AutoCAD·SketchUp·Rhino 등에서 그대로 열 수 있는 텍스트 포맷만 사용한다.
 *
 * ⚠ 치수 주의
 *  방 크기와 가구 배치는 AI 추정값이다. 실측 도면이 아니며 시공 전 검증이 필요하다.
 *  이 고지는 도면 자체(타이틀블록)에도 항상 인쇄된다.
 */

export const CAD_DISCLAIMER =
  "AI 추정 배치 도면 — 실측값이 아니며 시공 전 현장 실측으로 검증해야 합니다.";

export const CAD_MEASURED_NOTE = "사용자 입력 실측 치수 기준 도면 — 시공 전 최종 확인 필요.";

export function disclaimerFor(measured: boolean): string {
  return measured ? CAD_MEASURED_NOTE : CAD_DISCLAIMER;
}

/** 벽 두께 (mm) — 국내 공동주택 내벽 기준값 */
const WALL_THICKNESS = 150;

export interface PlanObject {
  id: string;
  name: string;
  /** 기호를 고르는 데 쓴다 — 같은 사각형이라도 침대와 변기는 다르게 그린다 */
  type: SceneObject["type"];
  layer: string;
  /** 도면 좌표계(mm), 사각형 중심 */
  cx: number;
  cy: number;
  width: number;
  depth: number;
  /** degree, 반시계 */
  rotation: number;
  /**
   * 도면에 그려진 실제 모양 (-0.5~0.5 자기 좌표계).
   * 네모면 없다 — scene/footprint.ts 참고.
   */
  footprint?: [number, number][] | null;
}

export interface PlanData {
  projectName: string;
  roomType: string;
  walls: WallSegment[];
  measured: boolean;
  /** mm */
  roomWidth: number;
  roomLength: number;
  roomHeight: number;
  objects: PlanObject[];
  /** 전기·통신 설비 (도면 E-* 레이어) */
  electrical: ElectricalFixture[];
  /** 사용자가 도면 위에 얹은 치수선·텍스트·폴리라인 */
  annotations: Annotation[];
  /** 실(방) 영역 — 실명과 면적을 도면에 적는다 */
  areas: RoomArea[];
  /** 바닥·벽·천장 마감 — 마감재 일람표에 적는다 */
  finishes: { floor: string | null; wall: string | null; ceiling: string | null };
  /** 재질 id → 사람이 읽는 이름 (실별 바닥 마감을 풀어 쓰는 데 쓴다) */
  materialNames: Record<string, string>;
  createdAt: string;
}

const LAYER_BY_GROUP: Record<string, string> = {
  room: "A-WALL",
  furniture: "I-FURN",
  lighting: "E-LITE",
  decoration: "I-DECO",
  appliance: "I-APPL",
};

/** Scene 좌표(정규화) → 도면 좌표(mm). 원점은 방의 좌측 하단. */
export function toPlanData(scene: Scene, projectName: string): PlanData {
  const room = ensureRoom(scene.room);
  const roomWidth = room.dimensions.width;
  const roomLength = room.dimensions.length;

  // 이미 벽 개구부로 옮겨진 창·문은 가구로 다시 그리지 않는다.
  const convertedIds = openingObjectIds(room);

  const objects: PlanObject[] = scene.objects
    .filter((object) => object.visibility)
    .filter(
      (object) => object.type !== "wall" && object.type !== "ceiling" && object.type !== "floor"
    )
    .filter((object) => !convertedIds.has(object.id))
    .map((object: SceneObject) => {
      // screen.x(0~1) → 방 가로 위치, depth(0~1, 클수록 안쪽) → 방 세로 위치
      const { cx, cy } = planCenter(object.screen, object.depth, room);

      return {
        id: object.id,
        name: object.name,
        type: object.type,
        layer: LAYER_BY_GROUP[OBJECT_GROUP_OF[object.type] ?? "furniture"] ?? "I-FURN",
        cx: clamp(cx, 0, roomWidth),
        cy: clamp(cy, 0, roomLength),
        width: object.dimensions.width * object.transform.scale[0],
        depth: object.dimensions.depth * object.transform.scale[2],
        rotation: object.screen.rotation,
        footprint: object.footprint ?? null,
      };
    });

  return {
    projectName,
    // 도면에는 사람이 읽는 이름을 적는다 — 분석기가 준 id("bedroom")가 그대로 찍히면 안 된다.
    roomType: ROOM_MAP[room.type as RoomId]?.label ?? room.type,
    walls: room.walls ?? [],
    measured: Boolean(room.measured),
    finishes: {
      floor: room.finishes?.floor ?? null,
      wall: room.finishes?.wall ?? null,
      ceiling: room.finishes?.ceiling ?? null,
    },
    materialNames: Object.fromEntries(
      (scene.materials ?? []).map((material) => [material.id, material.name])
    ),
    roomWidth,
    roomLength,
    roomHeight: room.dimensions.height,
    objects,
    electrical: room.electrical ?? [],
    annotations: room.annotations ?? [],
    areas: room.areas ?? [],
    createdAt: new Date().toISOString(),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 회전된 사각형의 네 꼭짓점 */
function rectCorners(object: PlanObject): [number, number][] {
  const rad = (object.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = object.width / 2;
  const hd = object.depth / 2;

  return (
    [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ] as [number, number][]
  ).map(([x, y]) => [object.cx + x * cos - y * sin, object.cy + x * sin + y * cos]);
}

/* ────────────────────────────── DXF ────────────────────────────── */

class DxfWriter {
  private lines: string[] = [];

  private tag(code: number, value: string | number) {
    this.lines.push(String(code), String(value));
  }

  section(name: string) {
    this.tag(0, "SECTION");
    this.tag(2, name);
  }

  endSection() {
    this.tag(0, "ENDSEC");
  }

  /** AutoCAD R12(AC1009) 헤더 — 단위를 mm로 선언한다 */
  header() {
    this.section("HEADER");
    this.tag(9, "$ACADVER");
    this.tag(1, "AC1009");
    this.tag(9, "$INSUNITS");
    this.tag(70, 4);
    this.endSection();
  }

  layerTable(layers: { name: string; color: number }[]) {
    this.section("TABLES");
    this.tag(0, "TABLE");
    this.tag(2, "LAYER");
    this.tag(70, layers.length);
    for (const layer of layers) {
      this.tag(0, "LAYER");
      this.tag(2, layer.name);
      this.tag(70, 0);
      this.tag(62, layer.color);
      this.tag(6, "CONTINUOUS");
    }
    this.tag(0, "ENDTAB");
    this.endSection();
  }

  line(x1: number, y1: number, x2: number, y2: number, layer: string) {
    this.tag(0, "LINE");
    this.tag(8, layer);
    this.tag(10, round(x1));
    this.tag(20, round(y1));
    this.tag(30, 0);
    this.tag(11, round(x2));
    this.tag(21, round(y2));
    this.tag(31, 0);
  }

  polygon(points: [number, number][], layer: string) {
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i];
      const [x2, y2] = points[(i + 1) % points.length];
      this.line(x1, y1, x2, y2, layer);
    }
  }

  /** 전기 기호용 원 (R12 CIRCLE 엔티티) */
  circle(x: number, y: number, radius: number, layer: string) {
    this.tag(0, "CIRCLE");
    this.tag(8, layer);
    this.tag(10, round(x));
    this.tag(20, round(y));
    this.tag(30, 0);
    this.tag(40, round(radius));
  }

  text(x: number, y: number, height: number, value: string, layer: string, rotation = 0) {
    this.tag(0, "TEXT");
    this.tag(8, layer);
    this.tag(10, round(x));
    this.tag(20, round(y));
    this.tag(30, 0);
    this.tag(40, round(height));
    this.tag(1, value);
    if (rotation) this.tag(50, round(rotation));
  }

  build(): string {
    this.tag(0, "EOF");
    return this.lines.join("\r\n");
  }
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** 치수선 (화살표 대신 사선 틱 — R12 호환) */
function dimension(
  dxf: DxfWriter,
  from: [number, number],
  to: [number, number],
  offset: number,
  label: string
) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const horizontal = Math.abs(y2 - y1) < 1;

  if (horizontal) {
    const y = y1 - offset;
    dxf.line(x1, y, x2, y, "A-DIMS");
    dxf.line(x1, y1, x1, y - 60, "A-DIMS");
    dxf.line(x2, y2, x2, y - 60, "A-DIMS");
    dxf.line(x1 - 40, y - 40, x1 + 40, y + 40, "A-DIMS");
    dxf.line(x2 - 40, y - 40, x2 + 40, y + 40, "A-DIMS");
    dxf.text((x1 + x2) / 2 - label.length * 30, y + 40, 90, label, "A-DIMS");
  } else {
    const x = x1 - offset;
    dxf.line(x, y1, x, y2, "A-DIMS");
    dxf.line(x1, y1, x - 60, y1, "A-DIMS");
    dxf.line(x2, y2, x - 60, y2, "A-DIMS");
    dxf.line(x - 40, y1 - 40, x + 40, y1 + 40, "A-DIMS");
    dxf.line(x - 40, y2 - 40, x + 40, y2 + 40, "A-DIMS");
    dxf.text(x - 120, (y1 + y2) / 2 - label.length * 30, 90, label, "A-DIMS", 90);
  }
}

/**
 * 벽 하나를 도면에 그린다.
 *
 * 벽 중심선을 기준으로 두께만큼 양쪽에 선을 긋고, 개구부 구간에서는 선을 끊는다.
 * 문은 열림 방향 호(arc를 선분으로 근사)로, 창은 중앙 유리선으로 표기한다.
 */
function drawWallDxf(dxf: DxfWriter, wall: WallSegment) {
  const [dx, dy] = wallDirection(wall);
  const [nx, ny] = [-dy, dx]; // 법선
  const half = wall.thickness / 2;
  const length = wallLength(wall);

  const openings = [...(wall.openings ?? [])].sort((a, b) => a.offset - b.offset);

  /** 벽 중심선 좌표 → 양쪽 면 좌표 */
  const face = (distance: number, side: 1 | -1): [number, number] => {
    const [px, py] = pointAlongWall(wall, distance);
    return [px + nx * half * side, py + ny * half * side];
  };

  // 개구부로 끊긴 구간별 면 선
  let cursor = 0;
  const spans: [number, number][] = [];
  for (const opening of openings) {
    const start = Math.max(0, Math.min(length, opening.offset));
    if (start > cursor) spans.push([cursor, start]);
    cursor = Math.max(cursor, Math.min(length, opening.offset + opening.width));
  }
  if (cursor < length) spans.push([cursor, length]);

  for (const [from, to] of spans) {
    for (const side of [1, -1] as const) {
      const [x1, y1] = face(from, side);
      const [x2, y2] = face(to, side);
      dxf.line(x1, y1, x2, y2, "A-WALL");
    }
    // 마구리(끝면)
    const [ax, ay] = face(from, 1);
    const [bx, by] = face(from, -1);
    dxf.line(ax, ay, bx, by, "A-WALL");
    const [cx2, cy2] = face(to, 1);
    const [dx2, dy2] = face(to, -1);
    dxf.line(cx2, cy2, dx2, dy2, "A-WALL");
  }

  // 개구부 기호
  for (const opening of openings) {
    drawOpeningDxf(dxf, wall, opening, face);
  }
}

function drawOpeningDxf(
  dxf: DxfWriter,
  wall: WallSegment,
  opening: WallOpening,
  face: (distance: number, side: 1 | -1) => [number, number]
) {
  const layer = opening.type === "door" ? "A-DOOR" : "A-GLAZ";
  const start = opening.offset;
  const end = opening.offset + opening.width;

  if (opening.type === "window") {
    // 창: 개구부 폭만큼 유리선 3줄
    for (const side of [1, -1] as const) {
      const [x1, y1] = face(start, side);
      const [x2, y2] = face(end, side);
      dxf.line(x1, y1, x2, y2, layer);
    }
    const [mx1, my1] = pointAlongWall(wall, start);
    const [mx2, my2] = pointAlongWall(wall, end);
    dxf.line(mx1, my1, mx2, my2, layer);
  } else {
    // 문: 문틀 + 열림 호(선분 근사) + 문짝
    const [hx, hy] = face(start, 1);
    const [hx2, hy2] = face(start, -1);
    dxf.line(hx, hy, hx2, hy2, layer);

    const [tx, ty] = face(end, 1);
    const [tx2, ty2] = face(end, -1);
    dxf.line(tx, ty, tx2, ty2, layer);

    const [px, py] = pointAlongWall(wall, start);
    const [ex, ey] = pointAlongWall(wall, end);
    dxf.line(px, py, ex, ey, layer);

    // 90도 열림 호를 8분할 선분으로
    const [dirX, dirY] = wallDirection(wall);
    const [nx, ny] = [-dirY, dirX];
    const radius = opening.width;
    let prev: [number, number] = [ex, ey];
    for (let step = 1; step <= 8; step++) {
      const angle = (Math.PI / 2) * (step / 8);
      const point: [number, number] = [
        px + dirX * radius * Math.cos(angle) + nx * radius * Math.sin(angle),
        py + dirY * radius * Math.cos(angle) + ny * radius * Math.sin(angle),
      ];
      dxf.line(prev[0], prev[1], point[0], point[1], layer);
      prev = point;
    }
    dxf.line(px, py, prev[0], prev[1], layer);
  }

  // 개구부 치수 표기 (W×H, 창은 하부 높이도)
  const [lx, ly] = pointAlongWall(wall, start + opening.width / 2);
  const label =
    opening.type === "window"
      ? `${opening.name} ${Math.round(opening.width)}x${Math.round(opening.height)} (SH ${Math.round(opening.sillHeight)})`
      : `${opening.name} ${Math.round(opening.width)}x${Math.round(opening.height)}`;
  dxf.text(lx - label.length * 28, ly + 120, 70, label, "A-NOTE", wallAngle(wall));
}

/**
 * DXF 평면도 생성 (R12 호환, 단위 mm, 1:1).
 * 레이어: A-WALL / A-DIMS / I-FURN / I-APPL / I-DECO / E-LITE / A-NOTE
 */
export function buildDxf(plan: PlanData): string {
  const dxf = new DxfWriter();
  const { roomWidth: W, roomLength: L } = plan;
  const t = WALL_THICKNESS;

  dxf.header();
  dxf.layerTable([
    { name: "A-WALL", color: 7 },
    { name: "A-DIMS", color: 3 },
    { name: "A-NOTE", color: 2 },
    { name: "I-FURN", color: 5 },
    { name: "I-APPL", color: 4 },
    { name: "I-DECO", color: 6 },
    { name: "E-LITE", color: 1 },
    { name: "A-DOOR", color: 30 },
    { name: "A-GLAZ", color: 4 },
    { name: "E-POWR", color: 5 },
    { name: "E-COMM", color: 3 },
    { name: "A-ANNO", color: 2 },
    { name: "A-AREA", color: 8 },
  ]);

  dxf.section("ENTITIES");

  // 벽체 — 각 벽을 두께만큼 이중선으로 그리고, 개구부 자리는 비운다
  for (const wall of plan.walls) {
    drawWallDxf(dxf, wall);
  }

  // 벽 데이터가 없으면(예전 저장본) 외곽만 그린다
  if (plan.walls.length === 0) {
    dxf.polygon(
      [
        [0, 0],
        [W, 0],
        [W, L],
        [0, L],
      ],
      "A-WALL"
    );
    dxf.polygon(
      [
        [-t, -t],
        [W + t, -t],
        [W + t, L + t],
        [-t, L + t],
      ],
      "A-WALL"
    );
  }

  /*
   * 전기·통신 설비.
   * 기호 원 + 종류 문자 + 설치 높이를 함께 찍는다 — 도면만 보고 시공할 수 있어야 한다.
   */
  for (const fixture of plan.electrical) {
    const spec = electricalSpec(fixture.kind);
    const [x, y] = electricalPoint(plan, fixture);
    dxf.circle(x, y, 110, spec.layer);
    dxf.text(x - 60, y - 45, 90, spec.symbol, spec.layer);
    dxf.text(x - 120, y - 260, 75, `H${Math.round(fixture.height)}`, spec.layer);
    if (fixture.note) dxf.text(x - 120, y - 400, 70, fixture.note, "A-NOTE");
  }

  // 실(방) 경계와 실명·면적
  for (const area of plan.areas) {
    dxf.polygon(area.points, "A-AREA");
    const [cx, cy] = polygonCentroid(area.points);
    dxf.text(cx - area.name.length * 70, cy, 150, area.name, "A-AREA");
    if (area.showArea !== false) {
      const squareMeters = toSquareMeters(polygonArea(area.points));
      dxf.text(cx - 300, cy - 220, 105, `${squareMeters.toFixed(1)}m2`, "A-AREA");
    }
  }

  // 사용자 주석
  for (const annotation of plan.annotations) {
    if (annotation.type === "text") {
      const [x, y] = annotation.points[0];
      dxf.text(x, y, annotation.fontSize ?? 110, annotation.text ?? "", "A-ANNO");
      continue;
    }

    for (let i = 0; i < annotation.points.length - 1; i += 1) {
      const [x1, y1] = annotation.points[i];
      const [x2, y2] = annotation.points[i + 1];
      dxf.line(x1, y1, x2, y2, "A-ANNO");
    }

    if (annotation.type === "dimension") {
      const [a, b] = annotation.points;
      const length = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]));
      dxf.text(
        (a[0] + b[0]) / 2,
        (a[1] + b[1]) / 2 + 60,
        annotation.fontSize ?? 96,
        annotation.text || String(length),
        "A-ANNO"
      );
    }
  }

  // 가구·설비 footprint + 라벨
  for (const object of plan.objects) {
    dxf.polygon(rectCorners(object), object.layer);
    dxf.text(
      object.cx - object.name.length * 45,
      object.cy,
      90,
      object.name,
      "A-NOTE",
      object.rotation
    );
    dxf.text(
      object.cx - 180,
      object.cy - 130,
      70,
      `${Math.round(object.width)}x${Math.round(object.depth)}`,
      "A-NOTE",
      object.rotation
    );
  }

  // 전체 치수
  dimension(dxf, [0, 0], [W, 0], 500, `${Math.round(W)}`);
  dimension(dxf, [0, 0], [0, L], 500, `${Math.round(L)}`);

  // 타이틀블록
  const titleY = -1200;
  dxf.polygon(
    [
      [0, titleY],
      [W, titleY],
      [W, titleY - 900],
      [0, titleY - 900],
    ],
    "A-NOTE"
  );
  dxf.text(120, titleY - 260, 160, plan.projectName, "A-NOTE");
  dxf.text(
    120,
    titleY - 480,
    90,
    `ROOM: ${plan.roomType}  /  ${Math.round(W)} x ${Math.round(L)} x ${Math.round(plan.roomHeight)} mm  /  SCALE 1:1 (mm)  /  ${plan.measured ? "MEASURED" : "AI ESTIMATE"}`,
    "A-NOTE"
  );
  dxf.text(120, titleY - 640, 80, disclaimerFor(plan.measured), "A-NOTE");
  dxf.text(120, titleY - 800, 70, `DATE ${plan.createdAt.slice(0, 10)}`, "A-NOTE");

  dxf.endSection();
  return dxf.build();
}

/* ─────────────────────── 치수 평면도 (SVG) ─────────────────────── */

/** 인쇄용 평면도. 도면과 같은 좌표계를 쓰되 사람이 바로 읽을 수 있게 그린다. */
/**
 * 설비의 평면 좌표(mm).
 * 벽에 붙은 것은 벽을 따라 offset만큼, 벽이 없으면 지정 좌표나 방 중앙을 쓴다.
 */
export function electricalPoint(plan: PlanData, fixture: ElectricalFixture): [number, number] {
  if (fixture.wallId) {
    const wall = plan.walls.find((item) => item.id === fixture.wallId);
    if (wall) return pointAlongWall(wall, fixture.offset);
  }
  if (fixture.point) return fixture.point;
  return [plan.roomWidth / 2, plan.roomLength / 2];
}

/** 문 기호 설명 — 도면 주기에 그대로 찍힌다 */
export function doorNote(opening: WallOpening): string {
  const type = opening.doorType ?? "hinged";
  if (type === "sliding") return "(미닫이)";
  if (type === "folding") return "(접이문)";
  if (type === "opening") return "(개구부)";

  const hinge = opening.hinge === "end" ? "우힌지" : "좌힌지";
  const swing = opening.swing === "out" ? "밖열림" : "안열림";
  return `(${hinge}·${swing})`;
}

/**
 * 평면도의 문 기호.
 *
 * 여닫이는 문짝 선과 90° 스윙 아크로, 미닫이는 벽과 나란한 이동 궤적으로 그린다.
 * 열리는 쪽은 벽 법선을 기준으로 잡는다 — 벽이 방을 반시계로 감싸므로
 * (-dy, dx) 방향이 방 안쪽이다.
 */
function doorSymbol(
  opening: WallOpening,
  sx: number,
  sy: number,
  ex: number,
  ey: number
): string[] {
  const width = opening.width;
  const dx = (ex - sx) / width;
  const dy = (ey - sy) / width;

  const type = opening.doorType ?? "hinged";
  if (type === "opening") return [];

  if (type === "sliding") {
    // 문짝은 벽 옆으로 밀려 들어간다 — 겹침 구간을 점선으로 표시한다.
    const slideX = sx - dx * width;
    const slideY = sy - dy * width;
    return [
      `  <line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="#26231f" stroke-width="26"/>`,
      `  <line x1="${slideX.toFixed(1)}" y1="${slideY.toFixed(1)}" x2="${sx.toFixed(1)}" y2="${sy.toFixed(1)}" stroke="#8a8a8a" stroke-width="14" stroke-dasharray="60 40"/>`,
    ];
  }

  const inward = opening.swing !== "out";
  const nx = (inward ? -dy : dy);
  const ny = (inward ? dx : -dx);

  // 경첩 쪽 끝점에서 문짝이 뻗어 나간다.
  const hingeAtStart = opening.hinge !== "end";
  const hx = hingeAtStart ? sx : ex;
  const hy = hingeAtStart ? sy : ey;
  const fx = hingeAtStart ? ex : sx;
  const fy2 = hingeAtStart ? ey : sy;

  const leafX = hx + nx * width;
  const leafY = hy + ny * width;

  if (type === "folding") {
    // 접이문: 절반 지점에서 꺾이는 두 장으로 표현한다.
    const midX = hx + (nx * width) / 2;
    const midY = hy + (ny * width) / 2;
    const tipX = midX + ((fx - hx) / 2);
    const tipY = midY + ((fy2 - hy) / 2);
    return [
      `  <polyline points="${hx.toFixed(1)},${hy.toFixed(1)} ${midX.toFixed(1)},${midY.toFixed(1)} ${tipX.toFixed(1)},${tipY.toFixed(1)}" fill="none" stroke="#26231f" stroke-width="26"/>`,
    ];
  }

  // 여닫이: 문짝 + 열림 궤적
  const sweep = hingeAtStart === inward ? 0 : 1;
  return [
    `  <line x1="${hx.toFixed(1)}" y1="${hy.toFixed(1)}" x2="${leafX.toFixed(1)}" y2="${leafY.toFixed(1)}" stroke="#26231f" stroke-width="26"/>`,
    `  <path d="M ${fx.toFixed(1)} ${fy2.toFixed(1)} A ${width.toFixed(1)} ${width.toFixed(1)} 0 0 ${sweep} ${leafX.toFixed(1)} ${leafY.toFixed(1)}" fill="none" stroke="#8a8a8a" stroke-width="14" stroke-dasharray="60 40"/>`,
  ];
}

export function buildPlanSvg(plan: PlanData): string {
  // 사방 치수줄(안쪽 420 · 바깥 900)과 글자가 잘리지 않을 만큼 여백을 둔다.
  const margin = 1500;
  const W = plan.roomWidth;
  const L = plan.roomLength;

  /*
   * 도면 아래에 일람표 두 개와 타이틀블록이 차례로 온다.
   *
   * 예전에는 이 자리를 고정값으로 잡아 두어서, 개구부가 많으면 창호일람표가 타이틀블록을
   * 뚫고 나가고 마감재 일람표는 그림 밖으로 잘려 나갔다. 표가 몇 줄인지는 도면마다
   * 다르므로 높이를 세어서 자리를 잡는다.
   */
  const TABLE_TOP = L + 1000;
  const ROW_H = 190;
  const openingRows = plan.walls.reduce((sum, wall) => sum + (wall.openings?.length ?? 0), 0);
  const finishCount = plan.areas.length || 1;
  const tableHeight = ROW_H * (Math.max(openingRows, finishCount) + 2);
  const titleTop = TABLE_TOP + tableHeight + 400;

  /** 마감재 일람표를 창호일람표 오른쪽에 둔다 */
  const FINISH_LEFT = 10000;
  const FINISH_WIDTH = 9800;

  const vbW = Math.max(W, FINISH_LEFT + FINISH_WIDTH) + margin * 2;
  const vbH = titleTop + 700 + margin;

  const esc = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // SVG는 y축이 아래로 증가하므로 방 좌표를 뒤집어 그린다.
  const fy = (y: number) => L - y;

  /*
   * 개구부 부호와 일람표.
   *
   * 도면 위에는 D1·W1 만 적고, 종류·크기·여닫이 방향은 아래 표로 뺀다.
   * 창호일람표는 실제 도면에 늘 붙는 것이고, 시공자가 발주할 때 이 표를 본다.
   */
  const schedule: { tag: string; opening: WallOpening }[] = [];
  let doorNo = 0;
  let windowNo = 0;

  // 벽체: 개구부로 끊긴 구간만 그리고, 문·창은 부호로 표기한다
  const wallsSvg = plan.walls.length
    ? plan.walls
        .map((wall) => {
          const length = wallLength(wall);
          const openings = [...(wall.openings ?? [])].sort((a, b) => a.offset - b.offset);
          const pieces: string[] = [];

          let cursor = 0;
          const spans: [number, number][] = [];
          for (const opening of openings) {
            const start = Math.max(0, Math.min(length, opening.offset));
            if (start > cursor) spans.push([cursor, start]);
            cursor = Math.max(cursor, Math.min(length, opening.offset + opening.width));
          }
          if (cursor < length) spans.push([cursor, length]);

          for (const [from, to] of spans) {
            const [x1, y1] = pointAlongWall(wall, from);
            const [x2, y2] = pointAlongWall(wall, to);
            pieces.push(
              `  <line x1="${x1.toFixed(1)}" y1="${fy(y1).toFixed(1)}" x2="${x2.toFixed(1)}" y2="${fy(y2).toFixed(1)}" stroke="#26231f" stroke-width="${wall.thickness}" stroke-linecap="butt"/>`
            );
          }

          for (const opening of openings) {
            const [x1, y1] = pointAlongWall(wall, opening.offset);
            const [x2, y2] = pointAlongWall(wall, opening.offset + opening.width);
            const [sx, sy] = [x1, fy(y1)];
            const [ex, ey] = [x2, fy(y2)];
            const label = `${opening.name} ${Math.round(opening.width)}×${Math.round(opening.height)}`;
            const midX = (sx + ex) / 2;
            const midY = (sy + ey) / 2;

            // 개구부 자리는 벽을 끊어 흰색으로 비운다 (건축 도면 관행)
            pieces.push(
              `  <line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="#ffffff" stroke-width="${wall.thickness + 4}"/>`
            );

            /*
             * 도면 위에는 부호만 적는다.
             *
             * 예전에는 "침실1창 1863×1200 (미닫이) 안열림" 같은 주기를 개구부마다 붙였다.
             * 그래서 창이 몇 개만 있어도 글자가 도면을 덮었고, 정작 벽선이 안 보였다.
             * 실제 도면은 D1·W1 같은 부호만 달고 자세한 것은 아래 창호일람표로 뺀다.
             */
            const tag = `${opening.type === "door" ? "D" : "W"}${
              opening.type === "door" ? ++doorNo : ++windowNo
            }`;
            schedule.push({ tag, opening });

            const tagSvg = `  <text x="${midX.toFixed(1)}" y="${(midY - 120).toFixed(1)}" font-size="110" text-anchor="middle" font-weight="600" fill="#5c5751" paint-order="stroke" stroke="#ffffff" stroke-width="50">${tag}</text>`;

            if (opening.type === "door") {
              pieces.push(...doorSymbol(opening, sx, sy, ex, ey), tagSvg);
            } else {
              // 창: 벽 두께 안에 유리선 3줄
              const offsets = [-wall.thickness / 2, 0, wall.thickness / 2];
              const dxn = (ex - sx) / opening.width;
              const dyn = (ey - sy) / opening.width;
              for (const offset of offsets) {
                const ox = -dyn * offset;
                const oy = dxn * offset;
                pieces.push(
                  `  <line x1="${(sx + ox).toFixed(1)}" y1="${(sy + oy).toFixed(1)}" x2="${(ex + ox).toFixed(1)}" y2="${(ey + oy).toFixed(1)}" stroke="#4d4d4d" stroke-width="14"/>`
                );
              }
              pieces.push(tagSvg);
            }
          }

          return pieces.join("\n");
        })
        .join("\n")
    : `  <rect x="0" y="0" width="${W}" height="${L}" fill="none" stroke="#26231f" stroke-width="24"/>`;

  /*
   * 창호일람표.
   *
   * 도면 아래에 표로 붙인다. 부호·종류·크기·창대높이·여닫이 방향 — 시공자가 창호를
   * 발주할 때 그대로 읽는 값들이다. 개구부가 없으면 표도 그리지 않는다.
   */
  /** 문 종류를 사람이 읽는 말로 */
  const DOOR_LABEL: Record<string, string> = {
    hinged: "여닫이문",
    sliding: "미닫이문",
    folding: "접이문",
    opening: "개구부",
  };

  const scheduleSvg = schedule.length
    ? (() => {
        const top = TABLE_TOP;
        const rowHeight = ROW_H;
        const cols = [0, 500, 1400, 3200, 4400, 6200, 9000];
        const head = ["부호", "종류", "크기 (W×H)", "창대높이", "여닫이", "위치"];

        const rows = schedule.map((entry, index) => {
          const y = top + rowHeight * (index + 1);
          const { opening } = entry;
          const kind =
            opening.type === "door"
              ? DOOR_LABEL[
                  opening.doorType ?? "hinged"
                ] ?? "문"
              : "창";
          const swing =
            opening.type === "door" && (opening.doorType ?? "hinged") === "hinged"
              ? `${opening.hinge === "end" ? "우" : "좌"}힌지 · ${opening.swing === "out" ? "밖" : "안"}열림`
              : "—";

          const cells = [
            entry.tag,
            kind,
            `${Math.round(opening.width)} × ${Math.round(opening.height)}`,
            opening.type === "window" ? `${Math.round(opening.sillHeight)}` : "—",
            swing,
            opening.name,
          ];

          return [
            `    <line x1="${cols[0]}" y1="${y - rowHeight + 40}" x2="${cols[6]}" y2="${y - rowHeight + 40}" stroke="#d8d5d0" stroke-width="8"/>`,
            ...cells.map(
              (cell, col) =>
                `    <text x="${cols[col] + 60}" y="${y}" font-size="100" fill="#3d3a36">${esc(cell)}</text>`
            ),
          ].join("\n");
        });

        return `  <g font-family="Pretendard, sans-serif">
    <text x="0" y="${top - 60}" font-size="120" font-weight="600" fill="#26231f">창호일람표</text>
    <rect x="${cols[0]}" y="${top - 20}" width="${cols[6]}" height="${rowHeight * (schedule.length + 1)}" fill="none" stroke="#26231f" stroke-width="12"/>
${head
  .map(
    (label, col) =>
      `    <text x="${cols[col] + 60}" y="${top + 130}" font-size="100" font-weight="600" fill="#26231f">${esc(label)}</text>`
  )
  .join("\n")}
${rows.join("\n")}
  </g>`;
      })()
    : "";

  /*
   * 마감재 일람표.
   *
   * 도면 한 장으로 견적이 나오려면 실마다 바닥·벽·천장에 무엇을 쓰는지가 있어야 한다.
   * 실제 도면에도 창호일람표와 나란히 붙는 표다.
   *
   * 실별 바닥 마감이 따로 지정돼 있으면 그것을 쓰고, 없으면 방 전체 마감을 따른다.
   * 아무것도 없으면 "미정"으로 남긴다 — 빈칸으로 두면 빠뜨린 것인지 미정인지 알 수 없다.
   */
  const finishRows = (plan.areas.length
    ? plan.areas.map((area) => ({
        name: area.name,
        floor: area.floorMaterialId
          ? (plan.materialNames[area.floorMaterialId] ?? area.floorMaterialId)
          : plan.finishes.floor,
      }))
    : [{ name: plan.roomType, floor: plan.finishes.floor }]
  ).map((row) => [row.name, row.floor || "미정", plan.finishes.wall || "미정", plan.finishes.ceiling || "미정"]);

  const finishSvg = (() => {
    const top = TABLE_TOP;
    const rowHeight = ROW_H;
    const left = schedule.length ? FINISH_LEFT : 0;
    const cols = [0, 1700, 4400, 7100, 9800].map((value) => value + left);
    const head = ["실", "바닥", "벽", "천장"];

    const rows = finishRows.map((cells, index) => {
      const y = top + rowHeight * (index + 1);
      return [
        `    <line x1="${cols[0]}" y1="${y - rowHeight + 40}" x2="${cols[4]}" y2="${y - rowHeight + 40}" stroke="#d8d5d0" stroke-width="8"/>`,
        ...cells.map(
          (cell, col) =>
            `    <text x="${cols[col] + 60}" y="${y}" font-size="100" fill="#3d3a36">${esc(String(cell).slice(0, 16))}</text>`
        ),
      ].join("\n");
    });

    return `  <g font-family="Pretendard, sans-serif">
    <text x="${cols[0]}" y="${top - 60}" font-size="120" font-weight="600" fill="#26231f">마감재 일람표</text>
    <rect x="${cols[0]}" y="${top - 20}" width="${cols[4] - cols[0]}" height="${rowHeight * (finishRows.length + 1)}" fill="none" stroke="#26231f" stroke-width="12"/>
${head
  .map(
    (label, col) =>
      `    <text x="${cols[col] + 60}" y="${top + 130}" font-size="100" font-weight="600" fill="#26231f">${esc(label)}</text>`
  )
  .join("\n")}
${rows.join("\n")}
  </g>`;
  })();

  const areaM2 = (W / 1000) * (L / 1000);

  /*
   * 방 전체 이름표.
   *
   * 실이 따로 잡혀 있으면 실마다 이름과 면적이 이미 찍히므로, 전체 이름표는 그 위에
   * 겹쳐 그려질 뿐이다. 실이 없을 때(원룸·사진 한 장)만 그린다.
   */
  const wholeLabel = plan.areas.length
    ? ""
    : `  <g font-family="Pretendard, sans-serif" text-anchor="middle" paint-order="stroke" stroke="#ffffff" stroke-width="60" stroke-linejoin="round">
    <text x="${W / 2}" y="${fy(L) + 320}" font-size="150" fill="#26231f">${esc(plan.roomType)}</text>
    <text x="${W / 2}" y="${fy(L) + 470}" font-size="105" fill="#666666">${areaM2.toFixed(1)}㎡ (${(areaM2 / 3.3058).toFixed(1)}평)</text>
  </g>`;

  /*
   * 사방 치수 체인.
   *
   * 건축 평면도 관행대로 네 면 모두에 치수를 넣는다.
   * 안쪽 줄은 벽–개구부–벽으로 끊은 구간 치수, 바깥 줄은 전체 치수다.
   * 시공자가 도면 한 장만 보고 먹매김을 할 수 있어야 하므로 두 단을 함께 그린다.
   */
  const chainGap = 420;
  const chainOuter = 900;

  /** 한 변의 구간 분할점 — 그 변에 붙은 벽의 개구부에서 뽑는다 */
  const splitPoints = (
    pick: (wall: (typeof plan.walls)[number]) => boolean,
    axis: 0 | 1,
    span: number
  ): number[] => {
    const points = [0, span];

    /*
     * 그 변에 놓인 벽을 모두 본다.
     *
     * 예전에는 find 로 첫 벽 하나만 보고 그 벽의 개구부만 넣었다. 그래서 한 변이 여러
     * 벽으로 이어진 아파트 도면에서는 나머지 벽과 그 문들이 통째로 빠졌고, 결국 전체
     * 길이 하나만 적힌 치수줄이 됐다. 실제 도면은 벽이 꺾이는 곳과 문이 시작·끝나는
     * 곳마다 끊어 2.32 / 1.47 / 1.47 / 2.86 처럼 잘게 적는다.
     */
    for (const wall of plan.walls.filter(pick)) {
      points.push(wall.start[axis], wall.end[axis]);

      for (const opening of wall.openings ?? []) {
        const [ax, ay] = pointAlongWall(wall, opening.offset);
        const [bx, by] = pointAlongWall(wall, opening.offset + opening.width);
        points.push(axis === 0 ? ax : ay, axis === 0 ? bx : by);
      }
    }

    /*
     * 너무 촘촘하면 글자가 겹쳐 못 읽는다. 80mm 안에 있는 점은 같은 자리로 본다 —
     * 벽 두께 때문에 생기는 미세한 차이까지 끊으면 치수줄이 지네처럼 된다.
     */
    const sorted = [...new Set(points.map((value) => Math.round(value)))]
      .filter((value) => value >= 0 && value <= span)
      .sort((a, b) => a - b);

    const merged: number[] = [];
    for (const value of sorted) {
      if (merged.length === 0 || value - merged[merged.length - 1] > 80) merged.push(value);
    }

    return merged;
  };

  /** 수평 치수줄 (도면 위/아래) */
  const horizontalChain = (points: number[], y: number): string =>
    points
      .slice(0, -1)
      .map((from, index) => {
        const to = points[index + 1];
        if (to - from <= 0) return "";
        return [
          `    <line x1="${from}" y1="${y}" x2="${to}" y2="${y}"/>`,
          `    <line x1="${from}" y1="${y - 50}" x2="${from}" y2="${y + 50}"/>`,
          `    <line x1="${to}" y1="${y - 50}" x2="${to}" y2="${y + 50}"/>`,
          `    <text x="${(from + to) / 2}" y="${y - 90}" font-size="90" text-anchor="middle" stroke="none">${to - from}</text>`,
        ].join("\n");
      })
      .join("\n");

  /** 수직 치수줄 (도면 좌/우) — 글자를 90° 돌려 세운다 */
  const verticalChain = (points: number[], x: number): string =>
    points
      .slice(0, -1)
      .map((from, index) => {
        const to = points[index + 1];
        if (to - from <= 0) return "";
        const y1 = fy(from);
        const y2 = fy(to);
        const midY = (y1 + y2) / 2;
        return [
          `    <line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/>`,
          `    <line x1="${x - 50}" y1="${y1}" x2="${x + 50}" y2="${y1}"/>`,
          `    <line x1="${x - 50}" y1="${y2}" x2="${x + 50}" y2="${y2}"/>`,
          `    <text x="${x - 90}" y="${midY}" font-size="90" text-anchor="middle" stroke="none" transform="rotate(-90 ${x - 90} ${midY})">${to - from}</text>`,
        ].join("\n");
      })
      .join("\n");

  const southPoints = splitPoints(
    (wall) => wall.start[1] === 0 && wall.end[1] === 0,
    0,
    W
  );
  const northPoints = splitPoints(
    (wall) => wall.start[1] === L && wall.end[1] === L,
    0,
    W
  );
  const westPoints = splitPoints((wall) => wall.start[0] === 0 && wall.end[0] === 0, 1, L);
  const eastPoints = splitPoints((wall) => wall.start[0] === W && wall.end[0] === W, 1, L);

  const dimensionChain = [
    horizontalChain(southPoints, L + chainGap),
    horizontalChain([0, W], L + chainOuter),
    horizontalChain(northPoints, -chainGap + 40),
    horizontalChain([0, W], -chainOuter + 40),
    verticalChain(westPoints, -chainGap),
    verticalChain([0, L], -chainOuter),
    verticalChain(eastPoints, W + chainGap),
    verticalChain([0, L], W + chainOuter),
  ]
    .filter(Boolean)
    .join("\n");

  /*
   * 가구는 기호로 그린다.
   *
   * 예전에는 빈 사각형에 이름과 치수를 적었다. 그러면 도면을 펼쳤을 때 글자만 빼곡하고
   * 실제 도면처럼 보이지 않는다 — 도면을 읽는 사람은 글자가 아니라 모양으로 안다.
   * 침대는 베개와 이불선이 있고, 변기는 변기 모양이고, 의자는 등받이가 테이블을 본다.
   *
   * 기호는 자기 좌표계(-0.5~0.5)에서 그려 두고 여기서 크기·회전·위치를 입힌다.
   * 글자는 큰 가구에만 작게 남긴다. 협탁까지 이름을 달면 그게 다시 글자밭이 된다.
   */
  const objects = plan.objects
    .map((object) => {
      const symbol = symbolFor(object);
      const x = object.cx;
      const y = fy(object.cy);

      // SVG는 y가 아래로 커지므로 도면 회전과 방향이 반대다
      const transform = `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(-object.rotation).toFixed(1)}) scale(${object.width.toFixed(1)} ${object.depth.toFixed(1)})`;

      /*
       * 바깥 윤곽은 도면에서 읽은 모양이 가장 우선이다. ㄱ자 책상이 그려져 있으면
       * ㄱ자로 그려야 하고, 그것이 없을 때만 기호의 기본 윤곽이나 네모로 물러난다.
       */
      const outline = object.footprint?.length
        ? `<path d="${footprintPath(object.footprint)}"/>`
        : symbol?.outline || `<rect x="-0.5" y="-0.5" width="1" height="1"/>`;

      /*
       * 선 두께는 크기를 입히기 전 좌표계에서 정해지므로, 가구가 클수록 선이 굵어진다.
       * 어느 가구든 도면에서 같은 굵기로 보이도록 크기로 나눠 준다.
       */
      const stroke = (18 / Math.max(object.width, object.depth)).toFixed(5);

      /*
       * 이름은 글자가 들어갈 자리가 있을 때만 적는다.
       *
       * 넓이만 보면 1800×450 거실장 같은 가늘고 긴 가구가 통과해 버려서, 좁은 변에
       * 긴 이름이 눌려 뭉갠다. 짧은 변도 함께 보고, 이름이 길면 잘라 쓴다.
       */
      const short = Math.min(object.width, object.depth);
      const name = object.name.length > 10 ? object.name.slice(0, 9) + "…" : object.name;

      const label =
        short >= 700 && object.width * object.depth >= 500_000
          ? `  <text x="${x.toFixed(1)}" y="${(y + 40).toFixed(1)}" font-size="96" text-anchor="middle" fill="#4d4d4d" paint-order="stroke" stroke="#ffffff" stroke-width="40">${esc(name)}</text>`
          : "";

      return `  <g transform="${transform}" fill="none" stroke="#3d3a36" stroke-width="${stroke}" stroke-linejoin="round">
    <g fill="#ffffff">${outline}</g>
    ${symbol?.detail ?? ""}
  </g>
${label}`;
    })
    .join("\n");

  const electrical = plan.electrical
    .map((fixture) => {
      const spec = electricalSpec(fixture.kind);
      const [px, py] = electricalPoint(plan, fixture);
      const x = px;
      const y = fy(py);
      /*
       * 원 안에 기호, 아래에 설치 높이와 회로 번호.
       *
       * 시공자가 도면에서 바로 읽는 값들이다 — 무엇을(기호), 얼마 높이에(H), 어느
       * 차단기에 물려(회로) 다는지.
       */
      const circuit = fixture.circuit ? ` · ${fixture.circuit}` : "";

      return `  <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="110" fill="#ffffff" stroke="#1f5f9c" stroke-width="18"/>
  <text x="${x.toFixed(1)}" y="${(y + 38).toFixed(1)}" font-size="96" text-anchor="middle" fill="#1f5f9c">${esc(spec.symbol)}</text>
  <text x="${x.toFixed(1)}" y="${(y + 250).toFixed(1)}" font-size="76" text-anchor="middle" fill="#1f5f9c">H${Math.round(fixture.height)}${esc(circuit)}</text>`;
    })
    .join("\n");

  /*
   * 사용자 주석.
   * 편집기에서 얹은 그대로 도면에도 나와야 한다 — 화면과 산출물이 다르면 도면을 믿을 수 없다.
   */
  const annotations = plan.annotations
    .map((annotation) => {
      const pts = annotation.points.map(([x, y]) => [x, fy(y)] as [number, number]);

      if (annotation.type === "text") {
        const [x, y] = pts[0];
        return `  <text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${annotation.fontSize ?? 110}" fill="#26231f">${esc(annotation.text ?? "")}</text>`;
      }

      if (annotation.type === "polyline") {
        return `  <polyline points="${pts.map((point) => point.map((value) => value.toFixed(1)).join(",")).join(" ")}" fill="none" stroke="#26231f" stroke-width="${annotation.thickness ?? 20}"${annotation.dashed ? ' stroke-dasharray="80 50"' : ""}/>`;
      }

      const [[x1, y1], [x2, y2]] = pts;
      const [a, b] = annotation.points;
      const length = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]));

      return [
        `  <line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#8a8a8a" stroke-width="12"/>`,
        `  <circle cx="${x1.toFixed(1)}" cy="${y1.toFixed(1)}" r="26" fill="#8a8a8a"/>`,
        `  <circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="26" fill="#8a8a8a"/>`,
        `  <text x="${((x1 + x2) / 2).toFixed(1)}" y="${((y1 + y2) / 2 - 60).toFixed(1)}" font-size="${annotation.fontSize ?? 96}" text-anchor="middle" fill="#26231f">${esc(annotation.text || String(length))}</text>`,
      ].join("\n");
    })
    .join("\n");

  /*
   * 실(방) 영역.
   * 건축 평면도에서 실명과 면적은 가장 먼저 읽는 정보라 벽보다 아래, 가구보다 아래에 깐다.
   */
  /*
   * 실별 안목 치수.
   *
   * 지금까지는 도면 바깥 둘레에만 치수가 있었다. 그런데 시공자가 실제로 재는 것은
   * 실 하나하나의 안목 치수다 — 벽지를 몇 롤 사고 마루를 몇 장 까는지가 거기서 나온다.
   * 실제 도면도 실마다 가로·세로 치수를 적어 둔다.
   *
   * 실 안쪽에 짧은 치수줄을 그린다. 바깥 둘레 치수줄과 섞이지 않게 안쪽에 두고,
   * 글자가 들어갈 자리가 없는 좁은 실에는 그리지 않는다 — 억지로 넣으면 도면이
   * 다시 글자밭이 된다.
   */
  const roomDimensions = plan.areas
    .map((area) => {
      const xs = area.points.map(([x]) => x);
      const ys = area.points.map(([, y]) => y);
      const x0 = Math.min(...xs);
      const x1 = Math.max(...xs);
      const y0 = Math.min(...ys);
      const y1 = Math.max(...ys);

      const width = Math.round(x1 - x0);
      const depth = Math.round(y1 - y0);

      /** 치수줄을 벽에서 이만큼 안쪽에 둔다 */
      const inset = 260;
      /** 이보다 짧으면 글자가 치수줄보다 길어져 읽을 수 없다 */
      const MIN = 1200;

      const parts: string[] = [];

      if (width >= MIN) {
        const y = fy(y1) + inset;
        parts.push(
          `    <line x1="${x0 + 60}" y1="${y}" x2="${x1 - 60}" y2="${y}"/>`,
          `    <line x1="${x0 + 60}" y1="${y - 45}" x2="${x0 + 60}" y2="${y + 45}"/>`,
          `    <line x1="${x1 - 60}" y1="${y - 45}" x2="${x1 - 60}" y2="${y + 45}"/>`,
          `    <text x="${(x0 + x1) / 2}" y="${y - 70}" font-size="88" text-anchor="middle" stroke="none">${width}</text>`
        );
      }

      if (depth >= MIN) {
        const x = x0 + inset;
        const top = fy(y1) + 60;
        const bottom = fy(y0) - 60;
        const mid = (top + bottom) / 2;
        parts.push(
          `    <line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}"/>`,
          `    <line x1="${x - 45}" y1="${top}" x2="${x + 45}" y2="${top}"/>`,
          `    <line x1="${x - 45}" y1="${bottom}" x2="${x + 45}" y2="${bottom}"/>`,
          `    <text x="${x - 70}" y="${mid}" font-size="88" text-anchor="middle" stroke="none" transform="rotate(-90 ${x - 70} ${mid})">${depth}</text>`
        );
      }

      return parts.join("\n");
    })
    .filter(Boolean)
    .join("\n");

  const areasSvg = plan.areas
    .map((area) => {
      const pts = area.points.map(([x, y]) => `${x.toFixed(1)},${fy(y).toFixed(1)}`).join(" ");
      const [cx, cy] = polygonCentroid(area.points);
      const squareMeters = toSquareMeters(polygonArea(area.points));

      return [
        `  <polygon points="${pts}" fill="${area.color ?? "#f4f2ee"}" stroke="#d6d3cc" stroke-width="10"/>`,
        `  <text x="${cx.toFixed(1)}" y="${fy(cy).toFixed(1)}" font-size="150" text-anchor="middle" fill="#26231f">${esc(area.name)}</text>`,
        area.showArea === false
          ? ""
          : `  <text x="${cx.toFixed(1)}" y="${(fy(cy) + 170).toFixed(1)}" font-size="105" text-anchor="middle" fill="#666666">${squareMeters.toFixed(1)}㎡ (${(squareMeters / 3.3058).toFixed(1)}평)</text>`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-margin} ${-margin} ${vbW} ${vbH}" width="1400">
  <rect x="${-margin}" y="${-margin}" width="${vbW}" height="${vbH}" fill="#ffffff"/>

  <!-- 실(방) -->
  <g font-family="Pretendard, sans-serif" paint-order="stroke" stroke="#ffffff" stroke-width="50" stroke-linejoin="round">
${areasSvg}
  </g>

  <!-- 가구 (벽보다 아래에 깔아 벽선이 가려지지 않게 한다) -->
${objects}

  <!-- 벽 · 개구부 -->
${wallsSvg}

  <!-- 전기 · 통신 -->
  <g font-family="Pretendard, sans-serif">
${electrical}
  </g>

  <!-- 사용자 주석 -->
  <g font-family="Pretendard, sans-serif">
${annotations}
  </g>

  <!-- 실 이름 · 면적 (실이 따로 잡혀 있으면 그쪽에 이미 적혀 있으므로 생략한다) -->
${wholeLabel}

  <!-- 방위 · 축척 -->
  <g stroke="#26231f" stroke-width="14" fill="#26231f" font-family="Pretendard, sans-serif">
    <line x1="${-margin + 300}" y1="${-margin + 620}" x2="${-margin + 300}" y2="${-margin + 300}"/>
    <polygon points="${-margin + 300},${-margin + 250} ${-margin + 230},${-margin + 400} ${-margin + 370},${-margin + 400}" stroke="none"/>
    <text x="${-margin + 300}" y="${-margin + 780}" font-size="110" text-anchor="middle" stroke="none">N</text>
  </g>
  <g stroke="#26231f" stroke-width="12" fill="#26231f" font-family="Pretendard, sans-serif">
    <line x1="${W - 1000}" y1="${-margin + 500}" x2="${W}" y2="${-margin + 500}"/>
    <line x1="${W - 1000}" y1="${-margin + 440}" x2="${W - 1000}" y2="${-margin + 560}"/>
    <line x1="${W - 500}" y1="${-margin + 460}" x2="${W - 500}" y2="${-margin + 540}"/>
    <line x1="${W}" y1="${-margin + 440}" x2="${W}" y2="${-margin + 560}"/>
    <text x="${W - 500}" y="${-margin + 700}" font-size="96" text-anchor="middle" stroke="none">1 m</text>
  </g>

  <!-- 치수 (바깥 둘레) -->
  <g stroke="#8a8a8a" stroke-width="12" fill="#8a8a8a" font-size="110">
${dimensionChain}
  </g>

  <!-- 치수 (실별 안목) — 바깥 것보다 옅게 그려 둘이 섞여 보이지 않게 한다 -->
  <g stroke="#b0aca6" stroke-width="9" fill="#8a8a8a" paint-order="stroke" font-size="88">
${roomDimensions}
  </g>

  <!-- 창호일람표 · 마감재 일람표 -->
${scheduleSvg}
${finishSvg}

  <!-- 타이틀블록 -->
  <g font-family="Pretendard, sans-serif">
    <rect x="${-margin + 100}" y="${titleTop}" width="${vbW - 200}" height="520" fill="none" stroke="#26231f" stroke-width="16"/>
    <text x="${-margin + 200}" y="${titleTop + 180}" font-size="170" fill="#26231f">${esc(plan.projectName)}</text>
    <text x="${-margin + 200}" y="${titleTop + 320}" font-size="100" fill="#5c5751">${esc(plan.roomType)} · ${Math.round(W)}×${Math.round(L)}×${Math.round(plan.roomHeight)} mm · SCALE 1:1 (mm) · ${plan.createdAt.slice(0, 10)}</text>
    <text x="${-margin + 200}" y="${titleTop + 450}" font-size="92" fill="${plan.measured ? "#4f7a55" : "#b4453a"}">${esc(disclaimerFor(plan.measured))}</text>
  </g>
</svg>`;
}
