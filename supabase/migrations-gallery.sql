/*
 * 갤러리: 작성자 표시와 조회수
 *
 * profiles는 본인만 조회할 수 있게 막혀 있어서 갤러리에서 작성자를 조인할 수 없다.
 * 공개 시점에 표시 이름을 결과 행에 적어 두는 방식으로 푼다 — 이메일 같은
 * 개인정보가 갤러리로 새지 않고, 조회 쿼리도 단순해진다.
 */

alter table public.generation_results
  add column if not exists author_name text,
  add column if not exists view_count integer not null default 0;

create index if not exists generation_results_views_idx
  on public.generation_results (is_public, view_count desc);

/*
 * 조회수 증가.
 *
 * 비로그인 방문자도 올릴 수 있어야 하므로 security definer로 두되,
 * 공개된 항목의 view_count만 건드린다.
 */
create or replace function public.increment_gallery_view(p_slug text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.generation_results
     set view_count = view_count + 1
   where slug = p_slug and is_public = true
  returning view_count into v_count;

  return coalesce(v_count, 0);
end;
$$;

grant execute on function public.increment_gallery_view(text) to anon, authenticated;

/*
 * 갤러리 전/후 비교
 *
 * 원본 사진은 비공개 sources 버킷에 있어서 갤러리 방문자가 볼 수 없다.
 * 공개 시점에 원본 사본을 공개 results 버킷으로 옮기고 그 경로를 적어 둔다.
 * (공개하지 않은 시안의 원본은 그대로 비공개로 남는다)
 */
alter table public.generation_results
  add column if not exists before_path text;

/*
 * 공개한 시안이 갤러리에 안 보이던 문제
 *
 * 갤러리 쿼리는 generation_jobs를 inner join해 방 종류·스타일·프롬프트를 읽는데,
 * 작업 조회 정책이 "본인만"이라 방문자에게는 조인이 비어 결과가 0건이 됐다.
 * 공개된 결과가 달린 작업만 열어 준다 (상세 페이지에서 이미 보여 주는 범위와 같다).
 */
drop policy if exists "공개된 시안의 작업은 누구나" on public.generation_jobs;
create policy "공개된 시안의 작업은 누구나" on public.generation_jobs
  for select using (
    exists (
      select 1
        from public.generation_results r
       where r.job_id = generation_jobs.id
         and r.is_public = true
    )
  );

/*
 * 좋아요
 *
 * 한 사람이 한 시안에 한 번만 누를 수 있어야 하므로 (result_id, user_id)를 기본키로 둔다.
 * 목록을 좋아요순으로 정렬하려면 매번 세는 대신 결과 행에 개수를 들고 있어야 한다 —
 * 개수는 트리거가 맞춰 주고, 앱은 토글 함수 하나만 부른다.
 */
alter table public.generation_results
  add column if not exists like_count integer not null default 0;

create index if not exists generation_results_likes_idx
  on public.generation_results (is_public, like_count desc);

create table if not exists public.gallery_likes (
  result_id uuid not null references public.generation_results (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (result_id, user_id)
);

create index if not exists gallery_likes_user_idx on public.gallery_likes (user_id);

alter table public.gallery_likes enable row level security;

/*
 * 누가 무엇을 좋아하는지는 남에게 보이지 않는다.
 * 화면에 필요한 건 "내가 눌렀는지"와 합계뿐이고, 합계는 결과 행에 있다.
 */
drop policy if exists "좋아요 조회는 본인만" on public.gallery_likes;
create policy "좋아요 조회는 본인만" on public.gallery_likes
  for select using (auth.uid() = user_id);

drop policy if exists "좋아요 등록은 본인만" on public.gallery_likes;
create policy "좋아요 등록은 본인만" on public.gallery_likes
  for insert with check (auth.uid() = user_id);

drop policy if exists "좋아요 취소는 본인만" on public.gallery_likes;
create policy "좋아요 취소는 본인만" on public.gallery_likes
  for delete using (auth.uid() = user_id);

/* like_count를 항상 실제 행 수와 맞춰 둔다 */
create or replace function public.sync_gallery_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.generation_results
       set like_count = like_count + 1
     where id = new.result_id;
    return new;
  end if;

  update public.generation_results
     set like_count = greatest(0, like_count - 1)
   where id = old.result_id;
  return old;
end;
$$;

drop trigger if exists gallery_likes_count on public.gallery_likes;
create trigger gallery_likes_count
  after insert or delete on public.gallery_likes
  for each row execute function public.sync_gallery_like_count();

/*
 * 좋아요 토글.
 * 눌렸으면 취소하고 아니면 등록한 뒤, 바뀐 상태와 합계를 함께 돌려준다.
 */
create or replace function public.toggle_gallery_like(p_slug text)
returns table (liked boolean, like_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result uuid;
  v_liked boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select id into v_result
    from public.generation_results
   where slug = p_slug and is_public = true;

  if v_result is null then
    raise exception 'NOT_FOUND';
  end if;

  select exists (
    select 1 from public.gallery_likes
     where result_id = v_result and user_id = auth.uid()
  ) into v_liked;

  if v_liked then
    delete from public.gallery_likes
     where result_id = v_result and user_id = auth.uid();
  else
    insert into public.gallery_likes (result_id, user_id) values (v_result, auth.uid());
  end if;

  return query
    select (not v_liked), r.like_count
      from public.generation_results r
     where r.id = v_result;
end;
$$;

grant execute on function public.toggle_gallery_like(text) to authenticated;
