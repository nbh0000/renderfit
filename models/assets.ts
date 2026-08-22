import type { Asset, ObjectType } from "@/scene/types";
import { POLYHAVEN_EXTRA, POLYHAVEN_MODELS } from "./polyhaven.generated";

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

const BASE_ASSETS: Asset[] = [
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

  /* ─────────────── 확장 카탈로그 (국내 유통 규격 기준) ─────────────── */

  // ── 소파 ──
  asset("asset_sofa_corner", "코너 카우치 소파", "sofa", "sofa", ["modern", "contemporary"], [2800, 830, 1700], ["소파", "sofa", "코너", "corner", "카우치", "L자"], "box", ["mat_grey_fabric"]),
  asset("asset_sofa_1seat", "1인용 암체어 소파", "sofa", "sofa", ["minimal", "scandinavian"], [900, 800, 850], ["소파", "sofa", "1인용", "암체어", "싱글"], "box", ["mat_beige_fabric"]),
  asset("asset_sofa_bed", "소파베드", "sofa", "sofa", ["modern", "minimal"], [1900, 780, 900], ["소파", "sofa", "소파베드", "sofabed", "원룸"], "box", ["mat_grey_fabric"]),
  asset("asset_bench_entry", "현관 벤치", "sofa", "sofa", ["natural", "japandi"], [1000, 450, 380], ["벤치", "bench", "현관", "스툴"], "box", ["mat_oak"]),

  // ── 의자 ──
  asset("asset_desk_chair", "데스크 체어", "chair", "chair", ["modern", "minimal"], [620, 1050, 620], ["의자", "chair", "데스크", "office", "사무"], "box", ["mat_black_steel"]),
  asset("asset_bar_stool", "바 스툴", "chair", "chair", ["industrial", "modern"], [400, 750, 400], ["의자", "stool", "바", "bar", "아일랜드"], "cylinder", ["mat_black_steel"]),
  asset("asset_rocking_chair", "라운지 로킹체어", "chair", "chair", ["natural", "warm"], [700, 950, 900], ["의자", "chair", "로킹", "흔들"], "box", ["mat_oak"]),
  asset("asset_kids_chair", "아이 의자", "chair", "chair", ["natural", "scandinavian"], [340, 600, 360], ["의자", "chair", "아이", "kids", "유아"], "box", ["mat_oak"]),

  // ── 테이블·책상 ──
  asset("asset_dining_table_4", "4인 다이닝 테이블", "table", "table", ["natural", "scandinavian"], [1400, 740, 800], ["테이블", "table", "다이닝", "4인", "식탁"], "box", ["mat_oak"]),
  asset("asset_round_table", "라운드 티테이블", "table", "table", ["minimal", "contemporary"], [800, 450, 800], ["테이블", "table", "라운드", "원형", "티테이블"], "cylinder", ["mat_walnut"]),
  asset("asset_desk_1400", "1400 책상", "table", "table", ["modern", "minimal"], [1400, 730, 700], ["책상", "desk", "테이블", "서재", "재택"], "box", ["mat_oak"]),
  asset("asset_desk_1600_l", "L자 책상", "table", "table", ["modern", "industrial"], [1600, 730, 1400], ["책상", "desk", "L자", "게이밍", "서재"], "box", ["mat_black_steel"]),
  asset("asset_console_table", "콘솔 테이블", "table", "table", ["luxury", "contemporary"], [1200, 800, 350], ["콘솔", "console", "테이블", "현관"], "box", ["mat_walnut"]),
  asset("asset_nesting_table", "네스팅 테이블", "table", "table", ["japandi", "minimal"], [500, 450, 500], ["테이블", "nesting", "사이드", "보조"], "cylinder", ["mat_oak"]),
  asset("asset_kitchen_island", "주방 아일랜드", "table", "table", ["modern", "contemporary"], [1800, 900, 900], ["아일랜드", "island", "주방", "kitchen", "조리대"], "box", ["mat_marble"]),

  // ── 수납 ──
  asset("asset_wardrobe_2door", "2도어 옷장", "cabinet", "cabinet", ["modern", "minimal"], [1200, 2100, 600], ["옷장", "wardrobe", "수납", "붙박이"], "box", ["mat_white_paint"]),
  asset("asset_wardrobe_slide", "슬라이딩 붙박이장", "cabinet", "cabinet", ["modern", "luxury"], [2400, 2400, 600], ["옷장", "붙박이", "슬라이딩", "wardrobe"], "box", ["mat_white_paint"]),
  asset("asset_chest_5", "5단 서랍장", "cabinet", "cabinet", ["natural", "scandinavian"], [800, 1200, 450], ["서랍장", "chest", "수납", "드로어"], "box", ["mat_oak"]),
  asset("asset_nightstand", "협탁", "cabinet", "cabinet", ["warm", "minimal"], [450, 550, 400], ["협탁", "nightstand", "사이드", "침실"], "box", ["mat_walnut"]),
  asset("asset_shoe_cabinet", "신발장", "cabinet", "cabinet", ["modern", "minimal"], [900, 1200, 350], ["신발장", "shoe", "현관", "수납"], "box", ["mat_white_paint"]),
  asset("asset_open_shelf", "오픈 선반", "cabinet", "cabinet", ["industrial", "minimal"], [800, 1600, 300], ["선반", "shelf", "오픈", "책장"], "box", ["mat_black_steel"]),
  asset("asset_kitchen_upper", "주방 상부장", "cabinet", "cabinet", ["modern", "minimal"], [3000, 700, 350], ["상부장", "주방", "kitchen", "수납"], "box", ["mat_white_paint"]),
  asset("asset_kitchen_lower", "주방 하부장", "cabinet", "cabinet", ["modern", "minimal"], [3000, 850, 600], ["하부장", "주방", "kitchen", "싱크"], "box", ["mat_white_paint"]),

  // ── 침대 ──
  asset("asset_bed_single", "싱글 침대", "bed", "bed", ["minimal", "scandinavian"], [1000, 900, 2000], ["침대", "bed", "싱글", "1인"], "box", ["mat_linen"]),
  asset("asset_bed_super_king", "슈퍼싱글 침대", "bed", "bed", ["modern", "warm"], [1100, 950, 2000], ["침대", "bed", "슈퍼싱글", "ss"], "box", ["mat_linen"]),
  asset("asset_bed_king", "킹 침대", "bed", "bed", ["luxury", "contemporary"], [1800, 1050, 2100], ["침대", "bed", "킹", "king"], "box", ["mat_grey_fabric"]),
  asset("asset_bunk_bed", "이층 침대", "bed", "bed", ["natural", "scandinavian"], [1050, 1650, 2050], ["침대", "bunk", "이층", "아이"], "box", ["mat_oak"]),
  asset("asset_crib", "아기 침대", "bed", "bed", ["natural", "minimal"], [750, 950, 1300], ["침대", "crib", "아기", "유아"], "box", ["mat_oak"]),

  // ── 조명 ──
  asset("asset_pendant_long", "롱 펜던트 (식탁등)", "lamp", "lamp", ["modern", "contemporary"], [1200, 300, 200], ["조명", "펜던트", "식탁등", "다이닝"], "box", ["mat_black_steel"]),
  asset("asset_ceiling_flush", "실링 라이트", "lamp", "lamp", ["minimal", "modern"], [500, 120, 500], ["조명", "실링", "천장등", "ceiling"], "cylinder", ["mat_white_paint"]),
  asset("asset_wall_sconce", "벽등 (브래킷)", "lamp", "lamp", ["warm", "luxury"], [200, 300, 220], ["조명", "벽등", "sconce", "브래킷"], "cylinder", ["mat_brass"]),
  asset("asset_arc_lamp", "아치 플로어 램프", "lamp", "lamp", ["contemporary", "luxury"], [1800, 2100, 400], ["조명", "아치", "arc", "플로어"], "cylinder", ["mat_black_steel"]),
  asset("asset_desk_lamp", "데스크 램프", "lamp", "lamp", ["minimal", "modern"], [180, 450, 400], ["조명", "데스크", "스탠드", "task"], "cylinder", ["mat_black_steel"]),

  // ── 러그·패브릭 ──
  asset("asset_rug_round", "라운드 러그", "rug", "rug", ["natural", "scandinavian"], [1600, 20, 1600], ["러그", "rug", "라운드", "원형"], "plane", ["mat_beige_fabric"]),
  asset("asset_rug_kilim", "킬림 러그", "rug", "rug", ["warm", "vintage"], [2000, 20, 1400], ["러그", "rug", "킬림", "kilim", "패턴"], "plane", ["mat_linen"]),
  asset("asset_curtain_sheer", "쉬어 커튼", "decoration", "decoration", ["minimal", "natural"], [2400, 2400, 60], ["커튼", "curtain", "쉬어", "블라인드"], "plane", ["mat_linen"]),
  asset("asset_blind_wood", "우드 블라인드", "decoration", "decoration", ["natural", "japandi"], [1500, 1400, 60], ["블라인드", "blind", "우드", "창"], "plane", ["mat_oak"]),

  // ── 장식 ──
  asset("asset_art_large", "대형 아트 액자", "decoration", "decoration", ["contemporary", "luxury"], [1400, 1000, 40], ["액자", "art", "그림", "대형"], "plane", ["mat_oak"]),
  asset("asset_gallery_set", "갤러리월 3점 세트", "decoration", "decoration", ["modern", "minimal"], [1500, 600, 40], ["액자", "갤러리월", "세트", "art"], "plane", ["mat_black_steel"]),
  asset("asset_floor_mirror", "전신 거울", "decoration", "decoration", ["minimal", "contemporary"], [600, 1700, 60], ["거울", "mirror", "전신", "스탠드"], "plane", ["mat_brass"]),
  asset("asset_vase_set", "화병 세트", "decoration", "decoration", ["japandi", "minimal"], [300, 400, 300], ["화병", "vase", "오브제", "소품"], "cylinder", ["mat_white_paint"]),
  asset("asset_basket", "라탄 바스켓", "decoration", "decoration", ["natural", "warm"], [450, 400, 450], ["바스켓", "basket", "라탄", "수납"], "cylinder", ["mat_linen"]),

  // ── 식물 ──
  asset("asset_plant_olive", "올리브 나무", "plant", "plant", ["natural", "warm"], [800, 1800, 800], ["식물", "plant", "올리브", "나무"], "cylinder", ["mat_green_plant"]),
  asset("asset_plant_monstera", "몬스테라", "plant", "plant", ["natural", "contemporary"], [900, 1300, 900], ["식물", "plant", "몬스테라", "잎"], "cylinder", ["mat_green_plant"]),
  asset("asset_plant_hanging", "행잉 플랜트", "plant", "plant", ["natural", "minimal"], [400, 700, 400], ["식물", "plant", "행잉", "hanging"], "sphere", ["mat_green_plant"]),

  // ── 가전 ──
  asset("asset_fridge_4door", "4도어 냉장고", "appliance", "appliance", ["modern", "contemporary"], [900, 1850, 800], ["냉장고", "fridge", "가전", "주방"], "box", ["mat_black_steel"]),
  asset("asset_washer", "드럼 세탁기", "appliance", "appliance", ["modern", "minimal"], [600, 850, 650], ["세탁기", "washer", "가전", "베란다"], "box", ["mat_white_paint"]),
  asset("asset_aircon_stand", "스탠드 에어컨", "appliance", "appliance", ["modern", "minimal"], [350, 1800, 350], ["에어컨", "aircon", "가전", "스탠드"], "box", ["mat_white_paint"]),
  asset("asset_tv_55", "55인치 TV", "tv", "appliance", ["modern", "minimal"], [1240, 720, 60], ["tv", "티비", "55", "텔레비전"], "plane", ["mat_black_steel"]),
  asset("asset_projector_screen", "빔 스크린", "tv", "appliance", ["minimal", "contemporary"], [2000, 1200, 40], ["빔", "프로젝터", "스크린", "projector"], "plane", ["mat_white_paint"]),
];

