/*
 * 갤러리 소통: 시안별 댓글과 갤러리 실시간 대화
 *
 * 작성자 이름은 쓰는 시점에 행에 적어 둔다. profiles 는 본인만 조회할 수 있어
 * 조인이 안 되고, 이렇게 해야 이메일 같은 개인정보가 새지 않는다
 * (generation_results.author_name 과 같은 방식).
 *
 * 두 테이블 모두 사용자 세션으로 직접 쓴다 — 본인이 쓴 글이라는 조건을 RLS 가 본다.
 */

/* ───────────────────────────── 시안 댓글 ───────────────────────────── */

create table if not exists public.gallery_comments (
  id uuid primary key default gen_random_uuid(),
  result_id uuid not null references public.generation_results (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  author_name text,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists gallery_comments_result_idx
  on public.gallery_comments (result_id, created_at);

alter table public.gallery_comments enable row level security;

/* 공개된 시안의 댓글은 누구나 읽는다 — 비로그인 방문자도 갤러리를 본다 */
drop policy if exists "댓글 조회는 공개 시안만" on public.gallery_comments;
create policy "댓글 조회는 공개 시안만" on public.gallery_comments
  for select using (
    exists (
      select 1 from public.generation_results r
       where r.id = result_id and r.is_public = true
    )
  );

drop policy if exists "댓글 작성은 본인만" on public.gallery_comments;
create policy "댓글 작성은 본인만" on public.gallery_comments
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.generation_results r
       where r.id = result_id and r.is_public = true
    )
  );

/* 쓴 사람과 시안 주인이 지울 수 있다 — 내 시안에 달린 댓글은 내가 정리한다 */
drop policy if exists "댓글 삭제는 본인 또는 시안 주인" on public.gallery_comments;
create policy "댓글 삭제는 본인 또는 시안 주인" on public.gallery_comments
  for delete using (
    auth.uid() = user_id
    or exists (
      select 1 from public.generation_results r
       where r.id = result_id and r.user_id = auth.uid()
    )
  );

/* ─────────────────────────── 갤러리 실시간 대화 ─────────────────────────── */

create table if not exists public.gallery_chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  author_name text,
  body text not null check (char_length(body) between 1 and 300),
  created_at timestamptz not null default now()
);

create index if not exists gallery_chat_messages_created_idx
  on public.gallery_chat_messages (created_at desc);

alter table public.gallery_chat_messages enable row level security;

drop policy if exists "대화 조회는 누구나" on public.gallery_chat_messages;
create policy "대화 조회는 누구나" on public.gallery_chat_messages
  for select using (true);

drop policy if exists "대화 작성은 본인만" on public.gallery_chat_messages;
create policy "대화 작성은 본인만" on public.gallery_chat_messages
  for insert with check (auth.uid() = user_id);

drop policy if exists "대화 삭제는 본인만" on public.gallery_chat_messages;
create policy "대화 삭제는 본인만" on public.gallery_chat_messages
  for delete using (auth.uid() = user_id);

/*
 * 실시간 구독.
 * 브라우저가 postgres_changes 로 새 글·삭제를 받으려면 발행 목록에 있어야 한다.
 * 이미 들어 있으면 오류가 나므로 확인하고 넣는다.
 */
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'gallery_chat_messages'
  ) then
    alter publication supabase_realtime add table public.gallery_chat_messages;
  end if;
end $$;

/* 삭제 이벤트에 id 가 실려 오도록 — 기본은 기본키만 실리므로 그대로 충분하다 */
alter table public.gallery_chat_messages replica identity default;

/* ─────────────────────────── 위반 기록과 차단 ─────────────────────────── */

/*
 * 필터에 걸린 글과 차단 목록.
 *
 * 둘 다 서비스 롤만 읽고 쓴다 — RLS 는 켜 두고 정책은 하나도 만들지 않는다.
 * 사용자 세션으로는 자기 위반 기록조차 볼 수 없다. 무엇이 걸리는지 알려 주면
 * 그것을 피해 가는 방법도 알려 주는 셈이다.
 */

create table if not exists public.gallery_violations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  ip text,
  kind text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists gallery_violations_user_idx
  on public.gallery_violations (user_id, created_at desc);
create index if not exists gallery_violations_ip_idx
  on public.gallery_violations (ip, created_at desc);

alter table public.gallery_violations enable row level security;

/*
 * 차단은 계정과 IP 를 따로 건다. 한 사람을 막을 때 두 줄이 생긴다 —
 * 계정을 새로 파도 IP 로 막히고, IP 가 바뀌어도 계정으로 막힌다.
 * expires_at 이 비어 있으면 영구 차단이다.
 */
create table if not exists public.gallery_bans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  ip text,
  reason text not null,
  -- auto 또는 관리자 이메일
  created_by text not null default 'auto',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (user_id is not null or ip is not null)
);

create index if not exists gallery_bans_user_idx on public.gallery_bans (user_id);
create index if not exists gallery_bans_ip_idx on public.gallery_bans (ip);

alter table public.gallery_bans enable row level security;
