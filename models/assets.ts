import type { Asset, ObjectType } from "@/scene/types";

/**
 * 가구 에셋 라이브러리.
 * 실제 GLB가 없는 항목은 primitive geometry로 3D 뷰에 표시된다(dead-end UI를 만들지 않는다).
 * thumbnailUrl은 /api/assets/thumbnail/[id]가 SVG로 생성한다.
 */
function asset(
  id: string,
  name: string,
  type: ObjectType,
  category: string,
  style: string[],
  dimensions: [number, number, number],
  tags: string[],
  primitive: Asset["primitive"] = "box",
  materials: string[] = []
): Asset {
  return {
    id,
    name,
    category,
    type,
    style,
    dimensions: { width: dimensions[0], height: dimensions[1], depth: dimensions[2] },
    thumbnailUrl: `/api/assets/thumbnail/${id}`,
    modelUrl: null,
    primitive,
    materials,
    tags,
    embedding: null,
  };
}

export const ASSETS: Asset[] = [
  // ── Sofa ──
  asset("asset_sofa_beige_3", "3인용 베이지 소파", "sofa", "sofa", ["modern", "warm", "scandinavian"], [2200, 850, 950], ["소파", "sofa", "beige", "베이지", "3인용", "fabric", "warm"], "box", ["mat_beige_fabric"]),
  asset("asset_sofa_grey_2", "2인용 그레이 소파", "sofa", "sofa", ["modern", "minimal"], [1600, 800, 900], ["소파", "sofa", "grey", "그레이", "2인용", "fabric"], "box", ["mat_grey_fabric"]),
  asset("asset_sofa_leather", "브라운 가죽 소파", "sofa", "sofa", ["industrial", "luxury"], [2100, 820, 950], ["소파", "sofa", "leather", "가죽", "brown", "브라운"], "box", ["mat_leather_brown"]),
  asset("asset_sofa_japandi", "재팬디 로우 소파", "sofa", "sofa", ["japandi", "natural"], [1900, 700, 880], ["소파", "sofa", "japandi", "재팬디", "low", "린넨"], "box", ["mat_linen"]),

  // ── Chair ──
  asset("asset_lounge_chair", "라운지체어", "chair", "chair", ["modern", "contemporary"], [780, 900, 820], ["의자", "chair", "라운지", "lounge", "안락"], "box", ["mat_grey_fabric"]),
  asset("asset_dining_chair", "우드 다이닝 체어", "chair", "chair", ["natural", "scandinavian"], [450, 850, 500], ["의자", "chair", "다이닝", "dining", "wood", "우드"], "box", ["mat_oak"]),
  asset("asset_accent_chair", "액센트 체어", "chair", "chair", ["luxury", "contemporary"], [700, 880, 750], ["의자", "chair", "accent", "포인트"], "box", ["mat_leather_brown"]),

  // ── Table ──
  asset("asset_coffee_table_oak", "오크 커피 테이블", "table", "table", ["natural", "japandi"], [1100, 400, 600], ["테이블", "table", "커피", "coffee", "oak", "오크"], "box", ["mat_oak"]),
  asset("asset_dining_table", "6인 다이닝 테이블", "table", "table", ["modern", "contemporary"], [1800, 750, 900], ["테이블", "table", "다이닝", "dining", "6인"], "box", ["mat_walnut"]),
  asset("asset_side_table", "사이드 테이블", "table", "table", ["minimal", "modern"], [450, 550, 450], ["테이블", "table", "사이드", "side"], "cylinder", ["mat_black_steel"]),

  // ── Storage ──
  asset("asset_tv_cabinet", "TV 수납장", "cabinet", "cabinet", ["modern", "minimal"], [1800, 450, 400], ["수납", "cabinet", "tv", "티비", "장식장"], "box", ["mat_walnut"]),
  asset("asset_bookshelf", "책장", "cabinet", "cabinet", ["natural", "scandinavian"], [900, 1800, 350], ["책장", "bookshelf", "수납", "shelf"], "box", ["mat_oak"]),
  asset("asset_sideboard", "사이드보드", "cabinet", "cabinet", ["contemporary", "luxury"], [1600, 750, 450], ["사이드보드", "sideboard", "수납"], "box", ["mat_walnut"]),

  // ── Bed ──
  asset("asset_bed_queen", "퀸 침대", "bed", "bed", ["modern", "warm"], [1600, 1000, 2100], ["침대", "bed", "퀸", "queen"], "box", ["mat_linen"]),
  asset("asset_bed_low", "재팬디 로우 베드", "bed", "bed", ["japandi", "minimal"], [1500, 700, 2050], ["침대", "bed", "low", "재팬디"], "box", ["mat_oak"]),

  // ── Lighting ──
  asset("asset_floor_lamp", "플로어 램프", "lamp", "lamp", ["modern", "warm"], [400, 1650, 400], ["조명", "lamp", "플로어", "floor", "스탠드"], "cylinder", ["mat_black_steel"]),
  asset("asset_pendant_lamp", "펜던트 조명", "lamp", "lamp", ["japandi", "natural"], [500, 400, 500], ["조명", "lamp", "펜던트", "pendant"], "sphere", ["mat_linen"]),
  asset("asset_table_lamp", "테이블 램프", "lamp", "lamp", ["luxury", "contemporary"], [300, 550, 300], ["조명", "lamp", "테이블", "table"], "cylinder", ["mat_brass"]),

  // ── Decoration ──
  asset("asset_plant_large", "대형 화분", "plant", "plant", ["natural", "scandinavian"], [700, 1600, 700], ["식물", "plant", "화분", "대형", "green"], "cylinder", ["mat_green_plant"]),
  asset("asset_plant_small", "소형 화분", "plant", "plant", ["natural", "japandi"], [300, 500, 300], ["식물", "plant", "화분", "소형"], "cylinder", ["mat_green_plant"]),
  asset("asset_rug_wool", "울 러그", "rug", "rug", ["warm", "scandinavian"], [2400, 20, 1700], ["러그", "rug", "카펫", "carpet", "wool"], "plane", ["mat_beige_fabric"]),
  asset("asset_rug_jute", "주트 러그", "rug", "rug", ["natural", "japandi"], [2000, 20, 1400], ["러그", "rug", "주트", "jute"], "plane", ["mat_linen"]),
  asset("asset_art_frame", "액자", "decoration", "decoration", ["modern", "minimal"], [900, 1200, 40], ["액자", "art", "frame", "그림"], "plane", ["mat_black_steel"]),
  asset("asset_mirror", "라운드 미러", "decoration", "decoration", ["contemporary", "luxury"], [800, 800, 40], ["거울", "mirror", "라운드"], "sphere", ["mat_brass"]),

  // ── Appliance ──
  asset("asset_tv_65", "65인치 TV", "tv", "appliance", ["modern", "contemporary"], [1450, 850, 60], ["tv", "티비", "텔레비전", "65"], "plane", ["mat_black_steel"]),
  asset("asset_air_purifier", "공기청정기", "appliance", "appliance", ["modern", "minimal"], [400, 800, 400], ["공기청정기", "appliance", "가전"], "cylinder", ["mat_white_paint"]),
];

