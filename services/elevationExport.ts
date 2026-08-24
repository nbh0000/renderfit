import type { ElectricalFixture, WallSegment } from "@/scene/types";
import { wallLength } from "@/scene/geometry";
import { electricalSpec } from "@/config/electrical";
import { disclaimerFor, doorNote, type PlanData } from "./cadExport";

/**
 * 입면도(측면도) 생성.
 *
 * 평면도만으로는 "문이 어디로 열리는가"까지는 보여도 "스위치를 몇 mm에 다는가"는 알 수 없다.
 * 시공 현장에서 실제로 필요한 값은 벽면을 정면으로 본 그림 위의 높이라서, 벽 한 장을
 * 세로로 펼쳐 개구부·설비의 높이를 치수와 함께 그린다.
 *
 * 좌표계는 벽을 따라 x(0~벽 길이), 바닥에서 y(0~천장고)를 쓴다.
 * 실내에서 그 벽을 바라본 방향으로 그리므로 평면 기준 방향을 좌우 반전한다.
 *
 * ⚠ 치수는 Scene 값 기준이며 실측 도면이 아니다.
 */

const TEXT = "Pretendard, sans-serif";

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export interface ElevationInput {
  plan: PlanData;
  wall: WallSegment;
  /** 벽 이름 대신 쓸 표시 이름 (예: "북측 벽") */
  title?: string;
}

/** 벽 하나의 전기 설비만 골라 높이 순으로 정렬한다 */
export function fixturesOnWall(plan: PlanData, wallId: string): ElectricalFixture[] {
  return plan.electrical
    .filter((fixture) => fixture.wallId === wallId)
    .sort((a, b) => a.offset - b.offset);
}

