import { getViewer } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { createAdminSupabase, createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { deleteComment, memoryDeleteComment } from "@/lib/community";

/**
 * 댓글 삭제.
 * 쓴 사람과 시안 주인은 사용자 세션으로 지운다 (RLS 가 본다).
 * 관리자는 서비스 롤로 지운다 — 갤러리 정리는 관리자 몫이다.
 */
export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ slug: string; commentId: string }> }
) {
  const { slug, commentId } = await ctx.params;

  if (!isSupabaseConfigured()) {
    const ok = memoryDeleteComment(decodeURIComponent(slug), commentId);
    return ok
      ? Response.json({ ok: true })
      : Response.json({ error: "댓글을 찾을 수 없습니다." }, { status: 404 });
  }

  const viewer = await getViewer();
  if (!viewer.userId) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const supabase = await createServerSupabase();
  if (!supabase) return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  let ok = await deleteComment(supabase, commentId);

  if (!ok && isAdminEmail(viewer.authEmail)) {
    const writer = createAdminSupabase();
    if (writer) ok = await deleteComment(writer, commentId);
  }

  if (!ok)
    return Response.json(
      { error: "내가 쓴 댓글이나 내 시안의 댓글만 지울 수 있습니다." },
      { status: 403 }
    );
  return Response.json({ ok: true });
}
