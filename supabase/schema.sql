-- 인테리어 AI — Supabase 스키마
-- Supabase 대시보드 SQL Editor에 그대로 붙여넣어 실행한다. (여러 번 실행해도 안전하도록 작성)
--
-- 주의: 플랜별 크레딧 금액은 config/plans.ts가 단일 출처다.
--       SQL에는 금액을 하드코딩하지 않고, 애플리케이션이 renew_credits(p_amount)로 값을 넘긴다.
--       유일한 예외는 가입 시 무료 크레딧 3장으로, 트리거에서 프로필을 만들 때 필요하다.

create extension if not exists pgcrypto;

/* ────────────────────────────── profiles ────────────────────────────── */

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  plan text not null default 'free' check (plan in ('free', 'basic', 'pro')),
  credits integer not null default 3 check (credits >= 0),
  -- 월 크레딧 갱신 기준 시각 (이월 없음)
  period_start timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "프로필 조회는 본인만" on public.profiles;
create policy "프로필 조회는 본인만" on public.profiles
  for select using (auth.uid() = id);

-- 트리거가 없는 환경(기존 계정 등)에서도 첫 로그인 시 앱이 프로필을 만들 수 있게 한다.
drop policy if exists "프로필 생성은 본인만" on public.profiles;
create policy "프로필 생성은 본인만" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "프로필 수정은 본인만" on public.profiles;
create policy "프로필 수정은 본인만" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- 구글 로그인 등으로 신규 가입하면 무료 플랜 프로필(3크레딧)을 만든다.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

/* ───────────────────────────── projects ─────────────────────────────── */

-- 디자이너가 클라이언트/현장별로 시안을 모아 두는 폴더
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create index if not exists projects_user_created_idx on public.projects (user_id, created_at desc);

alter table public.projects enable row level security;

drop policy if exists "프로젝트 조회는 본인만" on public.projects;
create policy "프로젝트 조회는 본인만" on public.projects
  for select using (auth.uid() = user_id);

drop policy if exists "프로젝트 생성은 본인만" on public.projects;
create policy "프로젝트 생성은 본인만" on public.projects
  for insert with check (auth.uid() = user_id);

drop policy if exists "프로젝트 수정은 본인만" on public.projects;
create policy "프로젝트 수정은 본인만" on public.projects
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "프로젝트 삭제는 본인만" on public.projects;
create policy "프로젝트 삭제는 본인만" on public.projects
  for delete using (auth.uid() = user_id);

/* ─────────────────────────── generation_jobs ────────────────────────── */

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 내 프로젝트 (폴더가 삭제돼도 생성물은 남는다)
  project_id uuid references public.projects (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'succeeded', 'failed')),
  mode_id text not null,
  room_id text not null,
  style_id text not null,
  resolution text not null,
  materials jsonb not null default '{}'::jsonb,
  use_mask boolean not null default false,
  prompt text not null,
  -- Storage 경로 (sources 버킷)
  source_path text,
  image_count integer not null default 4,
  credits_charged integer not null default 0,
  credits_refunded boolean not null default false,
  plan_at_request text not null default 'free',
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists generation_jobs_user_created_idx
  on public.generation_jobs (user_id, created_at desc);
create index if not exists generation_jobs_project_idx
  on public.generation_jobs (project_id);

alter table public.generation_jobs enable row level security;

drop policy if exists "작업 조회는 본인만" on public.generation_jobs;
create policy "작업 조회는 본인만" on public.generation_jobs
  for select using (auth.uid() = user_id);

drop policy if exists "작업 생성은 본인만" on public.generation_jobs;
create policy "작업 생성은 본인만" on public.generation_jobs
  for insert with check (auth.uid() = user_id);

drop policy if exists "작업 수정은 본인만" on public.generation_jobs;
create policy "작업 수정은 본인만" on public.generation_jobs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

/* ────────────────────────── generation_results ──────────────────────── */

create table if not exists public.generation_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Storage 경로 (results 버킷, 공개)
  storage_path text not null,
  width integer not null,
  height integer not null,
  watermarked boolean not null default true,
  position integer not null default 0,
  -- Phase 5: SEO 갤러리 공개 동의
  is_public boolean not null default false,
  slug text unique,
  created_at timestamptz not null default now()
);

