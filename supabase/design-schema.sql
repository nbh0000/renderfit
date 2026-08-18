-- 렌더핏 — AI Interior Design Studio 스키마
-- (기본 스키마는 supabase/schema.sql, 이 파일은 Scene 기반 에디터용이다)
--
-- Supabase가 설정되지 않은 개발 환경에서는 .data/projects 의 로컬 파일 저장소가 쓰인다.
-- 두 저장소는 lib/db/index.ts 의 ProjectRepository 인터페이스를 공유한다.

create extension if not exists pgcrypto;
-- 에셋/스타일 임베딩 검색 확장 대비 (실제 사용은 EmbeddingProvider 교체 이후)
create extension if not exists vector;

/* ───────────────────────────── Storage 버킷 ───────────────────────────── */

-- 에디터가 쓰는 모든 파일(원본 사진, 생성 이미지, depth/segmentation, 마스크, 렌더).
-- 비공개로 두고 앱의 /api/files/* 라우트가 서비스 롤로 중계한다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'scene-files',
  'scene-files',
  false,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'model/gltf-binary', 'application/json']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/* ─────────────────────────── design_projects ─────────────────────────── */

create table if not exists public.design_projects (
  id text primary key,
  owner_id uuid references auth.users (id) on delete cascade,
  name text not null,
  status text not null default 'draft' check (status in ('draft', 'analyzing', 'generating', 'ready')),
  thumbnail_url text,
  -- Scene Graph 전체 (scene/types 의 Scene)
  scene jsonb not null,
  -- operation 로그 (undo 스택)
  operations jsonb not null default '[]'::jsonb,
  redo_stack jsonb not null default '[]'::jsonb,
  -- 버전 스냅샷
  versions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists design_projects_owner_idx
  on public.design_projects (owner_id, updated_at desc);

alter table public.design_projects enable row level security;

drop policy if exists "디자인 프로젝트 조회는 본인만" on public.design_projects;
create policy "디자인 프로젝트 조회는 본인만" on public.design_projects
  for select using (auth.uid() = owner_id);

drop policy if exists "디자인 프로젝트 생성은 본인만" on public.design_projects;
create policy "디자인 프로젝트 생성은 본인만" on public.design_projects
  for insert with check (auth.uid() = owner_id);

drop policy if exists "디자인 프로젝트 수정은 본인만" on public.design_projects;
create policy "디자인 프로젝트 수정은 본인만" on public.design_projects
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "디자인 프로젝트 삭제는 본인만" on public.design_projects;
create policy "디자인 프로젝트 삭제는 본인만" on public.design_projects
  for delete using (auth.uid() = owner_id);

/* ───────────── 정규화 테이블 (분석/통계용 · 앱은 jsonb를 우선 사용) ───────────── */

-- Scene 객체를 행 단위로도 조회하고 싶을 때 사용한다.
create table if not exists public.scene_objects (
  id text primary key,
  project_id text not null references public.design_projects (id) on delete cascade,
  type text not null,
  category text,
  name text,
  asset_id text,
  material_id text,
  transform jsonb not null default '{}'::jsonb,
  dimensions jsonb not null default '{}'::jsonb,
  screen jsonb not null default '{}'::jsonb,
  depth real,
  confidence real,
  source text,
  created_at timestamptz not null default now()
);

create index if not exists scene_objects_project_idx on public.scene_objects (project_id);

-- operation 히스토리를 장기 보관하고 싶을 때 사용한다 (앱은 jsonb 컬럼을 사용).
create table if not exists public.operations (
  id text primary key,
  project_id text not null references public.design_projects (id) on delete cascade,
  type text not null,
  object_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index if not exists operations_project_idx on public.operations (project_id, created_at desc);

create table if not exists public.scene_versions (
  id text primary key,
  project_id text not null references public.design_projects (id) on delete cascade,
  version integer not null,
  label text,
  scene jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_jobs (
  id text primary key,
  project_id text not null references public.design_projects (id) on delete cascade,
  type text not null,
  state text not null default 'queued' check (state in ('queued', 'processing', 'completed', 'failed')),
  progress integer not null default 0,
  message text,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_jobs_project_idx on public.ai_jobs (project_id, created_at desc);

create table if not exists public.renders (
  id text primary key,
  project_id text not null references public.design_projects (id) on delete cascade,
  quality text not null check (quality in ('preview', 'final')),
  image_url text not null,
  duration_ms integer,
  provider text,
  created_at timestamptz not null default now()
);

create table if not exists public.images (
  id text primary key,
  project_id text not null references public.design_projects (id) on delete cascade,
  kind text not null check (kind in ('source', 'generated', 'depth', 'segmentation', 'mask', 'render')),
  url text not null,
  width integer,
  height integer,
  created_at timestamptz not null default now()
);

create table if not exists public.prompts (
  id text primary key,
  project_id text references public.design_projects (id) on delete cascade,
  instruction text not null,
  intent text,
  tool_calls jsonb,
  created_at timestamptz not null default now()
);

/* ───────────────────────── 에셋 · 재질 카탈로그 ───────────────────────── */
-- 코드(models/*.ts)가 단일 출처이며, 아래 테이블은 사용자 업로드 에셋 확장을 위한 자리다.

create table if not exists public.assets (
  id text primary key,
  name text not null,
  category text not null,
  type text not null,
  style text[] not null default '{}',
  dimensions jsonb not null,
  thumbnail_url text,
  model_url text,
  tags text[] not null default '{}',
  -- 자연어 에셋 검색용 (pgvector). 차원은 사용할 임베딩 모델에 맞춰 조정한다.
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create table if not exists public.materials (
  id text primary key,
  name text not null,
  base_color text not null,
  roughness real not null default 0.8,
  metallic real not null default 0,
  texture_url text,
  scale real not null default 1,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- 임베딩 검색 인덱스 (데이터가 쌓인 뒤 생성 권장)
-- create index on public.assets using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table public.scene_objects enable row level security;
alter table public.operations enable row level security;
alter table public.scene_versions enable row level security;
alter table public.ai_jobs enable row level security;
alter table public.renders enable row level security;
alter table public.images enable row level security;
alter table public.prompts enable row level security;

-- 하위 테이블은 프로젝트 소유자만 접근한다.
do $$
declare
  t text;
begin
  foreach t in array array['scene_objects', 'operations', 'scene_versions', 'ai_jobs', 'renders', 'images', 'prompts']
  loop
    execute format('drop policy if exists "소유자만 접근" on public.%I', t);
    execute format(
      'create policy "소유자만 접근" on public.%I for all using (exists (select 1 from public.design_projects p where p.id = %I.project_id and p.owner_id = auth.uid()))',
      t, t
    );
  end loop;
end;
$$;

-- 에셋/재질 카탈로그는 모두가 읽을 수 있다.
alter table public.assets enable row level security;
alter table public.materials enable row level security;

drop policy if exists "에셋은 공개 조회" on public.assets;
create policy "에셋은 공개 조회" on public.assets for select using (true);

drop policy if exists "재질은 공개 조회" on public.materials;
create policy "재질은 공개 조회" on public.materials for select using (true);
