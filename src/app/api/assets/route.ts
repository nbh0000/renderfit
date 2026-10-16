import { ALL_ASSETS } from "@/models/catalog";

/**
 * 카탈로그 목록.
 *
 * Poly Pizza 무료 모델까지 합치면 2천 종이 넘는다. 분류·종류로 거르지 않고 부르면
 * 응답이 수 MB가 되므로 limit 을 둔다(기본 200).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const type = url.searchParams.get("type");
  const limit = Math.min(1000, Number(url.searchParams.get("limit") ?? 200) || 200);

  const assets = ALL_ASSETS.filter((asset) => {
    if (category && asset.category !== category) return false;
    if (type && asset.type !== type) return false;
    return true;
  });

  return Response.json({ assets: assets.slice(0, limit), total: assets.length });
}
