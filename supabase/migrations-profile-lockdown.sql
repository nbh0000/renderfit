-- profiles 쓰기 권한을 좁힌다. ★ 유료 출시 전에 반드시 실행할 것.
--
-- 지금은 "프로필 수정은 본인만" 정책이 본인 행의 모든 칸을 열어 준다. RLS 정책은
-- 행 단위로만 막을 뿐 어느 칸을 고칠지는 가리지 않기 때문이다. 그래서 로그인한
-- 사용자가 자기 행을 이렇게 고칠 수 있다.
--
--   credits = 999999   →  AI를 마음껏 쓴다. 그 비용은 우리가 낸다.
--   plan    = 'pro'    →  돈을 내지 않고 유료 기능을 쓴다.
--   email   = 관리자것  →  관리자 화면에 들어와 매출과 사고 기록을 본다.
--
-- 브라우저에서 바로 되지는 않는다(세션이 httpOnly 쿠키에 있다). 다만 anon 키는
-- 클라이언트 번들에 공개돼 있으므로, 직접 로그인해 토큰을 얻으면 REST로 고칠 수 있다.
-- 상업 서비스에서 이대로 두면 안 된다.
--
-- 고치는 방법은 칸 단위 권한이다. 행 정책은 그대로 두고, 사용자가 손대도 되는 칸만
-- 열어 준다. 나머지(plan·credits·email·period_start)는 서버(서비스 롤)와 SECURITY
-- DEFINER 함수만 바꾼다 — consume_credits·refund_credits·apply_paid_plan 이 그것이다.

revoke update on public.profiles from authenticated, anon;

-- 사용자가 바꿔도 되는 것: 표시 이름과 프로필 사진뿐이다.
grant update (full_name, avatar_url) on public.profiles to authenticated;

-- 조회와 생성은 그대로 둔다 (기존 정책이 본인 행만 허용한다).
grant select, insert on public.profiles to authenticated;

/*
 * 잘 막혔는지 확인하는 법.
 *
 * SQL Editor 가 아니라 실제 사용자 토큰으로 아래를 던져 보면 권한 오류가 나야 한다.
 *
 *   curl -X PATCH "$SUPABASE_URL/rest/v1/profiles?id=eq.<내 id>" \
 *     -H "apikey: $ANON_KEY" -H "Authorization: Bearer <내 access token>" \
 *     -H "content-type: application/json" \
 *     -d '{"credits": 999999}'
 *
 * full_name 만 바꾸는 요청은 여전히 통과해야 한다.
 */

/* ─────────────────── 생성 작업·결과도 서버만 고친다 ─────────────────── */

-- generation_jobs 와 generation_results 는 만들어진 뒤에 사용자가 고칠 이유가 없다.
-- 상태 변경·결과 기록·크레딧 환불 표시는 전부 서버가 서비스 롤로 한다
-- (src/lib/jobs/store.ts 의 admin 클라이언트).
--
-- 열어 두면 이런 것이 가능해진다.
--   credits_charged 를 0으로  →  우리 사용량 통계가 어긋난다
--   status 를 completed 로     →  실패한 작업이 성공한 것처럼 보인다
--   watermarked 를 false 로    →  기록상 워터마크가 없던 것이 된다
--
-- 조회와 생성은 그대로 둔다. 작업을 만드는 것은 사용자 세션으로 하기 때문이다.

revoke update on public.generation_jobs from authenticated, anon;
revoke update on public.generation_results from authenticated, anon;

-- 편집기의 design_projects 는 손대지 않는다. 그 표는 사용자의 장면 자체이고
-- 저장이 사용자 세션으로 이뤄지며, 돈에 걸린 칸이 없다.
