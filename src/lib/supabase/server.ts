import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isSupabaseConfigured, serviceRoleKey } from "./env";

/**
 * 서버 컴포넌트 / 라우트 핸들러용 클라이언트.
 * 사용자 세션을 그대로 물고 있으므로 RLS와 auth.uid() 기반 RPC가 정상 동작한다.
 */
export async function createServerSupabase() {
  if (!isSupabaseConfigured()) return null;

  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 미들웨어가 세션을 갱신하므로 무시해도 된다.
        }
      },
    },
  });
}

/**
 * 서비스 롤 클라이언트. RLS를 우회하므로 서버에서 생성 결과를 저장할 때만 사용한다.
 * 사용자 입력을 그대로 신뢰해서는 안 된다.
 */
export function createAdminSupabase() {
  const key = serviceRoleKey();
  if (!isSupabaseConfigured() || !key) return null;
  return createSupabaseClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
