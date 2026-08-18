import { ASSET_MAP } from "@/models/assets";
import { MATERIAL_MAP } from "@/models/materials";

/** 에셋 썸네일 — 실제 이미지가 없으므로 치수 비율을 반영한 SVG를 생성한다. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const asset = ASSET_MAP[id];

  const color = asset?.materials[0] ? (MATERIAL_MAP[asset.materials[0]]?.baseColor ?? "#c9b9a3") : "#c9b9a3";
  const label = asset?.name ?? "에셋";

  const size = 160;
  const ratio = asset ? Math.min(1.4, asset.dimensions.width / Math.max(asset.dimensions.height, 1)) : 1;
  const w = Math.min(120, 60 * ratio + 40);
  const h = Math.min(110, 110 / Math.max(ratio, 0.6));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#f2efea"/>
  <rect x="${(size - w) / 2}" y="${size - h - 28}" width="${w}" height="${h}" rx="8" fill="${color}"/>
  <rect x="${(size - w) / 2}" y="${size - h - 28}" width="${w}" height="${Math.max(6, h * 0.18)}" rx="8" fill="#ffffff" opacity="0.35"/>
  <text x="${size / 2}" y="${size - 8}" text-anchor="middle" font-family="Pretendard, sans-serif" font-size="11" fill="#6b6560">${label.slice(0, 12)}</text>
</svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
