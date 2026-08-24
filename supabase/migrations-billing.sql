-- 구독·결제 기록.
--
-- 유료 출시를 위해 추가한다. 결제대행사(토스페이먼츠)에서 빌링키를 발급받아 매월
-- 자동결제를 걸고, 그 승인 결과를 여기에 남긴다. 환불·분쟁 대응에 필요하고
-- 전자상거래법상 거래 기록은 5년 보관해야 한다.
--
-- schema.sql 을 이미 돌린 DB에 이 파일만 추가로 실행한다.

/* ───────────────────────────── subscriptions ───────────────────────────── */

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan text not null check (plan in ('basic', 'pro')),
  -- 결제대행사가 발급한 빌링키. 이것으로 매월 자동결제를 건다.
  billing_key text not null,
  -- active: 정상, past_due: 자동결제 실패(재시도 중), canceled: 해지 예약(주기 끝까지 사용),
  -- expired: 종료
  status text not null default 'active'
    check (status in ('active', 'past_due', 'canceled', 'expired')),
  -- 이번 주기의 시작·끝. 끝나는 날 자동결제를 건다.
  period_start timestamptz not null default now(),
  period_end timestamptz not null,
  -- 자동결제가 연달아 실패한 횟수. 한도를 넘으면 구독을 끝낸다.
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  -- 다음에 다시 시도할 시각 (실패했을 때만)
  retry_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 한 사람이 살아 있는 구독을 둘 가질 수는 없다 (재시도 중인 것도 살아 있는 것으로 본다)
create unique index if not exists subscriptions_active_user
  on public.subscriptions (user_id)
  where status in ('active', 'past_due');

create index if not exists subscriptions_renewal
  on public.subscriptions (period_end)
  where status in ('active', 'past_due', 'canceled');

alter table public.subscriptions enable row level security;

drop policy if exists "본인 구독만 조회" on public.subscriptions;
create policy "본인 구독만 조회" on public.subscriptions
  for select using (auth.uid() = user_id);

-- 쓰기는 서버(서비스 롤)만 한다. 사용자가 직접 구독을 만들 수 있으면 안 된다.

/* ─────────────────────────────── payments ─────────────────────────────── */

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  -- 우리가 만든 주문번호. 결제대행사 승인 요청에 그대로 보낸다.
  order_id text not null unique,
  -- 결제대행사가 돌려준 결제 식별자. 취소·조회에 쓴다.
  payment_key text,
  plan text not null,
  amount integer not null check (amount >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'canceled', 'refunded')),
  -- 환불한 금액 (부분 환불이 있으므로 따로 센다)
  refunded_amount integer not null default 0 check (refunded_amount >= 0),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payments_user_time
  on public.payments (user_id, created_at desc);

alter table public.payments enable row level security;

drop policy if exists "본인 결제만 조회" on public.payments;
create policy "본인 결제만 조회" on public.payments
  for select using (auth.uid() = user_id);

/* ──────────────────────────── 결제 성공 반영 ──────────────────────────── */

-- 결제가 승인되면 요금제를 올리고 그 달 크레딧을 채운다.
--
-- 요금제 변경과 크레딧 지급이 따로 놀면 "결제는 됐는데 크레딧이 없다"는 문의가 생긴다.
-- 한 함수 안에서 함께 처리해 둘이 어긋나지 않게 한다.
create or replace function public.apply_paid_plan(
  p_user uuid,
  p_plan text,
  p_credits integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_plan not in ('basic', 'pro') then
    raise exception 'UNKNOWN_PLAN';
  end if;

  update public.profiles
     set plan = p_plan,
         credits = p_credits,
         period_start = now(),
         updated_at = now()
   where id = p_user;

  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
end;
$$;

revoke all on function public.apply_paid_plan(uuid, text, integer) from public;

-- 구독이 끝나면 무료로 되돌린다 (자동결제 실패·해지 후 주기 종료)
create or replace function public.expire_plan(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
     set plan = 'free',
         updated_at = now()
   where id = p_user;
end;
$$;

revoke all on function public.expire_plan(uuid) from public;
