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
