import { getViewer } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { memoryPublish, publishResult, unpublishResult } from "@/lib/gallery";

/**
 * 생성물 공개(갤러리 노출) 동의 처리.
 * 공개하면 "{방종류}-{스타일}-인테리어" slug로 SEO 페이지가 자동 생성된다.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: {
    isPublic?: boolean;
    // 로컬 mock 모드에서만 사용
    imageUrl?: string;
    roomId?: string;
    styleId?: string;
    width?: number;
    height?: number;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const viewer = await getViewer();

  /* 로컬 mock 모드 */
  if (!viewer.configured) {
    if (body.isPublic === false) {
      return Response.json({ ok: true, slug: null });
    }
    if (!body.imageUrl || !body.roomId || !body.styleId) {
      return Response.json({ error: "공개할 이미지 정보가 부족합니다." }, { status: 400 });
    }
    const item = memoryPublish({
      imageUrl: body.imageUrl,
      roomId: body.roomId as never,
      styleId: body.styleId as never,
      roomLabel: "",
      styleLabel: "",
      width: body.width ?? 1024,
      height: body.height ?? 768,
      createdAt: new Date().toISOString(),
    });
    return Response.json({ ok: true, slug: item.slug });
  }

  if (!viewer.userId) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const supabase = await createServerSupabase();
  if (!supabase) return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  if (body.isPublic === false) {
    const ok = await unpublishResult(supabase, id);
    return ok
      ? Response.json({ ok: true, slug: null })
      : Response.json({ error: "공개 설정을 바꾸지 못했습니다." }, { status: 500 });
  }

  // 방/스타일은 소유한 job에서 읽는다 (RLS로 본인 것만 조회된다).
  const { data, error } = await supabase
    .from("generation_results")
    .select("id, generation_jobs!inner (room_id, style_id)")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return Response.json({ error: "해당 시안을 찾을 수 없습니다." }, { status: 404 });
  }

  const job = (data as unknown as { generation_jobs: { room_id: string; style_id: string } })
    .generation_jobs;

  const published = await publishResult(supabase, id, job.room_id, job.style_id);
  if (!published) {
    return Response.json({ error: "공개 처리에 실패했습니다." }, { status: 500 });
  }

  return Response.json({ ok: true, slug: published.slug });
}
