import type { Scene, SceneObject } from "@/scene/types";
import { MATERIAL_MAP } from "@/models/materials";
import { STYLE_PRESET_MAP } from "@/models/styles";

/**
 * Scene을 SVG 이미지로 그린다.
 *
 * Mock generation/rendering이 "가짜 버튼"이 되지 않도록, 실제 Scene의 객체·재질·조명을
 * 반영한 이미지를 만든다. 객체를 옮기거나 재질을 바꾸면 렌더 결과도 실제로 달라진다.
 */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function mix(hex: string, target: string, ratio: number): string {
  const parse = (h: string) => [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = parse(hex);
  const [r2, g2, b2] = parse(target);
  const c = (a: number, b: number) =>
    Math.round(a + (b - a) * ratio)
      .toString(16)
      .padStart(2, "0");
  return `#${c(r1, r2)}${c(g1, g2)}${c(b1, b2)}`;
}

function materialColor(scene: Scene, object: SceneObject, fallback: string): string {
  if (!object.materialId) return fallback;
  const inScene = scene.materials.find((m) => m.id === object.materialId);
  return inScene?.baseColor ?? MATERIAL_MAP[object.materialId]?.baseColor ?? fallback;
}

/** 조명 세기 평균으로 전체 밝기를 조절한다 */
function lightingFactor(scene: Scene): number {
  const enabled = scene.lights.filter((l) => l.enabled);
  if (enabled.length === 0) return 0.35;
  const total = enabled.reduce((sum, l) => sum + l.intensity, 0);
  return Math.min(1.25, Math.max(0.4, total / 2.5));
}

/** 조명 색온도 평균 → 웜/쿨 틴트 */
function lightingTint(scene: Scene): string {
  const enabled = scene.lights.filter((l) => l.enabled);
  if (enabled.length === 0) return "#ffffff";
  const avg = enabled.reduce((sum, l) => sum + l.temperature, 0) / enabled.length;
  if (avg <= 3200) return "#ffd9a8";
  if (avg <= 4200) return "#ffeacc";
  if (avg <= 5200) return "#fff6e8";
  return "#eef4ff";
}

export interface RasterOptions {
  width?: number;
  height?: number;
  /** 상단에 표시할 라벨 (없으면 표시하지 않음) */
  caption?: string;
  styleId?: string | null;
}

export function renderSceneToSvg(scene: Scene, options: RasterOptions = {}): string {
  const width = options.width ?? scene.source.width ?? 1280;
  const height = options.height ?? scene.source.height ?? 960;

  const style = STYLE_PRESET_MAP[options.styleId ?? scene.styleId ?? "modern"];
  const palette = style?.palette ?? ["#f4f2ef", "#c9a173", "#5c554b"];

  const brightness = lightingFactor(scene);
  const tint = lightingTint(scene);

  const wall = mix(mix(palette[0], tint, 0.35), "#ffffff", (brightness - 0.7) * 0.4);
  const wallShade = mix(wall, "#000000", 0.08);
  const floor = mix(palette[1], "#3a2f26", 0.25);
  const horizon = Math.round(height * 0.64);

  const visible = scene.objects
    .filter((o) => o.visibility)
    .sort((a, b) => b.depth - a.depth || a.order - b.order);

  const shapes = visible
    .map((object) => {
      const x = object.screen.x * width;
      const y = object.screen.y * height;
      const w = Math.max(6, object.screen.width * width);
      const h = Math.max(6, object.screen.height * height);
      const color = materialColor(scene, object, palette[2]);
      const shaded = mix(color, "#000000", 0.12 * object.depth);
      const rotation = object.screen.rotation ?? 0;
      const radius = object.type === "rug" ? Math.round(h / 2) : Math.round(Math.min(w, h) * 0.08);
      const isFlat = object.type === "rug" || object.type === "floor";

      return `<g transform="rotate(${rotation} ${x + w / 2} ${y + h / 2})">
    <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${radius}" fill="${shaded}" opacity="${isFlat ? 0.75 : 0.95}"/>
    <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(2, h * 0.16).toFixed(1)}" rx="${radius}" fill="${mix(shaded, "#ffffff", 0.22)}" opacity="0.9"/>
  </g>`;
    })
    .join("\n  ");

  const caption = options.caption
    ? `<g>
    <rect x="0" y="${height - Math.round(height * 0.09)}" width="${width}" height="${Math.round(height * 0.09)}" fill="#26231f" opacity="0.55"/>
    <text x="${Math.round(width * 0.03)}" y="${height - Math.round(height * 0.032)}" fill="#ffffff" font-family="Pretendard, sans-serif" font-size="${Math.round(height * 0.035)}" font-weight="600">${escapeXml(options.caption)}</text>
  </g>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${wall}"/>
  <rect x="0" y="0" width="${Math.round(width * 0.16)}" height="${horizon}" fill="${wallShade}"/>
  <rect x="0" y="${horizon}" width="${width}" height="${height - horizon}" fill="${floor}"/>
  <rect x="0" y="${horizon}" width="${width}" height="3" fill="${mix(floor, "#000000", 0.25)}" opacity="0.5"/>
  ${shapes}
  ${caption}
</svg>`;
}

/** 깊이 맵 — 바닥이 가까울수록 밝게(가까움=0) */
export function renderDepthMapSvg(scene: Scene, width = 640, height = 480): string {
  const horizon = Math.round(height * 0.64);
  const bands = Array.from({ length: 12 }, (_, i) => {
    const t = i / 11;
    const y = horizon + ((height - horizon) * i) / 12;
    const shade = Math.round(255 * (1 - t * 0.8));
    return `<rect x="0" y="${y.toFixed(1)}" width="${width}" height="${((height - horizon) / 12).toFixed(1)}" fill="rgb(${shade},${shade},${shade})"/>`;
  }).join("\n  ");

  const objects = scene.objects
    .filter((o) => o.visibility)
    .map((object) => {
      const shade = Math.round(255 * (1 - object.depth));
      return `<rect x="${(object.screen.x * width).toFixed(1)}" y="${(object.screen.y * height).toFixed(1)}" width="${(object.screen.width * width).toFixed(1)}" height="${(object.screen.height * height).toFixed(1)}" fill="rgb(${shade},${shade},${shade})"/>`;
    })
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="rgb(40,40,40)"/>
  ${bands}
  ${objects}
</svg>`;
}

/** 세그멘테이션 맵 — 객체마다 고유 색 */
export function renderSegmentationSvg(scene: Scene, width = 640, height = 480): string {
  const colorFor = (index: number) => {
    const hue = (index * 47) % 360;
    return `hsl(${hue} 70% 55%)`;
  };

  const shapes = scene.objects
    .filter((o) => o.visibility)
    .map(
      (object, index) =>
        `<rect x="${(object.screen.x * width).toFixed(1)}" y="${(object.screen.y * height).toFixed(1)}" width="${(object.screen.width * width).toFixed(1)}" height="${(object.screen.height * height).toFixed(1)}" fill="${colorFor(index)}"/>`
    )
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#111111"/>
  ${shapes}
</svg>`;
}

/** 단일 객체 마스크 — 흰색=대상 영역 */
export function renderMaskSvg(
  rect: { x: number; y: number; width: number; height: number },
  width = 640,
  height = 480
): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#000000"/>
  <rect x="${(rect.x * width).toFixed(1)}" y="${(rect.y * height).toFixed(1)}" width="${(rect.width * width).toFixed(1)}" height="${(rect.height * height).toFixed(1)}" fill="#ffffff"/>
</svg>`;
}
