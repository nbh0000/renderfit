import { getViewer } from "@/lib/auth";
import { createAdminSupabase, createServerSupabase } from "@/lib/supabase/server";
import { displayNameFor, memoryPublish, publishResult, unpublishResultById } from "@/lib/gallery";
import { RESULTS_BUCKET, SOURCES_BUCKET } from "@/lib/supabase/env";

/**
 * 생성물 공개(갤러리 노출) 동의 처리.
 * 공개하면 "{방종류}-{스타일}-인테리어" slug로 SEO 페이지가 자동 생성된다.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  let body: {
    isPublic?: boolean;
    /**
     * 이름 없이 올린다.
     *
     * 남의 집 사진이다. 스타일은 자랑하고 싶어도 자기 이름이 붙는 것은 꺼리는 사람이
     * 많아서, 그 한 가지 때문에 공개를 안 누른다. 갤러리는 시안이 쌓여야 사는 곳이라
     * 이름을 빼는 선택지를 준다. (표시는 "익명"으로 나간다)
     */
    anonymous?: boolean;
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
      authorName: "나",
      beforeUrl: null,
    });
    return Response.json({ ok: true, slug: item.slug });
  }

  if (!viewer.userId) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const supabase = await createServerSupabase();
  if (!supabase) return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  /*
   * 공개 여부를 적는 것은 서비스 롤로 한다.
   *
   * generation_results 는 사용자 세션으로 고칠 수 없게 막혀 있다 — status나
   * credits_charged 를 사용자가 고쳐 쓰지 못하게 하려고 UPDATE 권한을 통째로
   * 거둬들였기 때문이다(migrations-profile-lockdown.sql). 그 바람에 갤러리 공개도
   * 함께 막혀서 "공개 처리에 실패했습니다"만 돌아왔다.
   *
   * 대신 소유 확인을 우리가 직접 한다 — 아래 조회의 user_id 조건과, 갱신 자체에
   * 붙는 user_id 조건 두 군데다.
   */
  const writer = createAdminSupabase();
  if (!writer) {
    return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });
  }

  if (body.isPublic === false) {
    const ok = await unpublishResultById(writer, id, viewer.userId);
    return ok
      ? Response.json({ ok: true, slug: null })
      : Response.json({ error: "공개 설정을 바꾸지 못했습니다." }, { status: 500 });
  }

  // 방/스타일은 소유한 job에서 읽는다. 공개된 남의 시안도 조회는 되므로 user_id로 못 박는다.
  const { data, error } = await supabase
    .from("generation_results")
    .select("id, generation_jobs!inner (room_id, style_id)")
    .eq("id", id)
    .eq("user_id", viewer.userId)
    .maybeSingle();

  if (error || !data) {
    return Response.json({ error: "해당 시안을 찾을 수 없습니다." }, { status: 404 });
  }

  const job = (data as unknown as { generation_jobs: { room_id: string; style_id: string } })
    .generation_jobs;

  const published = await publishResult(writer, id, viewer.userId, job.room_id, job.style_id);
  if (!published) {
    return Response.json({ error: "공개 처리에 실패했습니다." }, { status: 500 });
  }

  /*
   * 갤러리에 보여 줄 값들을 공개 시점에 확정한다.
   * profiles는 본인만 조회할 수 있어 갤러리에서 조인이 안 되므로 이름을 복사해 둔다.
   */
  const { data: profile } = body.anonymous
    ? { data: null }
    : await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", viewer.userId)
        .maybeSingle();

  const beforePath = await copySourceForGallery(writer, id, viewer.userId);

  // 갤러리 컬럼이 아직 없는 DB에서는 조용히 넘어간다 (공개 자체는 이미 끝났다).
  const { error: metaError } = await writer
    .from("generation_results")
    .update({
      // 익명이면 이름 칸을 비운다. 갤러리는 빈 칸을 "익명"으로 읽는다.
      author_name: body.anonymous ? null : displayNameFor(profile ?? {}),
      ...(beforePath ? { before_path: beforePath } : {}),
    })
    .eq("id", id)
    .eq("user_id", viewer.userId);

  if (metaError && metaError.code !== "42703") {
    console.warn("갤러리 메타 기록 실패", metaError.message);
  }

  return Response.json({ ok: true, slug: published.slug });
}

/**
 * 전/후 비교용 원본 사본을 공개 버킷으로 옮긴다.
 *
 * 원본은 비공개 sources 버킷에 있어 갤러리 방문자가 볼 수 없다.
 * 공개에 동의한 시안에 한해 사본을 만들고, 공개를 해제하면 다시 지운다.
 * 실패해도 공개 자체는 유지한다 — 비교 슬라이더만 빠진다.
 */
async function copySourceForGallery(
  supabase: NonNullable<ReturnType<typeof createAdminSupabase>>,
  resultId: string,
  userId: string
): Promise<string | null> {
  try {
    const { data: result } = await supabase
      .from("generation_results")
      .select("job_id, generation_jobs!inner (source_path)")
      .eq("id", resultId)
      .eq("user_id", userId)
      .maybeSingle();

    const sourcePath = (result as unknown as { generation_jobs: { source_path: string | null } })
      ?.generation_jobs?.source_path;
    if (!sourcePath) return null;

    const { data: file } = await supabase.storage.from(SOURCES_BUCKET).download(sourcePath);
    if (!file) return null;

    const extension = sourcePath.split(".").pop() || "jpg";
    const target = `${userId}/gallery/${resultId}-before.${extension}`;

    const { error } = await supabase.storage
      .from(RESULTS_BUCKET)
      .upload(target, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type || "image/jpeg",
        upsert: true,
      });

    return error ? null : target;
  } catch {
    return null;
  }
}
