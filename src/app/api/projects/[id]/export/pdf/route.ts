import { getViewer } from "@/lib/auth";
import { loadProject } from "@/services/projectService";
import { buildPlanSvg, toPlanData } from "@/services/cadExport";
import { buildElevationSvg } from "@/services/elevationExport";
import { buildPdf, type PdfSheet } from "@/services/pdfExport";

/**
 * 도면 한 부를 PDF 로 만든다.
 *
 * 평면도 → 입면도(벽마다 한 장) → 3D 순서다. 시공사가 도면을 보는 순서와 같다 —
 * 먼저 배치를 보고, 벽을 하나씩 확인하고, 마지막에 완성 이미지를 본다.
 *
 * GET 으로도 열리고 POST 로도 열린다.
 *   GET  — 평면도와 입면도만. 주소만 알면 되니 링크로 걸 수 있다.
 *   POST — 3D 캡처를 함께 보낸다. 3D는 브라우저의 캔버스에만 있어서 서버가
 *          직접 만들 수 없다(헤드리스 WebGL이 필요하다). 그래서 편집기가 찍어 보낸다.
 */

/** 3D 캡처 허용 크기 — 4K 캔버스 PNG 도 넉넉히 들어간다 */
const MAX_VIEWPORT_BYTES = 12 * 1024 * 1024;

async function buildResponse(id: string, viewport: Buffer | null) {
  const viewer = await getViewer();
  const loaded = await loadProject(id, viewer.userId);
  if (!loaded) {
    return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  }

  const scene = loaded.engine.getScene();
  const plan = toPlanData(scene, loaded.project.name);

  const sheets: PdfSheet[] = [{ title: "평면도", svg: buildPlanSvg(plan) }];

  /*
   * 입면도는 벽마다 한 장씩 낸다.
   *
   * 개구부가 많은 벽부터 앞에 둔다 — 창·문이 있는 벽이 시공에서 가장 먼저 필요하다.
   * 벽이 아주 많은 도면(복도가 잘게 나뉜 평면 등)에서 종이가 수십 장이 되지 않게
   * 위에서부터 여덟 장까지만 낸다.
   */
  const walls = [...plan.walls].sort(
    (a, b) => (b.openings?.length ?? 0) - (a.openings?.length ?? 0)
  );

  for (const wall of walls.slice(0, 8)) {
    sheets.push({
      title: `입면도 — ${wall.name || wall.id}`,
      svg: buildElevationSvg({ plan, wall }),
    });
  }

  if (viewport) sheets.push({ title: "3D", png: viewport });

  try {
    const { bytes, included, skipped } = await buildPdf(sheets);
    /*
     * 파일 이름은 통째로 인코딩한다.
     *
     * 헤더 값은 바이트 하나짜리 글자만 담을 수 있어서 한글이 그대로 들어가면
     * 응답 자체가 500으로 죽는다. "_도면.pdf" 를 밖에 두었다가 그렇게 됐다 —
     * 프로젝트 이름만 인코딩하고 뒤에 붙인 한글은 놓쳤다.
     */
    const name = loaded.project.name.replace(/[^가-힣a-zA-Z0-9_-]/g, "_");
    const filename = encodeURIComponent(`${name}_도면.pdf`);

    return new Response(bytes as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        // filename* 는 UTF-8 이름을 제대로 읽는 브라우저용, filename 은 그 밖의 경우
        "Content-Disposition": `attachment; filename="drawing.pdf"; filename*=UTF-8''${filename}`,
        // 몇 장이 담겼고 무엇이 빠졌는지 — 편집기가 이걸 읽어 사용자에게 알려 준다
        "X-Sheets": encodeURIComponent(included.join(", ")),
        "X-Skipped": encodeURIComponent(skipped.join(", ")),
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "PDF를 만들지 못했습니다." },
      { status: 500 }
    );
  }
}

/** 평면도 + 입면도만 (3D 없이) */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return buildResponse(id, null);
}

/** 3D 캡처를 함께 받아 마지막 장에 넣는다 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let viewport: Buffer | null = null;

  try {
    const body = (await request.json()) as { viewport?: string };
    const dataUrl = body.viewport;

    if (dataUrl?.startsWith("data:image/png;base64,")) {
      const base64 = dataUrl.slice("data:image/png;base64,".length);
      const bytes = Buffer.from(base64, "base64");
      // 터무니없이 큰 것은 받지 않는다 — 캔버스 캡처가 아니라는 뜻이다
      if (bytes.byteLength <= MAX_VIEWPORT_BYTES) viewport = bytes;
    }
  } catch {
    // 3D 없이 낸다 — 도면 자체는 서버가 만들 수 있다
  }

  return buildResponse(id, viewport);
}
