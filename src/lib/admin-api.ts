import type { SupabaseClient } from "@supabase/supabase-js";
import { getViewer, type Viewer } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { createAdminSupabase } from "@/lib/supabase/server";

/**
 * 관리자 API 공통 입구.
 *
 * 서비스 롤로 읽고 쓰는 라우트는 전부 이 함수를 먼저 지난다. 권한 확인을 라우트마다
 * 따로 쓰면 하나쯤 빠뜨리게 되고, 그 하나가 매출과 개인정보를 연다.
 */
export async function requireAdmin(): Promise<
  { ok: true; writer: SupabaseClient; viewer: Viewer } | { ok: false; response: Response }
> {
  const viewer = await getViewer();
  if (!isAdminEmail(viewer.authEmail)) {
    return {
      ok: false,
      response: Response.json({ error: "권한이 없습니다." }, { status: 403 }),
    };
  }

  const writer = createAdminSupabase();
  if (!writer) {
    return {
      ok: false,
      response: Response.json({ error: "서버 설정 오류입니다." }, { status: 500 }),
    };
  }

  return { ok: true, writer, viewer };
}
