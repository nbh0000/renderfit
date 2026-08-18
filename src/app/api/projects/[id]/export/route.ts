import { getViewer } from "@/lib/auth";
import { loadProject } from "@/services/projectService";
import { sceneToJSON } from "@/scene/serialization";
import { renderSceneToSvg } from "@/ai/providers/mock/sceneRaster";
import { buildDxf, buildPlanSvg, toPlanData } from "@/services/cadExport";

/**
 * Export.
 * - scene: Scene JSON
 * - project: 프로젝트 전체 JSON (operations/versions 포함)
 * - image: 현재 장면 이미지 (SVG). PNG/JPG/WebP 변환은 클라이언트 canvas에서 수행한다.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const format = url.searchParams.get("format") ?? "scene";

  const viewer = await getViewer();
  const loaded = await loadProject(id, viewer.userId);
  if (!loaded) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

  const scene = loaded.engine.getScene();
  const filenameBase = loaded.project.name.replace(/[^가-힣a-zA-Z0-9_-]/g, "_");

  if (format === "scene") {
    return new Response(sceneToJSON(scene), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filenameBase)}_scene.json"`,
      },
    });
  }

  if (format === "project") {
    return new Response(JSON.stringify(loaded.project, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filenameBase)}_project.json"`,
      },
    });
  }

  if (format === "dxf") {
    const plan = toPlanData(scene, loaded.project.name);
    return new Response(buildDxf(plan), {
      headers: {
        "Content-Type": "application/dxf",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filenameBase)}_plan.dxf"`,
      },
    });
  }

  if (format === "plan") {
    const plan = toPlanData(scene, loaded.project.name);
    return new Response(buildPlanSvg(plan), {
      headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
    });
  }

  if (format === "image") {
    return new Response(renderSceneToSvg(scene), {
      headers: { "Content-Type": "image/svg+xml; charset=utf-8" },
    });
  }

  // TODO: GLB export — Three.js GLTFExporter를 서버에서 돌리려면 헤드리스 환경이 필요하다.
  //       현재는 3D 뷰에서 클라이언트 사이드 export로 처리한다.
  return Response.json({ error: "지원하지 않는 형식입니다." }, { status: 400 });
}
