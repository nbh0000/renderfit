/*
 * 도면 들여오기 잡.
 *
 * 도면 한 장이 FloorPlanDoc 이 되기까지는 파서·벡터화가 오래 걸린다. 그 진행을
 * 여기에 남긴다 — 어느 경로로 갔는지(route), 왜 그렇게 갈랐는지(reason), 끝났으면
 * 결과 문서(doc)까지.
 *
 * 자동 결과는 절대 확정하지 않으므로 doc 안의 review.status 가 "auto" 로 시작한다.
 * 사람이 검수 화면을 거쳐야 "confirmed" 가 된다.
 *
 * 실행: Supabase SQL Editor 에 붙여 넣고 한 번 돌린다.
 */

create table if not exists public.plan_ingest_jobs (
  id text primary key,
  owner_id uuid references auth.users (id) on delete cascade,
  /* 어느 프로젝트로 들어갈 도면인가. 아직 안 정했으면 비운다 */
  project_id text,

  /* 어떻게 갈랐나 */
  route text not null check (route in ('cad', 'cad-pdf', 'raster')),
  format text not null check (format in ('dxf', 'dwg', 'pdf', 'png', 'jpeg')),
  reason text,

  /* 무엇이 들어왔나 */
  file_name text not null,
  byte_size bigint not null default 0,

  /*
   * 사용자가 잡아 준 도면 영역 {x, y, width, height} — 원본 이미지 픽셀.
   *
   * 래스터 경로의 정확도를 가장 크게 좌우하는 값이라 남긴다. 같은 도면을 다시 돌릴
   * 때 사용자가 또 크롭하지 않아도 되고, 결과가 이상할 때 "어디를 도면으로 봤나" 를
   * 되짚을 수 있다.
   */
  crop jsonb,

  status text not null default 'queued'
    check (status in ('queued', 'processing', 'done', 'failed')),
  error text,

  /* 끝났으면 FloorPlanDoc 이 여기 들어간다 */
  doc jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plan_ingest_jobs_owner_idx
  on public.plan_ingest_jobs (owner_id, created_at desc);

create index if not exists plan_ingest_jobs_status_idx
  on public.plan_ingest_jobs (status, created_at);

alter table public.plan_ingest_jobs enable row level security;

/*
 * 자기 잡만 본다.
 *
 * 도면은 남의 집 평면이다. 잡 목록이 새면 누가 어떤 도면을 올렸는지가 그대로 샌다.
 * 서버가 쓰는 service role 은 RLS 를 지나가므로 여기 정책이 필요 없다.
 */
drop policy if exists "plan_ingest_jobs_select_own" on public.plan_ingest_jobs;
create policy "plan_ingest_jobs_select_own"
  on public.plan_ingest_jobs
  for select
  using (auth.uid() = owner_id);

/*
 * 잡을 만드는 것도 고치는 것도 서버만 한다.
 *
 * 브라우저가 직접 넣게 두면 status 를 'done' 으로 적어 검수를 건너뛸 수 있다.
 * insert·update 정책을 아예 두지 않아 service role 말고는 쓸 수 없게 한다.
 */
revoke insert, update, delete on public.plan_ingest_jobs from anon, authenticated;
grant select on public.plan_ingest_jobs to authenticated;

/*
 * 이미 만들어 둔 표에 crop 을 더한다 (2026-08, 페이즈 2).
 *
 * 위 create table 은 표가 없을 때만 도므로, 먼저 만든 환경에는 이 줄이 필요하다.
 */
alter table public.plan_ingest_jobs add column if not exists crop jsonb;

/*
 * ── 검수 (2026-08, 페이즈 3) ──
 *
 * 자동으로 읽은 도면은 사람이 한 번 보기 전에는 편집기·3D 로 넘어가지 않는다.
 * 검수 화면이 쓰는 두 가지를 더한다.
 */

/* 검수 화면이 원본 그림을 반투명으로 깔려면 그 그림이 남아 있어야 한다 */
alter table public.plan_ingest_jobs add column if not exists image_url text;

/* 사람이 확인을 눌렀는가. doc 안의 review.status 와 같은 값을 밖에서도 걸러 보려고 둔다 */
alter table public.plan_ingest_jobs add column if not exists review_status text
  not null default 'auto';

/*
 * 사람이 무엇을 고쳤나.
 *
 * 통계용이다. 매번 같은 자리를 고치고 있다면 그건 파서가 거기서 틀린다는 뜻이고,
 * 무엇이 자주 틀리는지 알아야 다음에 무엇을 고칠지 정할 수 있다. 도면 자체가 아니라
 * **고친 항목의 종류와 값**만 담으므로 남의 집 평면이 새지 않는다.
 */
create table if not exists public.plan_review_edits (
  id bigserial primary key,
  job_id text not null references public.plan_ingest_jobs (id) on delete cascade,
  owner_id uuid references auth.users (id) on delete cascade,

  /* wall-move · room-split · scale … */
  kind text not null,
  target text not null,
  before_value text,
  after_value text,

  created_at timestamptz not null default now()
);

create index if not exists plan_review_edits_job_idx
  on public.plan_review_edits (job_id);

create index if not exists plan_review_edits_kind_idx
  on public.plan_review_edits (kind, created_at desc);

alter table public.plan_review_edits enable row level security;

/* 자기 것만 본다. 남이 무엇을 고쳤는지는 남의 도면 이야기다 */
drop policy if exists "plan_review_edits_select_own" on public.plan_review_edits;
create policy "plan_review_edits_select_own"
  on public.plan_review_edits
  for select
  using (auth.uid() = owner_id);

/* 쓰기는 서버(service role)만 한다 — 브라우저가 통계를 지어낼 수 있으면 통계가 아니다 */
revoke insert, update, delete on public.plan_review_edits from anon, authenticated;
grant select on public.plan_review_edits to authenticated;
