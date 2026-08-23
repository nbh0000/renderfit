import { withPersistGuard } from "@/lib/persist-guard";
import { getViewer } from "@/lib/auth";
import { attachImage, loadProject } from "@/services/projectService";
import { validateImageFile } from "@/lib/upload";

/** 방 사진 업로드 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withPersistGuard(async () => {
    const { id } = await ctx.params;
    const viewer = await getViewer();

    const loaded = await loadProject(id, viewer.userId);
    if (!loaded) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const file = form.get("image");
    if (!(file instanceof File)) {
      return Response.json({ error: "이미지를 업로드해 주세요." }, { status: 400 });
    }

    const check = validateImageFile(file);
    if (!check.ok) return Response.json({ error: check.message }, { status: 400 });

    // 도면은 사진과 분석 방식이 다르다 — 무엇을 올렸는지 함께 받아 Scene에 남긴다.
    const kindField = form.get("kind");
    const kind = kindField === "floorplan" ? "floorplan" : "photo";

    const project = await attachImage(loaded, {
      buffer: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type,
      name: file.name,
      kind,
    });

    return Response.json({ imageUrl: project.scene.source.imageUrl, project });
  });
}
