import { getViewer } from "@/lib/auth";
import {
  guessType,
  isExternalSourceEnabled,
  searchExternalModels,
  toAsset,
} from "@/models/sources/polyPizza";

/**
 * 무료 3D 모델 검색.
 *
 * 내장 카탈로그로 부족한 가구를 외부 소스에서 찾아 온다.
 * 결과는 Scene이 그대로 쓰는 Asset 형태로 돌려주고, 라이선스 표기를 함께 담는다.
 */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (viewer.configured && !viewer.userId) {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  if (!isExternalSourceEnabled()) {
    return Response.json({
      enabled: false,
      assets: [],
      message:
        "무료 모델 검색을 쓰려면 POLY_PIZZA_API_KEY가 필요합니다. poly.pizza/api 에서 무료로 발급받아 환경변수에 넣어 주세요.",
    });
  }

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query) return Response.json({ enabled: true, assets: [] });

  const models = await searchExternalModels(query);

  return Response.json({
    enabled: true,
    assets: models.map((model) => ({
      ...toAsset(model, guessType(query, model.name)),
      attribution: model.attribution,
      license: model.license,
      sourceUrl: model.sourceUrl,
    })),
  });
}
