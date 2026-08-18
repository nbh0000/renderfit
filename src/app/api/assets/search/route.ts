import { searchAssets } from "@/models/assets";
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
  const assets = searchAssets(query, Math.min(50, body.limit ?? 12));

  // TODO(pgvector): embedding 검색으로 교체. 지금은 결과 재정렬에 쓰지 않고 계산만 준비해 둔다.
  if (query) {
    void createProviders().embedding.embed(query).catch(() => null);
  }

  return Response.json({ assets, query });
}
