import type { Asset, ObjectType } from "@/scene/types";
import { ASSETS, scoreAsset } from "./assets";
import { POLYPIZZA_ASSETS } from "./polypizza";

/**
 * 서버가 보는 전체 카탈로그 — 손으로 짠 기본 항목 + Poly Pizza 무료 모델.
 *
 * 이 파일은 API 라우트에서만 부른다. 편집기(브라우저)는 `models/assets.ts` 의
 * 기본 항목만 번들에 담고, 나머지는 /api/assets/search 로 받아 간다.
 *
 * 순서가 중요하다. 기본 항목이 앞에 오게 두어야 같은 점수일 때 국내 규격에 맞춰
 * 치수를 적어 둔 쪽이 먼저 뽑힌다 — Poly Pizza 모델의 치수는 비례로 환산한 값이다.
 */
export const ALL_ASSETS: Asset[] = [...ASSETS, ...POLYPIZZA_ASSETS];

export const ALL_ASSET_MAP: Record<string, Asset> = Object.fromEntries(
  ALL_ASSETS.map((asset) => [asset.id, asset])
);

export function searchCatalog(query: string, limit = 12): Asset[] {
  if (!query.trim()) return ALL_ASSETS.slice(0, limit);

  return ALL_ASSETS.map((asset) => ({ asset, score: scoreAsset(asset, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.asset);
}

/**
 * 분류별로 고르게 잘라 준다.
 *
 * 검색어 없이 목록을 펼 때 앞에서부터 자르면 소파 수백 개가 한도를 다 먹고
 * 침대·러그가 한 개도 안 보인다. 분류마다 같은 수만큼 담는다.
 */
export function catalogByCategory(perCategory = 60): Asset[] {
  const counts = new Map<string, number>();
  const picked: Asset[] = [];

  for (const asset of ALL_ASSETS) {
    const seen = counts.get(asset.category) ?? 0;
    if (seen >= perCategory) continue;
    counts.set(asset.category, seen + 1);
    picked.push(asset);
  }

  return picked;
}

export function catalogByType(type: ObjectType): Asset[] {
  return ALL_ASSETS.filter((asset) => asset.type === type);
}
