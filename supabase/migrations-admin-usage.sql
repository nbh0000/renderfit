-- 수익·사용량 분석.
--
-- 대시보드에 "얼마 벌었나"만 있으면 반쪽이다. 정작 알아야 할 것은 그 돈을 벌기 위해
-- 얼마를 썼는가다. AI 호출은 돈이 나가는 일이라, 받은 돈 대비 얼마나 쓰였는지를
-- 보지 않으면 팔수록 손해인 구간을 모른 채 지나간다.
--
-- migrations-admin.sql 다음에 실행한다.

/* ─────────────────── 요금제별 수익과 사용량 ─────────────────── */

-- 요금제별로 얼마를 받았고, 그 사람들이 크레딧을 얼마나 썼는지.
--
-- 사용률이 낮으면 마진이 좋은 것이고, 100%에 붙으면 크레딧을 더 주거나 값을 올려야
-- 한다는 뜻이다. 200%를 넘으면 실패 환불이 꼬였거나 크레딧 지급이 잘못된 것이다.
create or replace function public.admin_plan_usage(p_days integer default 30)
returns table (
  plan text,
  members bigint,
  paid_count bigint,
  revenue bigint,
  credits_granted bigint,
  credits_spent bigint,
  ai_jobs bigint
)
language sql
security definer
set search_path = public
as $$
  with span as (
    select (now() - make_interval(days => p_days)) as since
  ),
  paid as (
    select pm.plan, count(*) as paid_count, sum(pm.amount) as revenue
      from payments pm, span
     where pm.status = 'paid' and pm.created_at >= span.since
     group by pm.plan
  ),
  used as (
    -- 크레딧을 쓴 기록은 events.props.credits 에 남는다
    select pr.plan,
           coalesce(sum((e.props ->> 'credits')::int), 0) as credits_spent,
           count(*) as ai_jobs
      from events e
      join profiles pr on pr.id = e.user_id, span
     where e.props ? 'credits' and e.created_at >= span.since
     group by pr.plan
  ),
  people as (
    select pr.plan, count(*) as members, sum(pr.credits) as credits_left
      from profiles pr
     group by pr.plan
  )
  select
    p.plan,
    coalesce(p.members, 0) as members,
    coalesce(paid.paid_count, 0) as paid_count,
    coalesce(paid.revenue, 0) as revenue,
    -- 지급된 크레딧 = 지금 남은 것 + 쓴 것
    coalesce(p.credits_left, 0) + coalesce(used.credits_spent, 0) as credits_granted,
    coalesce(used.credits_spent, 0) as credits_spent,
    coalesce(used.ai_jobs, 0) as ai_jobs
  from people p
  left join paid on paid.plan = p.plan
  left join used on used.plan = p.plan
  order by p.plan;
$$;

revoke all on function public.admin_plan_usage(integer) from public, anon, authenticated;
grant execute on function public.admin_plan_usage(integer) to service_role;

/* ─────────────────────── 최근 작업 내역 ─────────────────────── */

-- 누가 무슨 작업을 했는지. 문의가 들어왔을 때 그 사람이 뭘 하다 막혔는지 본다.
create or replace function public.admin_recent_activity(p_limit integer default 50)
returns table (
  id bigint,
  name text,
  email text,
  plan text,
  credits integer,
  path text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    e.id,
    e.name,
    pr.email,
    pr.plan,
    coalesce((e.props ->> 'credits')::int, 0) as credits,
    e.path,
    e.created_at
  from events e
  left join profiles pr on pr.id = e.user_id
  where e.name <> 'page_view'
  order by e.created_at desc
  limit greatest(1, least(p_limit, 200));
$$;

revoke all on function public.admin_recent_activity(integer) from public, anon, authenticated;
grant execute on function public.admin_recent_activity(integer) to service_role;

/* ─────────────────── 사람별 수익과 사용량 ─────────────────── */

-- 돈을 낸 사람이 실제로 쓰고 있는지. 결제만 하고 안 쓰는 사람은 곧 해지한다.
create or replace function public.admin_top_users(p_days integer default 30, p_limit integer default 20)
returns table (
  email text,
  plan text,
  revenue bigint,
  credits_spent bigint,
  ai_jobs bigint,
  credits_left integer,
  last_seen timestamptz
)
language sql
security definer
set search_path = public
as $$
  with span as (
    select (now() - make_interval(days => p_days)) as since
  )
  select
    pr.email,
    pr.plan,
    coalesce((select sum(pm.amount) from payments pm, span
               where pm.user_id = pr.id and pm.status = 'paid'
                 and pm.created_at >= span.since), 0) as revenue,
    coalesce((select sum((e.props ->> 'credits')::int) from events e, span
               where e.user_id = pr.id and e.props ? 'credits'
                 and e.created_at >= span.since), 0) as credits_spent,
    coalesce((select count(*) from events e, span
               where e.user_id = pr.id and e.name <> 'page_view'
                 and e.created_at >= span.since), 0) as ai_jobs,
    pr.credits as credits_left,
    (select max(e.created_at) from events e where e.user_id = pr.id) as last_seen
  from profiles pr
  order by revenue desc, credits_spent desc
  limit greatest(1, least(p_limit, 100));
$$;

revoke all on function public.admin_top_users(integer, integer) from public, anon, authenticated;
grant execute on function public.admin_top_users(integer, integer) to service_role;
