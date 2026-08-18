import type { Scene, SceneObject } from "@/scene/types";
import { OBJECT_GROUP_OF } from "@/scene/types";

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
  const roomWidth = scene.room.dimensions.width;
  const roomLength = scene.room.dimensions.length;

  const objects: PlanObject[] = scene.objects
    .filter((object) => object.visibility)
    .filter((object) => object.type !== "wall" && object.type !== "ceiling" && object.type !== "floor")
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
    roomType: scene.room.type,
    roomWidth,
    roomLength,
    roomHeight: scene.room.dimensions.height,
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
  ]);

  dxf.section("ENTITIES");

  // 벽 (내측·외측 이중선)
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
    `ROOM: ${plan.roomType}  /  ${Math.round(W)} x ${Math.round(L)} x ${Math.round(plan.roomHeight)} mm  /  SCALE 1:1 (mm)`,
    "A-NOTE"
  );
  dxf.text(120, titleY - 640, 80, CAD_DISCLAIMER, "A-NOTE");
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
  const vbH = L + margin * 2 + 1400;

  const esc = (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // SVG는 y축이 아래로 증가하므로 방 좌표를 뒤집어 그린다.
  const fy = (y: number) => L - y;

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

  <!-- 벽 -->
  <rect x="${-WALL_THICKNESS}" y="${-WALL_THICKNESS}" width="${W + WALL_THICKNESS * 2}" height="${L + WALL_THICKNESS * 2}" fill="none" stroke="#26231f" stroke-width="40"/>
  <rect x="0" y="0" width="${W}" height="${L}" fill="none" stroke="#26231f" stroke-width="24"/>

  <!-- 가구 -->
${objects}

  <!-- 치수 -->
  <g stroke="#8b857d" stroke-width="12" fill="#8b857d" font-size="110">
    <line x1="0" y1="${L + 420}" x2="${W}" y2="${L + 420}"/>
    <line x1="0" y1="${L + 360}" x2="0" y2="${L + 480}"/>
    <line x1="${W}" y1="${L + 360}" x2="${W}" y2="${L + 480}"/>
    <text x="${W / 2}" y="${L + 620}" text-anchor="middle" stroke="none">${Math.round(W)} mm</text>

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
    <text x="${-margin + 200}" y="${L + 1250}" font-size="92" fill="#b4453a">${esc(CAD_DISCLAIMER)}</text>
  </g>
</svg>`;
}
