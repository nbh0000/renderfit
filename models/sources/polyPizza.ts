import type { Asset, ObjectType } from "@/scene/types";

/**
 * 무료 3D 모델 소스 — Poly Pizza.
 *
 * 내장 카탈로그(76종)만으로는 실제 배치가 안 된다. Poly Pizza는 CC0/CC-BY로 풀린
 * 수천 개의 glTF 모델을 검색·다운로드할 수 있어서, 라이선스를 지키면서 붙일 수 있는
 * 몇 안 되는 소스다.
 *
 * 키는 무료로 발급받아 POLY_PIZZA_API_KEY 로 넣는다(https://poly.pizza/api).
 * 키가 없으면 검색이 비활성화되고 내장 카탈로그만 쓴다 — 앱은 어떤 경우에도 동작해야 한다.
 *
 * ⚠ 라이선스: CC-BY 모델은 저작자 표시가 필요하다. 결과에 attribution을 함께 담아
 *   Scene에 저장하고 화면에도 노출한다.
 */

const ENDPOINT = "https://api.poly.pizza/v1/search";

export interface ExternalModel {
  id: string;
  name: string;
  /** glTF/GLB 다운로드 URL */
  modelUrl: string;
  thumbnailUrl: string;
  /** 저작자 표시 문구 (CC-BY) */
  attribution: string;
  license: string;
  /** 원본 페이지 */
  sourceUrl: string;
}

export function isExternalSourceEnabled(): boolean {
  return Boolean(process.env.POLY_PIZZA_API_KEY);
}

interface RawResult {
  ID?: string;
  Title?: string;
  Download?: string;
  Thumbnail?: string;
  Creator?: { Username?: string; DisplayName?: string };
  Licence?: string;
  Attribution?: string;
}

/** 검색어로 무료 모델을 찾는다. 키가 없거나 실패하면 빈 배열 */
export async function searchExternalModels(
  query: string,
  limit = 24
): Promise<ExternalModel[]> {
  const key = process.env.POLY_PIZZA_API_KEY;
  if (!key || !query.trim()) return [];

  try {
    const url = `${ENDPOINT}/${encodeURIComponent(query.trim())}?limit=${limit}`;
    const response = await fetch(url, {
      headers: { "x-auth-token": key },
      // 검색 결과는 자주 바뀌지 않는다.
      next: { revalidate: 3600 },
    });
    if (!response.ok) return [];

    const data = (await response.json()) as { results?: RawResult[] };

    return (data.results ?? [])
      .filter((item) => item.ID && item.Download)
      .map((item) => {
        const creator = item.Creator?.DisplayName || item.Creator?.Username || "Unknown";
        return {
          id: `poly_${item.ID}`,
          name: item.Title?.trim() || "모델",
          modelUrl: item.Download!,
          thumbnailUrl: item.Thumbnail ?? "",
          attribution: item.Attribution || `${item.Title ?? "Model"} by ${creator}`,
          license: item.Licence || "CC-BY",
          sourceUrl: `https://poly.pizza/m/${item.ID}`,
        };
      });
  } catch {
    return [];
  }
}

/**
 * 외부 모델을 Scene이 쓰는 Asset 형태로 바꾼다.
 *
 * 외부 모델은 실제 크기 정보가 없는 경우가 많아, 종류별 표준 치수를 기본값으로 준다.
 * 사용자가 가구 목록 표에서 mm 단위로 고칠 수 있으므로 시작점만 맞으면 된다.
 */
const DEFAULT_SIZE: Partial<Record<ObjectType, [number, number, number]>> = {
  sofa: [2000, 800, 900],
  chair: [500, 850, 550],
  table: [1200, 750, 700],
  cabinet: [900, 1800, 450],
  bed: [1500, 600, 2000],
  lamp: [350, 1500, 350],
  plant: [500, 1200, 500],
  rug: [2000, 20, 1400],
  tv: [1200, 700, 80],
  appliance: [600, 1800, 650],
  decoration: [300, 400, 300],
};

export function toAsset(model: ExternalModel, type: ObjectType): Asset {
  const [width, height, depth] = DEFAULT_SIZE[type] ?? [600, 600, 600];

  return {
    id: model.id,
    name: model.name,
    category: "external",
    type,
    style: [],
    dimensions: { width, height, depth },
    thumbnailUrl: model.thumbnailUrl || `/api/assets/thumbnail/${model.id}`,
    modelUrl: model.modelUrl,
    primitive: "box",
    materials: [],
    tags: [model.license, "poly.pizza"],
    embedding: null,
  };
}

/** 검색어에서 객체 종류를 추측한다 — 카탈로그 분류와 3D 배치 규칙에 쓴다 */
export function guessType(query: string, name: string): ObjectType {
  const text = `${query} ${name}`.toLowerCase();
  const table: [string[], ObjectType][] = [
    [["sofa", "couch", "소파"], "sofa"],
    [["chair", "stool", "의자"], "chair"],
    [["table", "desk", "테이블", "책상"], "table"],
    [["cabinet", "shelf", "wardrobe", "장", "선반"], "cabinet"],
    [["bed", "침대"], "bed"],
    [["lamp", "light", "조명", "램프"], "lamp"],
    [["plant", "tree", "화분", "식물"], "plant"],
    [["rug", "carpet", "러그", "카펫"], "rug"],
    [["tv", "television", "모니터"], "tv"],
    [["fridge", "oven", "washer", "가전"], "appliance"],
  ];

  for (const [keywords, type] of table) {
    if (keywords.some((keyword) => text.includes(keyword))) return type;
  }
  return "decoration";
}