export const ASSET_MAP: Record<string, Asset> = Object.fromEntries(ASSETS.map((a) => [a.id, a]));

/**
 * 키워드 기반 에셋 검색.
 * pgvector 임베딩 검색으로 확장할 수 있도록 점수 계산을 분리해 두었다.
 */
export function scoreAsset(asset: Asset, query: string): number {
  const normalized = query.toLowerCase().trim();
  if (!normalized) return 0;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  let score = 0;

  for (const token of tokens) {
    if (asset.name.toLowerCase().includes(token)) score += 6;
    if (asset.category.toLowerCase().includes(token)) score += 4;
    if (asset.type.toLowerCase().includes(token)) score += 4;
    if (asset.style.some((s) => s.toLowerCase().includes(token))) score += 3;
    if (asset.tags.some((t) => t.toLowerCase().includes(token) || token.includes(t.toLowerCase()))) {
      score += 3;
    }
  }

  return score;
}

export function searchAssets(query: string, limit = 12): Asset[] {
  if (!query.trim()) return ASSETS.slice(0, limit);
  return ASSETS.map((asset) => ({ asset, score: scoreAsset(asset, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.asset);
}

export function assetsByType(type: ObjectType): Asset[] {
  return ASSETS.filter((asset) => asset.type === type);
}
