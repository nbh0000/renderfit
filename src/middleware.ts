import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** 요청마다 Supabase 세션 쿠키를 갱신한다. 설정이 없으면 그대로 통과시킨다. */
export async function middleware(request: NextRequest) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();

  return response;
}

/*
 * API 요청에는 걸지 않는다.
 *
 * 이 미들웨어가 하는 일은 요청마다 auth.getUser() 를 불러 세션 쿠키를 갱신하는 것인데,
 * 그것은 Supabase 인증 서버로 나가는 네트워크 왕복이다. API 라우트는 저마다 getViewer()
 * 로 다시 확인하므로 여기서 한 번 더 다녀오면 같은 왕복을 두 번 하는 셈이다.
 * 쿠키 갱신은 페이지 요청에서 이뤄지므로 세션은 그대로 유지된다.
 */
export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico)$).*)",
  ],
};
