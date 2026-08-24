-- 관리자용 기록 — 사고(incidents)와 사용 기록(events).
--
-- 유료로 열면 밤에 혼자 도는 코드가 돈을 만진다. 자동결제가 실패하거나 크레딧이
-- 잘못 나가도 지금은 알 방법이 console 로그뿐이라, 사람이 Railway 로그를 뒤져야 한다.
-- 그러다 모르고 지나가는 것이 가장 비싼 실수다.
--
-- schema.sql · migrations-billing.sql 을 돌린 DB에 이 파일을 추가로 실행한다.

/* ────────────────────────────── incidents ────────────────────────────── */

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  -- 무슨 일이 났나 (payment_failed, credit_failed, job_failed, save_failed ...)
  kind text not null,
  -- info: 알아 두면 좋음, warn: 봐야 함, error: 지금 봐야 함
  severity text not null default 'error' check (severity in ('info', 'warn', 'error')),
  -- 누구에게 일어났나. 사용자와 무관한 사고면 비워 둔다.
  user_id uuid references auth.users (id) on delete set null,
  project_id text,
  message text not null,
  -- 원인을 되짚을 때 필요한 것들 (주문번호, 잡 id, 응답 본문 일부 등)
  context jsonb not null default '{}'::jsonb,
  -- 처리한 사람이 표시한다. null이면 아직 미확인.
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists incidents_recent
  on public.incidents (created_at desc);

create index if not exists incidents_open
  on public.incidents (created_at desc)
  where resolved_at is null;

alter table public.incidents enable row level security;
-- 읽기·쓰기 모두 서버(서비스 롤)만 한다. 사용자에게는 보이지 않는다.

/* ─────────────────────────────── events ─────────────────────────────── */

-- 방문·클릭·AI 작업 같은 사용 기록.
--
-- 외부 분석 도구를 붙이지 않고 직접 담는다. 개인정보처리방침에 "광고·행태정보 수집
-- 목적의 쿠키는 쓰지 않는다"고 적어 두었으므로, 제3자에게 넘기지 않고 우리 DB에만
-- 남기는 편이 말과 맞다.
create table if not exists public.events (
  id bigserial primary key,
  -- page_view, editor_open, render_start, analyze_start, signup ...
  name text not null,
  user_id uuid references auth.users (id) on delete set null,
  -- 로그인하지 않은 방문을 세기 위한 값. 브라우저마다 하나씩 만들어 쿠키에 둔다.
  visitor text,
  path text,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_recent on public.events (created_at desc);
create index if not exists events_name_time on public.events (name, created_at desc);

alter table public.events enable row level security;
-- 쓰기는 서버가 대신한다. 클라이언트가 직접 넣지 못하게 정책을 두지 않는다.

/* ───────────────────────── 대시보드용 집계 함수 ───────────────────────── */

-- 하루치 요약을 한 번에 뽑는다.
--
-- 대시보드가 열릴 때마다 테이블을 다섯 번 훑으면 느려지므로 한 함수로 모은다.
-- 서비스 롤만 부를 수 있다.
create or replace function public.admin_daily_stats(p_days integer default 14)
returns table (
  day date,
  visits bigint,
  visitors bigint,
  signups bigint,
  ai_jobs bigint,
  credits_spent bigint,
  paid_count bigint,
  revenue bigint,
  incidents bigint
)
language sql
security definer
set search_path = public
as $$
  with days as (
    select generate_series(
      (current_date - (p_days - 1))::date,
      current_date,
      interval '1 day'
    )::date as day
  )
  select
    d.day,
    coalesce((select count(*) from events e
       where e.name = 'page_view' and e.created_at::date = d.day), 0) as visits,
    coalesce((select count(distinct coalesce(e.visitor, e.user_id::text)) from events e
       where e.name = 'page_view' and e.created_at::date = d.day), 0) as visitors,
    coalesce((select count(*) from profiles p
       where p.created_at::date = d.day), 0) as signups,
    coalesce((select count(*) from events e
       where e.name in ('analyze_start', 'render_start', 'generate_asset', 'ai_command')
         and e.created_at::date = d.day), 0) as ai_jobs,
    coalesce((select sum((e.props ->> 'credits')::int) from events e
       where e.props ? 'credits' and e.created_at::date = d.day), 0) as credits_spent,
    coalesce((select count(*) from payments pm
       where pm.status = 'paid' and pm.created_at::date = d.day), 0) as paid_count,
    coalesce((select sum(pm.amount) from payments pm
       where pm.status = 'paid' and pm.created_at::date = d.day), 0) as revenue,
    coalesce((select count(*) from incidents i
       where i.created_at::date = d.day), 0) as incidents
  from days d
  order by d.day desc;
$$;

revoke all on function public.admin_daily_stats(integer) from public, anon, authenticated;
grant execute on function public.admin_daily_stats(integer) to service_role;