/**
 * 내려받은 CC0 메시를 카탈로그에 입힌다 (scripts/assets/polyhaven.mjs).
 *
 * 치수도 모델의 실제 경계 상자로 바꾼다. 손으로 적어 둔 mm를 그대로 두면
 * 3D는 모델을 그 상자에 욱여넣어 보여 주는데, 평면도의 발자국과 눈에 보이는 형태가
 * 서로 어긋난다 — 도면과 3D가 같은 가구를 그려야 한다.
 */
function withModels(assets: Asset[]): Asset[] {
  const extra: Asset[] = POLYHAVEN_EXTRA.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    type: item.type,
    style: item.style,
    dimensions: item.dimensions,
    thumbnailUrl: `/api/assets/thumbnail/${item.id}`,
    modelUrl: item.modelUrl,
    primitive: "box",
    materials: item.materials,
    tags: item.tags,
    embedding: null,
  }));

  const dressed = assets.map((asset) => {
    const model = POLYHAVEN_MODELS[asset.id];
    return model
      ? { ...asset, modelUrl: model.modelUrl, dimensions: model.dimensions }
      : asset;
  });

  return [...dressed, ...extra];
}

export const ASSETS: Asset[] = withModels(BASE_ASSETS);

export const ASSET_MAP: Record<string, Asset> = Object.fromEntries(
  ASSETS.map((a) => [a.id, a])
);

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
