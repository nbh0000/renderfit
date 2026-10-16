-- 관리자 CS: API 호출 기록, 문의, 정산·고객 집계.
--
-- migrations-admin.sql · migrations-admin-usage.sql · migrations-billing.sql 다음에 실행한다.
-- 세 테이블 모두 서비스 롤만 읽고 쓴다 (문의는 본인이 쓴 것만 사용자 세션으로 읽는다).

/* ─────────────────────────────── api_calls ─────────────────────────────── */

-- 외부 AI API 를 한 번 부를 때마다 한 줄.
--
-- "수익 대비 비용"을 보려면 부른 횟수만으로는 부족하다 — 모델마다 값이 다르다.
-- 그래서 부를 때 추정 비용(원)을 함께 적는다. 추정치는 config/costs.ts 에 있고,
-- 실제 청구서와 다르면 그 파일의 단가를 고친다.
create table if not exists public.api_calls (
  id bigserial primary key,
  provider text not null default 'gemini',
  model text not null,
  -- image_generate, image_render, product_image, furniture_estimate ...
  kind text not null,
  user_id uuid references auth.users (id) on delete set null,
  -- 이미지 생성이면 만든 장 수 (텍스트 호출은 0)
  images integer not null default 0,
  ok boolean not null default true,
  cost_krw numeric(12, 2) not null default 0,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists api_calls_recent on public.api_calls (created_at desc);
create index if not exists api_calls_user on public.api_calls (user_id, created_at desc);

alter table public.api_calls enable row level security;

/* ─────────────────────────────── inquiries ─────────────────────────────── */

-- 고객 문의. 비로그인도 남길 수 있어 이름·이메일을 따로 받는다.
create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  name text not null,
  email text not null,
  -- general, payment, refund, bug, other
  category text not null default 'general',
  subject text not null check (char_length(subject) between 1 and 120),
  body text not null check (char_length(body) between 1 and 3000),
  -- open: 새 문의, answered: 답변함, closed: 종료
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  -- 관리자 답변. 로그인한 사람이 남긴 문의면 본인이 /contact 에서 본다.
  reply text,
  -- 관리자만 보는 메모 (환불 처리 내역 등)
  admin_note text,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inquiries_open on public.inquiries (created_at desc) where status = 'open';
create index if not exists inquiries_user on public.inquiries (user_id, created_at desc);

alter table public.inquiries enable row level security;

-- 본인이 남긴 문의는 본인이 읽는다 (답변을 보여 주려고). 쓰기는 서버가 대신한다.
drop policy if exists "문의 조회는 본인만" on public.inquiries;
create policy "문의 조회는 본인만" on public.inquiries
  for select using (auth.uid() = user_id);

/* ───────────────────────────── 정산 집계 ───────────────────────────── */

-- 일·월·년 단위로 받은 돈, 돌려준 돈, API 비용을 나란히 놓는다.
--
-- p_unit: 'day' | 'month' | 'year', p_count: 몇 칸을 볼지.
create or replace function public.admin_settlement(p_unit text default 'day', p_count integer default 30)
returns table (
  period date,
  revenue bigint,
  refunds bigint,
  paid_count bigint,
  refund_count bigint,
  api_calls bigint,
  api_cost numeric,
  visits bigint,
  signups bigint
)
language sql
security definer
set search_path = public
as $$
  with periods as (
    select date_trunc(p_unit, now() - (n || ' ' || p_unit)::interval)::date as period
      from generate_series(0, p_count - 1) as n
  )
  select
    p.period,
    coalesce((select sum(pm.amount) from payments pm
       where pm.status in ('paid', 'refunded')
         and date_trunc(p_unit, pm.created_at)::date = p.period), 0) as revenue,
    coalesce((select sum(pm.refunded_amount) from payments pm
       where date_trunc(p_unit, pm.updated_at)::date = p.period
         and pm.refunded_amount > 0), 0) as refunds,
    coalesce((select count(*) from payments pm
       where pm.status in ('paid', 'refunded')
         and date_trunc(p_unit, pm.created_at)::date = p.period), 0) as paid_count,
    coalesce((select count(*) from payments pm
       where pm.refunded_amount > 0
         and date_trunc(p_unit, pm.updated_at)::date = p.period), 0) as refund_count,
    coalesce((select count(*) from api_calls c
       where date_trunc(p_unit, c.created_at)::date = p.period), 0) as api_calls,
    coalesce((select sum(c.cost_krw) from api_calls c
       where date_trunc(p_unit, c.created_at)::date = p.period), 0) as api_cost,
    coalesce((select count(*) from events e
       where e.name = 'page_view'
         and date_trunc(p_unit, e.created_at)::date = p.period), 0) as visits,
    coalesce((select count(*) from profiles pr
       where date_trunc(p_unit, pr.created_at)::date = p.period), 0) as signups
  from periods p
  order by p.period desc;
$$;

revoke all on function public.admin_settlement(text, integer) from public, anon, authenticated;
grant execute on function public.admin_settlement(text, integer) to service_role;

/* ───────────────────────────── 고객 목록 ───────────────────────────── */

-- 이름·이메일로 찾고, 결제 합계·마지막 활동을 붙여 준다.
create or replace function public.admin_customers(p_query text default '', p_limit integer default 50)
returns table (
  id uuid,
  email text,
  full_name text,
  plan text,
  credits integer,
  created_at timestamptz,
  revenue bigint,
  refunded bigint,
  ai_jobs bigint,
  last_seen timestamptz,
  subscription_status text,
  inquiries_open bigint
)
language sql
security definer
set search_path = public
as $$
  select
    pr.id,
    pr.email,
    pr.full_name,
    pr.plan,
    pr.credits,
    pr.created_at,
    coalesce((select sum(pm.amount) from payments pm
       where pm.user_id = pr.id and pm.status in ('paid', 'refunded')), 0) as revenue,
    coalesce((select sum(pm.refunded_amount) from payments pm where pm.user_id = pr.id), 0) as refunded,
    coalesce((select count(*) from events e
       where e.user_id = pr.id
         and e.name in ('render_start', 'generate_asset', 'ai_command')), 0) as ai_jobs,
    (select max(e.created_at) from events e where e.user_id = pr.id) as last_seen,
    (select s.status from subscriptions s
       where s.user_id = pr.id
       order by s.created_at desc limit 1) as subscription_status,
    coalesce((select count(*) from inquiries i
       where i.user_id = pr.id and i.status = 'open'), 0) as inquiries_open
  from profiles pr
  where p_query = ''
     or pr.email ilike '%' || p_query || '%'
     or pr.full_name ilike '%' || p_query || '%'
  order by pr.created_at desc
  limit p_limit;
$$;

revoke all on function public.admin_customers(text, integer) from public, anon, authenticated;
grant execute on function public.admin_customers(text, integer) to service_role;

/* ───────────────────────────── 크레딧 조정 ───────────────────────────── */

-- 관리자가 크레딧을 더하거나 뺀다 (보상, 오지급 회수). 음수로 내려가지는 않는다.
create or replace function public.admin_adjust_credits(p_user uuid, p_delta integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer;
begin
  update public.profiles
     set credits = greatest(0, credits + p_delta),
         updated_at = now()
   where id = p_user
  returning credits into v_credits;

  if v_credits is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
  return v_credits;
end;
$$;

revoke all on function public.admin_adjust_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_adjust_credits(uuid, integer) to service_role;
