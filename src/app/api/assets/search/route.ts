import { catalogByCategory, searchCatalog } from "@/models/catalog";
import { createProviders } from "@/ai/providers";

/**
 * 에셋 검색.
 * 현재는 키워드 스코어링. embedding provider가 실제 모델로 교체되면
 * pgvector 유사도 검색으로 확장한다(인터페이스는 그대로).
 */
export async function POST(request: Request) {
  let body: { query?: string; limit?: number };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const query = (body.query ?? "").trim();

  /*
   * 검색할 때와 그냥 펼칠 때가 다르다.
   *
   * 검색은 점수 순으로 잘라도 되지만, 검색어 없이 목록을 펼 때 앞에서부터 자르면
   * 소파가 한도를 다 먹고 침대·러그가 한 개도 안 보인다. 그때는 분류별로 고르게 담는다.
   */
  const limit = Math.min(1000, body.limit ?? 12);
  const assets = query ? searchCatalog(query, limit) : catalogByCategory(60);

  // TODO(pgvector): embedding 검색으로 교체. 지금은 결과 재정렬에 쓰지 않고 계산만 준비해 둔다.
  if (query) {
    void createProviders().embedding.embed(query).catch(() => null);
  }

  return Response.json({ assets, query });
}
