import { withPersistGuard } from "@/lib/persist-guard";
import { getViewer } from "@/lib/auth";
import { loadProject, persist } from "@/services/projectService";
import { generateProductImage } from "@/lib/image-api";
import { estimateFurniture } from "@/ai/providers/vision";
import { getStorage } from "@/lib/storage";
import { createId } from "@/scene/engine/SceneEngine";
import { planCenter, worldXZ } from "@/scene/placement";

/**
 * 설명으로 가구를 만들어 씬에 넣는다.
 *
 * 텍스트 → 3D 메시가 아니라 텍스트 → 이미지 → 3D 배치다.
 * 이미지는 흰 배경의 정면 사진으로 만들고, 편집기가 배경을 지워 판으로 세운다.
 * 크기는 이미지가 알려 주지 않으므로 따로 한 번 물어본다 — 평면도에 발자국을 그리려면 mm가 있어야 한다.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return withPersistGuard(async () => {
    const { id } = await ctx.params;
    const viewer = await getViewer();

    const loaded = await loadProject(id, viewer.userId);
    if (!loaded) return Response.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

    let body: { description?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
    }

    const description = body.description?.trim();
    if (!description) return Response.json({ error: "만들 가구를 설명해 주세요." }, { status: 400 });
    if (description.length > 200) {
      return Response.json({ error: "설명이 너무 깁니다 (200자 이내)." }, { status: 400 });
    }

    // 이미지와 치수는 서로를 기다릴 이유가 없다.
    const [image, estimate] = await Promise.all([
      generateProductImage(description).catch((error: unknown) => error as Error),
      estimateFurniture(description),
    ]);

    if (image instanceof Error) {
      return Response.json({ error: image.message }, { status: 502 });
    }

    const extension = image.mimeType.includes("svg")
      ? "svg"
      : image.mimeType.includes("jpeg")
        ? "jpg"
        : "png";

    const imageUrl = await getStorage().upload(
      `projects/${id}/assets/${createId("gen")}.${extension}`,
      image.data,
      image.mimeType
    );

    const scene = loaded.engine.getScene();
    const room = scene.room;

    /* 방 한가운데, 이미 있는 가구를 피해 조금 비껴 놓는다 */
    const screen = { x: 0.5 - estimate.dimensions.width / room.dimensions.width / 2, width: estimate.dimensions.width / room.dimensions.width };
    const depth = 0.5;
    const [x, z] = worldXZ(planCenter(screen, depth, room), room);

    const result = loaded.engine.addObject({
      type: estimate.type,
      name: estimate.name,
      category: estimate.type,
      dimensions: estimate.dimensions,
      imageUrl,
      screen: { x: screen.x, y: 0.35, width: screen.width, height: 0.4, rotation: 0 },
      transform: {
        position: [x, estimate.dimensions.height / 2000, z],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      depth,
      confidence: 0.9,
      source: "ai_command",
      metadata: { generatedFrom: description },
    });

    if (!result.ok) {
      return Response.json({ error: result.error ?? "씬에 넣지 못했습니다." }, { status: 400 });
    }

    const project = await persist(loaded);

    return Response.json({
      ok: true,
      scene: project.scene,
      objectId: result.operation?.objectId ?? null,
      imageUrl,
      name: estimate.name,
      canUndo: loaded.engine.canUndo(),
      canRedo: loaded.engine.canRedo(),
    });
  });
}
