import { getViewer } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { memoryToggleLike, toggleLike } from "@/lib/gallery";

/**
 * 좋아요 토글.
 *
 * 한 사람이 한 시안에 한 번만 누를 수 있어야 하므로 "켜기/끄기"를 나누지 않고
 * 한 엔드포인트에서 뒤집는다 — 클라이언트가 현재 상태를 잘못 알고 있어도 어긋나지 않는다.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const decoded = decodeURIComponent(slug);

  /* 로컬 mock 모드 — 로그인 개념이 없으므로 메모리 저장소에서 뒤집는다 */
  if (!isSupabaseConfigured()) {
    const result = memoryToggleLike(decoded);
    if (!result) return Response.json({ error: "시안을 찾을 수 없습니다." }, { status: 404 });
    return Response.json(result);
  }

  const viewer = await getViewer();
  if (!viewer.userId) {
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const supabase = await createServerSupabase();
  if (!supabase) return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const result = await toggleLike(supabase, decoded);
  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.error.includes("로그인") ? 401 : 400 });
  }

  return Response.json(result);
}
