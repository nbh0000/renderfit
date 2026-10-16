import type { Asset } from "@/scene/types";
import { POLYPIZZA_MODELS } from "./polypizza.generated";

/**
 * Poly Pizza 무료 모델을 카탈로그 항목으로 바꾼다.
 *
 * 목록은 scripts/assets/polypizza.mjs 가 구워 둔다(2천 종이 넘는다). 이 파일은
 * **서버에서만** 읽는다 — 편집기 번들에 들어가면 2MB 가까운 목록을 브라우저가
 * 통째로 받는다. 편집기는 /api/assets/search 로 필요한 만큼만 받아 간다.
 *
 * 모델 파일은 static.poly.pizza 를 그대로 가리킨다(CORS 가 열려 있다).
 * 저장소에 500MB 를 넣거나 빌드마다 다시 받을 이유가 없다.
 */
export const POLYPIZZA_ASSETS: Asset[] = POLYPIZZA_MODELS.map((model) => ({
  id: model.id,
  name: model.name,
  category: model.category,
  type: model.type,
  style: [],
  dimensions: model.dimensions,
  thumbnailUrl: model.thumbnailUrl || `/api/assets/thumbnail/${model.id}`,
  modelUrl: model.modelUrl,
  primitive: "box",
  materials: [],
  /* 검색어에 라이선스와 출처도 넣어 두면 "CC0" 로 걸러 볼 수 있다 */
  tags: [...model.tags, model.license, "poly.pizza"],
  embedding: null,
  attribution: model.attribution,
  license: model.license,
  sourceUrl: model.sourceUrl,
}));