export function buildElevationSvg({ plan, wall, title }: ElevationInput): string {
  const length = wallLength(wall);
  const height = wall.height || plan.roomHeight;

  const margin = 900;
  const bottomBand = 1500;
  const vbW = length + margin * 2;
  const vbH = height + margin * 2 + bottomBand;

  /** 실내에서 본 방향으로 뒤집는다 */
  const fx = (x: number) => length - x;
  /** 바닥이 아래로 오도록 y를 뒤집는다 */
  const fy = (y: number) => height - y;

  const openings = [...(wall.openings ?? [])].sort((a, b) => a.offset - b.offset);

  const openingSvg = openings
    .map((opening) => {
      const left = fx(opening.offset + opening.width);
      const top = fy(opening.sillHeight + opening.height);
      const isDoor = opening.type === "door";
      const fill = isDoor ? "#faf6f2" : "#eef4fa";
      const stroke = isDoor ? "#bf6242" : "#1f5f9c";

      const label = `${opening.name} ${Math.round(opening.width)}×${Math.round(opening.height)}`;
      const note = isDoor ? doorNote(opening) : `SILL ${Math.round(opening.sillHeight)}`;

      const glass =
        !isDoor
          ? `  <line x1="${(left + 60).toFixed(1)}" y1="${(top + opening.height / 2).toFixed(1)}" x2="${(left + opening.width - 60).toFixed(1)}" y2="${(top + opening.height / 2).toFixed(1)}" stroke="${stroke}" stroke-width="12"/>`
          : `  <circle cx="${(left + (opening.hinge === "end" ? 180 : opening.width - 180)).toFixed(1)}" cy="${(top + opening.height / 2).toFixed(1)}" r="45" fill="${stroke}"/>`;

      return `  <rect x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${opening.width.toFixed(1)}" height="${opening.height.toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="22"/>
${glass}
  <text x="${(left + opening.width / 2).toFixed(1)}" y="${(top - 90).toFixed(1)}" font-size="96" text-anchor="middle" fill="${stroke}">${esc(label)}</text>
  <text x="${(left + opening.width / 2).toFixed(1)}" y="${(top - 220).toFixed(1)}" font-size="82" text-anchor="middle" fill="#666666">${esc(note)}</text>`;
    })
    .join("\n");

  const fixtures = fixturesOnWall(plan, wall.id);
  const fixtureSvg = fixtures
    .map((fixture) => {
      const spec = electricalSpec(fixture.kind);
      const x = fx(fixture.offset);
      const y = fy(fixture.height);
      return `  <line x1="${x.toFixed(1)}" y1="${fy(0).toFixed(1)}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#1f5f9c" stroke-width="8" stroke-dasharray="40 40"/>
  <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="105" fill="#ffffff" stroke="#1f5f9c" stroke-width="18"/>
  <text x="${x.toFixed(1)}" y="${(y + 36).toFixed(1)}" font-size="92" text-anchor="middle" fill="#1f5f9c">${esc(spec.symbol)}</text>
  <text x="${x.toFixed(1)}" y="${(y - 160).toFixed(1)}" font-size="78" text-anchor="middle" fill="#1f5f9c">H${Math.round(fixture.height)}${fixture.circuit ? ` · ${esc(fixture.circuit)}` : ""}</text>`;
    })
    .join("\n");

  /* 좌측 수직 치수 — 층고와 개구부 상·하단 */
  const levels = new Set<number>([0, height]);
  for (const opening of openings) {
    levels.add(opening.sillHeight);
    levels.add(opening.sillHeight + opening.height);
  }
  for (const fixture of fixtures) levels.add(fixture.height);

  const dimX = -420;
  const verticalDims = [...levels]
    .sort((a, b) => a - b)
    .map(
      (level) =>
        `  <line x1="${dimX}" y1="${fy(level).toFixed(1)}" x2="${length + 200}" y2="${fy(level).toFixed(1)}" stroke="#c9c4bd" stroke-width="6" stroke-dasharray="30 40"/>
  <text x="${dimX - 40}" y="${(fy(level) + 34).toFixed(1)}" font-size="86" text-anchor="end" fill="#666666">${Math.round(level)}</text>`
    )
    .join("\n");

  /* 하단 수평 치수 체인 — 벽 시작에서 개구부까지의 거리 */
  const chain = new Set<number>([0, length]);
  for (const opening of openings) {
    chain.add(opening.offset);
    chain.add(opening.offset + opening.width);
  }
  const sorted = [...chain].sort((a, b) => a - b);
  const chainY = height + 380;

  const horizontalDims = sorted
    .slice(0, -1)
    .map((from, index) => {
      const to = sorted[index + 1];
      const span = to - from;
      if (span <= 0) return "";
      const midX = fx((from + to) / 2);
      return `  <line x1="${fx(from).toFixed(1)}" y1="${fy(chainY).toFixed(1)}" x2="${fx(to).toFixed(1)}" y2="${fy(chainY).toFixed(1)}" stroke="#26231f" stroke-width="10"/>
  <text x="${midX.toFixed(1)}" y="${(fy(chainY) + 130).toFixed(1)}" font-size="90" text-anchor="middle" fill="#26231f">${Math.round(span)}</text>`;
    })
    .join("\n");

  const heading = title ?? wall.name ?? "벽";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-margin} ${-margin} ${vbW} ${vbH}" width="1400">
  <rect x="${-margin}" y="${-margin}" width="${vbW}" height="${vbH}" fill="#ffffff"/>

  <g font-family="${TEXT}">
    <!-- 벽면 -->
    <rect x="0" y="0" width="${length.toFixed(1)}" height="${height.toFixed(1)}" fill="#fbfaf8" stroke="#26231f" stroke-width="24"/>

    <!-- 바닥·천장선 -->
    <line x1="${-200}" y1="${fy(0).toFixed(1)}" x2="${length + 200}" y2="${fy(0).toFixed(1)}" stroke="#26231f" stroke-width="30"/>
    <line x1="${-200}" y1="${fy(height).toFixed(1)}" x2="${length + 200}" y2="${fy(height).toFixed(1)}" stroke="#8a8a8a" stroke-width="14"/>

    <!-- 높이 치수 -->
${verticalDims}

    <!-- 개구부 -->
${openingSvg}

    <!-- 전기 · 통신 -->
${fixtureSvg}

    <!-- 폭 치수 -->
${horizontalDims}

    <text x="${(length / 2).toFixed(1)}" y="${(fy(0) + 700).toFixed(1)}" font-size="150" text-anchor="middle" fill="#26231f">입면도 · ${esc(heading)}</text>
    <text x="${(length / 2).toFixed(1)}" y="${(fy(0) + 850).toFixed(1)}" font-size="96" text-anchor="middle" fill="#666666">벽 길이 ${Math.round(length)} · 천장고 ${Math.round(height)} (mm)</text>
    <text x="${(length / 2).toFixed(1)}" y="${(fy(0) + 1010).toFixed(1)}" font-size="80" text-anchor="middle" fill="#999999">${esc(disclaimerFor(plan.measured))}</text>
  </g>
</svg>`;
}