create index if not exists generation_results_job_idx on public.generation_results (job_id, position);
create index if not exists generation_results_public_idx on public.generation_results (is_public, created_at desc);

alter table public.generation_results enable row level security;

drop policy if exists "결과 조회는 본인 또는 공개분" on public.generation_results;
create policy "결과 조회는 본인 또는 공개분" on public.generation_results
  for select using (auth.uid() = user_id or is_public = true);

drop policy if exists "결과 생성은 본인만" on public.generation_results;
create policy "결과 생성은 본인만" on public.generation_results
  for insert with check (auth.uid() = user_id);

drop policy if exists "결과 수정은 본인만" on public.generation_results;
create policy "결과 수정은 본인만" on public.generation_results
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

/* ───────────────────────────── 크레딧 함수 ──────────────────────────── */

-- 차감: 잔액이 부족하면 예외를 던진다 (동시 요청에서도 음수가 되지 않는다).
create or replace function public.consume_credits(p_amount integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  update public.profiles
     set credits = credits - p_amount,
         updated_at = now()
   where id = auth.uid()
     and credits >= p_amount
  returning credits into v_remaining;

  if v_remaining is null then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  return v_remaining;
end;
$$;

-- 환불: 생성 실패 시 차감분을 되돌린다.
create or replace function public.refund_credits(p_amount integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  update public.profiles
     set credits = credits + p_amount,
         updated_at = now()
   where id = auth.uid()
  returning credits into v_remaining;

  if v_remaining is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  return v_remaining;
end;
$$;

-- 월 갱신: 이월 없이 지정한 값으로 덮어쓴다. 금액은 config/plans.ts에서 넘어온다.
create or replace function public.renew_credits(p_amount integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining integer;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  update public.profiles
     set credits = p_amount,
         period_start = now(),
         updated_at = now()
   where id = auth.uid()
  returning credits into v_remaining;

  if v_remaining is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  return v_remaining;
end;
$$;

-- 서버(서비스 롤) 전용 환불. 백그라운드 파이프라인에는 사용자 세션이 없으므로 uid를 직접 받는다.
create or replace function public.admin_refund_credits(p_user uuid, p_amount integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining integer;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  update public.profiles
     set credits = credits + p_amount,
         updated_at = now()
   where id = p_user
  returning credits into v_remaining;

  if v_remaining is null then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  return v_remaining;
end;
$$;

revoke execute on function public.admin_refund_credits(uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_refund_credits(uuid, integer) to service_role;

grant execute on function public.consume_credits(integer) to authenticated;
grant execute on function public.refund_credits(integer) to authenticated;
grant execute on function public.renew_credits(integer) to authenticated;

/* ───────────────────────────── Storage 버킷 ─────────────────────────── */

-- sources: 업로드 원본 (비공개, 서명 URL로만 열람)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sources', 'sources', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- results: 생성 결과 (공개 — 갤러리/OG 이미지에 그대로 사용)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- svg는 GEMINI_API_KEY 없이 동작하는 mock 결과용이다.
values ('results', 'results', true, 20971520, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 경로 규칙: {user_id}/{job_id}/... — 첫 폴더가 본인 uid인 객체만 접근할 수 있다.
drop policy if exists "원본 업로드는 본인 폴더만" on storage.objects;
create policy "원본 업로드는 본인 폴더만" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "원본 조회는 본인 폴더만" on storage.objects;
create policy "원본 조회는 본인 폴더만" on storage.objects
  for select to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "원본 삭제는 본인 폴더만" on storage.objects;
create policy "원본 삭제는 본인 폴더만" on storage.objects
  for delete to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = auth.uid()::text);

-- 서비스 롤 키가 없는 환경에서는 사용자 세션으로 결과를 저장한다.
drop policy if exists "결과 업로드는 본인 폴더만" on storage.objects;
create policy "결과 업로드는 본인 폴더만" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'results' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "결과 갱신은 본인 폴더만" on storage.objects;
create policy "결과 갱신은 본인 폴더만" on storage.objects
  for update to authenticated
  using (bucket_id = 'results' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "결과 조회는 공개" on storage.objects;
create policy "결과 조회는 공개" on storage.objects
  for select using (bucket_id = 'results');
