import { STYLE_MAP, type StyleId } from "@/config/styles";
import { roomSceneSvg, styleThumbSvg } from "@/lib/placeholder-svg";

function svgResponse(svg: string) {
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

export async function GET(
  request: Request,
  ctx: { params: Promise<{ slug: string[] }> }
) {
  const { slug } = await ctx.params;
  const url = new URL(request.url);
  const [kind, key] = slug;

  if (kind === "style") {
    const style = STYLE_MAP[key as StyleId];
    return svgResponse(styleThumbSvg(style?.label ?? "스타일", style?.tone ?? "#C0BCB4"));
  }

  if (kind === "hero") {
    const isAfter = key === "after";
    return svgResponse(
      roomSceneSvg({
        width: 1200,
        height: 800,
        tone: isAfter ? "#C08A5C" : "#9C9A96",
        seed: isAfter ? "hero-after" : "hero-before",
        // 슬라이더가 자체 라벨을 그리므로 이미지 안에는 캡션을 넣지 않는다.
      })
    );
  }

  // /api/placeholder/result?room=&style=&mode=&i=&size=
  const room = url.searchParams.get("room") ?? "";
  const style = url.searchParams.get("style") ?? "";
  const mode = url.searchParams.get("mode") ?? "";
  const index = url.searchParams.get("i") ?? "1";
  const size = Math.min(Number(url.searchParams.get("size") ?? 1024) || 1024, 2048);

  return svgResponse(
    roomSceneSvg({
      width: size,
      height: Math.round((size * 3) / 4),
      tone: STYLE_MAP[style as StyleId]?.tone ?? "#B79A78",
      seed: `${room}-${style}-${mode}-${index}`,
      caption: [room, style].filter(Boolean).join(" · ") || "생성 결과",
      subCaption: `mock 시안 ${index} · ${mode}`,
    })
  );
}
