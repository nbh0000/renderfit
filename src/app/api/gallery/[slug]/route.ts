import { getViewer } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { unpublishResult } from "@/lib/gallery";

/**
 * 갤러리에서 내리기.
 *
 * 공개를 해제하고 갤러리용 원본 사본을 지운다. 시안 자체는 본인 보관함에 남는다.
 * 소유 확인은 쿼리 조건과 RLS 양쪽에서 한다.
 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const viewer = await getViewer();

  if (!viewer.userId) {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const supabase = await createServerSupabase();
  if (!supabase) return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const ok = await unpublishResult(supabase, decodeURIComponent(slug), viewer.userId);
  if (!ok) {
    return Response.json({ error: "내가 공개한 시안만 내릴 수 있습니다." }, { status: 403 });
  }

  return Response.json({ ok: true });
}
