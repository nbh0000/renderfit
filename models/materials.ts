import type { Material } from "@/scene/types";

/**
 * 기본 PBR 재질 카탈로그.
 * 3D 뷰에서는 그대로 MeshStandardMaterial 파라미터로 쓰이고,
 * 2.5D 뷰에서는 baseColor가 오버레이 색으로 쓰인다.
 */
export const DEFAULT_MATERIALS: Material[] = [
  {
    id: "mat_white_paint",
    name: "화이트 페인트",
    baseColor: "#f4f2ef",
    roughness: 0.92,
    metallic: 0,
    scale: 1,
    tags: ["wall", "ceiling", "paint", "white"],
  },
  {
    id: "mat_warm_ivory",
    name: "웜 아이보리",
    baseColor: "#efe4d3",
    roughness: 0.9,
    metallic: 0,
    scale: 1,
    tags: ["wall", "paint", "warm", "ivory", "아이보리"],
  },
  {
    id: "mat_soft_greige",
    name: "그레이지 도장",
    baseColor: "#ded7cd",
    roughness: 0.9,
    metallic: 0,
    scale: 1,
    tags: ["wall", "paint", "neutral"],
  },
  {
    id: "mat_oak",
    name: "오크",
    baseColor: "#c9a173",
    roughness: 0.62,
    metallic: 0,
    scale: 2,
    tags: ["wood", "floor", "furniture", "oak", "오크"],
  },
  {
    id: "mat_light_oak",
    name: "라이트 오크",
    baseColor: "#dcc19a",
    roughness: 0.6,
    metallic: 0,
    scale: 2,
    tags: ["wood", "floor", "light", "오크"],
  },
  {
    id: "mat_walnut",
    name: "월넛",
    baseColor: "#6b4a34",
    roughness: 0.55,
    metallic: 0,
    scale: 2,
    tags: ["wood", "furniture", "dark", "walnut", "월넛"],
  },
  {
    id: "mat_marble",
    name: "대리석",
    baseColor: "#eceae6",
    roughness: 0.18,
    metallic: 0.05,
    scale: 1,
    tags: ["stone", "luxury", "marble", "대리석"],
  },
  {
    id: "mat_concrete",
    name: "노출 콘크리트",
    baseColor: "#b4b1ac",
    roughness: 0.85,
    metallic: 0,
    scale: 1,
    tags: ["concrete", "industrial", "wall", "콘크리트"],
  },
  {
    id: "mat_beige_fabric",
    name: "베이지 패브릭",
    baseColor: "#d8c8b2",
    roughness: 0.95,
    metallic: 0,
    scale: 1,
    tags: ["fabric", "sofa", "beige", "베이지"],
  },
  {
    id: "mat_grey_fabric",
    name: "그레이 패브릭",
    baseColor: "#a8a49e",
    roughness: 0.95,
    metallic: 0,
    scale: 1,
    tags: ["fabric", "sofa", "grey", "그레이"],
  },
  {
    id: "mat_leather_brown",
    name: "브라운 가죽",
    baseColor: "#6d4a33",
    roughness: 0.45,
    metallic: 0,
    scale: 1,
    tags: ["leather", "sofa", "brown", "가죽", "브라운"],
  },
  {
    id: "mat_stone",
    name: "스톤",
    baseColor: "#8d8983",
    roughness: 0.78,
    metallic: 0,
    scale: 1.5,
    tags: ["stone", "natural"],
  },
  {
    id: "mat_tile",
    name: "타일",
    baseColor: "#e3e1dc",
    roughness: 0.3,
    metallic: 0,
    scale: 3,
    tags: ["tile", "bathroom", "kitchen", "타일"],
  },
  {
    id: "mat_black_steel",
    name: "블랙 스틸",
    baseColor: "#2f2d2b",
    roughness: 0.35,
    metallic: 0.85,
    scale: 1,
    tags: ["metal", "industrial", "black", "스틸"],
  },
  {
    id: "mat_brass",
    name: "브래스",
    baseColor: "#b08d4e",
    roughness: 0.3,
    metallic: 0.9,
    scale: 1,
    tags: ["metal", "luxury", "brass", "황동"],
  },
  {
    id: "mat_linen",
    name: "린넨",
    baseColor: "#e7e0d3",
    roughness: 0.97,
    metallic: 0,
    scale: 1,
    tags: ["fabric", "natural", "linen", "린넨"],
  },
  {
    id: "mat_green_plant",
    name: "식물 그린",
    baseColor: "#5c7a52",
    roughness: 0.85,
    metallic: 0,
    scale: 1,
    tags: ["plant", "green", "식물"],
  },
];

export const MATERIAL_MAP: Record<string, Material> = Object.fromEntries(
  DEFAULT_MATERIALS.map((m) => [m.id, m])
);

/** 자연어에서 재질을 찾는다 ("따뜻한 아이보리", "오크", "브라운 가죽") */
export function findMaterialByText(text: string): Material | undefined {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return undefined;

  const scored = DEFAULT_MATERIALS.map((material) => {
    let score = 0;
    if (normalized.includes(material.name.toLowerCase())) score += 10;
    for (const tag of material.tags) {
      if (normalized.includes(tag.toLowerCase())) score += 3;
    }
    return { material, score };
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.material;
}

/** 자연어 색 이름 → hex. AI 색상 변경 명령의 fallback으로 쓴다. */
export const COLOR_KEYWORDS: { keywords: string[]; hex: string; label: string }[] = [
  { keywords: ["아이보리", "ivory"], hex: "#efe4d3", label: "아이보리" },
  { keywords: ["베이지", "beige"], hex: "#d8c8b2", label: "베이지" },
  { keywords: ["화이트", "흰", "white"], hex: "#f4f2ef", label: "화이트" },
  { keywords: ["블랙", "검정", "black"], hex: "#2f2d2b", label: "블랙" },
  { keywords: ["그레이", "회색", "grey", "gray"], hex: "#a8a49e", label: "그레이" },
  { keywords: ["브라운", "갈색", "brown"], hex: "#6d4a33", label: "브라운" },
  { keywords: ["네이비", "navy"], hex: "#31415c", label: "네이비" },
  { keywords: ["그린", "초록", "green"], hex: "#5c7a52", label: "그린" },
  { keywords: ["테라코타", "terracotta"], hex: "#bf6242", label: "테라코타" },
  { keywords: ["머스터드", "mustard"], hex: "#c0803a", label: "머스터드" },
  { keywords: ["세이지", "sage"], hex: "#9aa88f", label: "세이지" },
  { keywords: ["크림", "cream"], hex: "#f0e7d8", label: "크림" },
];

export function findColorByText(text: string): { hex: string; label: string } | undefined {
  const normalized = text.toLowerCase();
  const hexMatch = /#[0-9a-f]{6}/i.exec(text);
  if (hexMatch) return { hex: hexMatch[0], label: hexMatch[0] };

  for (const entry of COLOR_KEYWORDS) {
    if (entry.keywords.some((keyword) => normalized.includes(keyword))) {
      return { hex: entry.hex, label: entry.label };
    }
  }
  return undefined;
}
