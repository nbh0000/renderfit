import type { Scene, SceneObject, WallOpening, WallSegment } from "@/scene/types";
import { OBJECT_GROUP_OF } from "@/scene/types";
import { ensureRoom, pointAlongWall, wallAngle, wallDirection, wallLength } from "@/scene/geometry";

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
  layer: string;
  /** 도면 좌표계(mm), 사각형 중심 */
  cx: number;
  cy: number;
  width: number;
  depth: number;
  /** degree, 반시계 */
  rotation: number;
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

  const objects: PlanObject[] = scene.objects
    .filter((object) => object.visibility)
    .filter(
      (object) => object.type !== "wall" && object.type !== "ceiling" && object.type !== "floor"
    )
    .map((object: SceneObject) => {
      // screen.x(0~1) → 방 가로 위치, depth(0~1, 클수록 안쪽) → 방 세로 위치
      const cx = (object.screen.x + object.screen.width / 2) * roomWidth;
      const cy = object.depth * roomLength;

      return {
        id: object.id,
        name: object.name,
        layer: LAYER_BY_GROUP[OBJECT_GROUP_OF[object.type] ?? "furniture"] ?? "I-FURN",
        cx: clamp(cx, 0, roomWidth),
        cy: clamp(cy, 0, roomLength),
        width: object.dimensions.width * object.transform.scale[0],
        depth: object.dimensions.depth * object.transform.scale[2],
        rotation: object.screen.rotation,
      };
    });

  return {
    projectName,
    roomType: room.type,
    walls: room.walls ?? [],
    measured: Boolean(room.measured),
    roomWidth,
    roomLength,
    roomHeight: room.dimensions.height,
    objects,
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
export function buildPlanSvg(plan: PlanData): string {
  const margin = 900;
  const W = plan.roomWidth;
  const L = plan.roomLength;
  const vbW = W + margin * 2;
  const vbH = L + margin * 2 + 1700;

  const esc = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // SVG는 y축이 아래로 증가하므로 방 좌표를 뒤집어 그린다.
  const fy = (y: number) => L - y;

  // 벽체: 개구부로 끊긴 구간만 그리고, 문·창은 별도 색으로 표기한다
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

            if (opening.type === "door") {
              // 문틀 + 90° 열림 궤적 (문짝 + 스윙 아크)
              const dx = (ex - sx) / opening.width;
              const dy = (ey - sy) / opening.width;
              // 벽 안쪽(방향 법선)으로 열리게 그린다
              const nx = -dy;
              const ny = dx;
              const leafX = sx + nx * opening.width;
              const leafY = sy + ny * opening.width;

              pieces.push(
                `  <line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${leafX.toFixed(1)}" y2="${leafY.toFixed(1)}" stroke="#26231f" stroke-width="26"/>`,
                `  <path d="M ${ex.toFixed(1)} ${ey.toFixed(1)} A ${opening.width.toFixed(1)} ${opening.width.toFixed(1)} 0 0 ${nx * dy - ny * dx >= 0 ? 1 : 0} ${leafX.toFixed(1)} ${leafY.toFixed(1)}" fill="none" stroke="#8b857d" stroke-width="14" stroke-dasharray="60 40"/>`,
                `  <text x="${midX.toFixed(1)}" y="${(midY - 140).toFixed(1)}" font-size="96" text-anchor="middle" fill="#bf6242">${esc(label)}</text>`
              );
            } else {
              // 창: 벽 두께 안에 유리선 3줄
              const offsets = [-wall.thickness / 2, 0, wall.thickness / 2];
              const dxn = (ex - sx) / opening.width;
              const dyn = (ey - sy) / opening.width;
              for (const offset of offsets) {
                const ox = -dyn * offset;
                const oy = dxn * offset;
                pieces.push(
                  `  <line x1="${(sx + ox).toFixed(1)}" y1="${(sy + oy).toFixed(1)}" x2="${(ex + ox).toFixed(1)}" y2="${(ey + oy).toFixed(1)}" stroke="#4a7fb5" stroke-width="14"/>`
                );
              }
              pieces.push(
                `  <text x="${midX.toFixed(1)}" y="${(midY - 140).toFixed(1)}" font-size="96" text-anchor="middle" fill="#4a7fb5">${esc(label)}</text>`
              );
            }
          }

          return pieces.join("\n");
        })
        .join("\n")
    : `  <rect x="0" y="0" width="${W}" height="${L}" fill="none" stroke="#26231f" stroke-width="24"/>`;

  const areaM2 = (W / 1000) * (L / 1000);

  /**
   * 남측 벽(도면 아래쪽) 기준 치수 체인.
   * 개구부가 있으면 벽–개구부–벽 구간을 끊어 표기한다 (시공 시 필요한 값).
   */
  const southWall = plan.walls.find(
    (wall) => wall.start[1] === 0 && wall.end[1] === 0 && wall.end[0] > wall.start[0]
  );
  const chainPoints = [0, W];
  for (const opening of southWall?.openings ?? []) {
    chainPoints.push(opening.offset, opening.offset + opening.width);
  }
  const sorted = [...new Set(chainPoints)].sort((a, b) => a - b);
  const chainY = L + 400;
  const dimensionChain = sorted
    .slice(0, -1)
    .map((from, index) => {
      const to = sorted[index + 1];
      const mid = (from + to) / 2;
      return [
        `    <line x1="${from}" y1="${chainY}" x2="${to}" y2="${chainY}"/>`,
        `    <line x1="${from}" y1="${chainY - 50}" x2="${from}" y2="${chainY + 50}"/>`,
        `    <line x1="${to}" y1="${chainY - 50}" x2="${to}" y2="${chainY + 50}"/>`,
        `    <text x="${mid}" y="${chainY - 90}" font-size="90" text-anchor="middle" stroke="none">${Math.round(to - from)}</text>`,
      ].join("\n");
    })
    .join("\n");

  const objects = plan.objects
    .map((object) => {
      const corners = rectCorners(object)
        .map(([x, y]) => `${x.toFixed(1)},${fy(y).toFixed(1)}`)
        .join(" ");
      return `  <polygon points="${corners}" fill="#e8e1d6" stroke="#4a453e" stroke-width="18"/>
  <text x="${object.cx}" y="${fy(object.cy)}" font-size="110" text-anchor="middle" fill="#26231f">${esc(object.name)}</text>
  <text x="${object.cx}" y="${fy(object.cy) + 130}" font-size="86" text-anchor="middle" fill="#6b6560">${Math.round(object.width)}×${Math.round(object.depth)}</text>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-margin} ${-margin} ${vbW} ${vbH}" width="1400">
  <rect x="${-margin}" y="${-margin}" width="${vbW}" height="${vbH}" fill="#ffffff"/>

  <!-- 가구 (벽보다 아래에 깔아 벽선이 가려지지 않게 한다) -->
${objects}

  <!-- 벽 · 개구부 -->
${wallsSvg}

  <!-- 실 이름 · 면적 -->
  <g font-family="Pretendard, sans-serif" text-anchor="middle" paint-order="stroke" stroke="#ffffff" stroke-width="60" stroke-linejoin="round">
    <text x="${W / 2}" y="${fy(L) + 320}" font-size="150" fill="#26231f">${esc(plan.roomType)}</text>
    <text x="${W / 2}" y="${fy(L) + 470}" font-size="105" fill="#6b6560">${areaM2.toFixed(1)}㎡ (${(areaM2 / 3.3058).toFixed(1)}평)</text>
  </g>

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

  <!-- 치수 -->
  <g stroke="#8b857d" stroke-width="12" fill="#8b857d" font-size="110">
${dimensionChain}
    <line x1="0" y1="${L + 700}" x2="${W}" y2="${L + 700}"/>
    <line x1="0" y1="${L + 640}" x2="0" y2="${L + 760}"/>
    <line x1="${W}" y1="${L + 640}" x2="${W}" y2="${L + 760}"/>
    <text x="${W / 2}" y="${L + 900}" text-anchor="middle" stroke="none">${Math.round(W)} mm</text>

    <line x1="${-420}" y1="0" x2="${-420}" y2="${L}"/>
    <line x1="${-480}" y1="0" x2="${-360}" y2="0"/>
    <line x1="${-480}" y1="${L}" x2="${-360}" y2="${L}"/>
    <text x="${-520}" y="${L / 2}" text-anchor="middle" stroke="none" transform="rotate(-90 ${-520} ${L / 2})">${Math.round(L)} mm</text>
  </g>

  <!-- 타이틀블록 -->
  <g font-family="Pretendard, sans-serif">
    <rect x="${-margin + 100}" y="${L + 800}" width="${vbW - 200}" height="520" fill="none" stroke="#26231f" stroke-width="16"/>
    <text x="${-margin + 200}" y="${L + 980}" font-size="170" fill="#26231f">${esc(plan.projectName)}</text>
    <text x="${-margin + 200}" y="${L + 1120}" font-size="100" fill="#5c5751">${esc(plan.roomType)} · ${Math.round(W)}×${Math.round(L)}×${Math.round(plan.roomHeight)} mm · SCALE 1:1 (mm) · ${plan.createdAt.slice(0, 10)}</text>
    <text x="${-margin + 200}" y="${L + 1250}" font-size="92" fill="${plan.measured ? "#4f7a55" : "#b4453a"}">${esc(disclaimerFor(plan.measured))}</text>
  </g>
</svg>`;
}
