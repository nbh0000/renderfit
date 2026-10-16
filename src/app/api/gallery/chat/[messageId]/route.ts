import { getViewer } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { createAdminSupabase, createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { deleteChat, memoryDeleteChat } from "@/lib/community";

/** 메시지 삭제 — 쓴 사람은 사용자 세션으로(RLS), 관리자는 서비스 롤로 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await ctx.params;

  if (!isSupabaseConfigured()) {
    return memoryDeleteChat(messageId)
      ? Response.json({ ok: true })
      : Response.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
  }

  const viewer = await getViewer();
  if (!viewer.userId) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const supabase = await createServerSupabase();
  if (!supabase) return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  let ok = await deleteChat(supabase, messageId);

  if (!ok && isAdminEmail(viewer.authEmail)) {
    const writer = createAdminSupabase();
    if (writer) ok = await deleteChat(writer, messageId);
  }

  if (!ok) return Response.json({ error: "내가 보낸 메시지만 지울 수 있습니다." }, { status: 403 });
  return Response.json({ ok: true });
}
