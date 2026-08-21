import type { SupabaseClient } from "@supabase/supabase-js";
import { ROOM_MAP, type RoomId } from "@/config/rooms";
import { STYLE_MAP, type StyleId } from "@/config/styles";
import { RESULTS_BUCKET } from "@/lib/supabase/env";

export interface GalleryItem {
  slug: string;
  title: string;
  imageUrl: string;
  roomId: RoomId;
  styleId: StyleId;
  roomLabel: string;
  styleLabel: string;
  width: number;
  height: number;
  createdAt: string;
  /** 공개한 사람의 표시 이름 */
  authorName: string;
  viewCount: number;
  /** 전/후 비교에 쓰는 원본 사진. 공개 전 만들어진 항목은 없을 수 있다 */
  beforeUrl: string | null;
  /** 지금 보는 사람이 이 항목을 내릴 수 있는지 */
  canDelete: boolean;
  /** 생성에 쓰인 전체 프롬프트 — 어떤 지시로 만든 결과인지 보여 준다 */
  prompt: string | null;
}

/**
 * 갤러리에 노출할 이름을 정한다.
 * 이메일 전체를 쓰면 개인정보가 그대로 새므로 아이디 부분만 남긴다.
 */
export function displayNameFor(profile: { full_name?: string | null; email?: string | null }): string {
  const name = profile.full_name?.trim();
  if (name) return name;
  const local = profile.email?.split("@")[0]?.trim();
  return local || "익명";
}

/* ────────────────────────── slug / title 규칙 ────────────────────────── */

/** slug 패턴: "{방종류}-{스타일}-인테리어" (예: 아파트-거실-북유럽-인테리어) */
export function buildSlug(roomId: string, styleId: string): string {
  const room = ROOM_MAP[roomId as RoomId]?.slug ?? "공간";
  const style = STYLE_MAP[styleId as StyleId]?.label ?? "스타일";
  return `${room}-${style}-인테리어`.replace(/\s+/g, "-");
}

/** title 패턴: slug와 같은 구성 (예: 아파트 거실 북유럽 인테리어) */
export function buildTitle(roomId: string, styleId: string): string {
  const room = ROOM_MAP[roomId as RoomId]?.label ?? "공간";
  const style = STYLE_MAP[styleId as StyleId]?.label ?? "스타일";
  return `${room} ${style} 인테리어`;
}

/* ─────────────────── 로컬 mock 저장소 (Supabase 미설정) ─────────────────── */

const globalRef = globalThis as unknown as { __interiorGallery?: Map<string, GalleryItem> };
const memory: Map<string, GalleryItem> =
  globalRef.__interiorGallery ?? (globalRef.__interiorGallery = new Map());

export function memoryPublish(
  item: Omit<GalleryItem, "slug" | "title" | "viewCount" | "canDelete" | "prompt">
): GalleryItem {
  const base = buildSlug(item.roomId, item.styleId);
  let slug = base;
  let n = 2;
  while (memory.has(slug)) slug = `${base}-${n++}`;

  const record: GalleryItem = {
    ...item,
    slug,
    title: buildTitle(item.roomId, item.styleId),
    viewCount: 0,
    canDelete: true,
    prompt: null,
  };
  memory.set(slug, record);
  return record;
}

export function memoryListGallery(): GalleryItem[] {
  return [...memory.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function memoryGetGallery(slug: string): GalleryItem | undefined {
  return memory.get(slug);
}

/* ────────────────────────────── Supabase ────────────────────────────── */

interface PublicRow {
  slug: string;
  storage_path: string;
  width: number;
  height: number;
  created_at: string;
  author_name: string | null;
  view_count: number | null;
  before_path: string | null;
  user_id: string;
  generation_jobs: { room_id: string; style_id: string; prompt?: string | null } | null;
}

const PUBLIC_SELECT =
  "slug, storage_path, width, height, created_at, author_name, view_count, before_path, user_id, generation_jobs!inner (room_id, style_id, prompt)";

/**
 * 갤러리 컬럼(author_name·view_count·before_path)이 아직 없는 DB에서도 동작하도록
 * 예전 컬럼만으로 다시 조회한다. 마이그레이션 전에는 작성자·조회수만 비어 보인다.
 */
const LEGACY_SELECT =
  "slug, storage_path, width, height, created_at, user_id, generation_jobs!inner (room_id, style_id, prompt)";

/** 42703 = undefined_column */
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "42703";
}

function toItem(supabase: SupabaseClient, row: PublicRow, viewerId?: string | null): GalleryItem {
  const roomId = (row.generation_jobs?.room_id ?? "living-room") as RoomId;
  const styleId = (row.generation_jobs?.style_id ?? "modern") as StyleId;
  return {
    slug: row.slug,
    title: buildTitle(roomId, styleId),
    imageUrl: supabase.storage.from(RESULTS_BUCKET).getPublicUrl(row.storage_path).data.publicUrl,
    roomId,
    styleId,
    roomLabel: ROOM_MAP[roomId]?.label ?? "공간",
    styleLabel: STYLE_MAP[styleId]?.label ?? "스타일",
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
    authorName: row.author_name?.trim() || "익명",
    viewCount: row.view_count ?? 0,
    beforeUrl: row.before_path
      ? supabase.storage.from(RESULTS_BUCKET).getPublicUrl(row.before_path).data.publicUrl
      : null,
    canDelete: Boolean(viewerId && viewerId === row.user_id),
    prompt: row.generation_jobs?.prompt ?? null,
  };
}

export async function listPublicResults(
  supabase: SupabaseClient,
  limit = 60
): Promise<GalleryItem[]> {
  const query = (select: string) =>
    supabase
      .from("generation_results")
      .select(select)
      .eq("is_public", true)
      .not("slug", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);

  let { data, error } = await query(PUBLIC_SELECT);
  if (isMissingColumn(error)) ({ data, error } = await query(LEGACY_SELECT));

  if (error || !data) return [];
  return (data as unknown as PublicRow[]).map((row) => toItem(supabase, row));
}

export async function getPublicResult(
  supabase: SupabaseClient,
  slug: string,
  viewerId?: string | null
): Promise<GalleryItem | null> {
  const query = (select: string) =>
    supabase
      .from("generation_results")
      .select(select)
      .eq("slug", slug)
      .eq("is_public", true)
      .maybeSingle();

  let { data, error } = await query(PUBLIC_SELECT);
  if (isMissingColumn(error)) ({ data, error } = await query(LEGACY_SELECT));

  if (error || !data) return null;
  return toItem(supabase, data as unknown as PublicRow, viewerId);
}

/**
 * 갤러리에서 내린다.
 *
 * 시안 자체는 지우지 않는다 — 공개만 해제하고 갤러리용 원본 사본을 정리한다.
 * 결과물은 본인 보관함에 그대로 남아 다시 공개할 수 있다.
 * RLS의 "결과 수정은 본인만" 정책이 남의 항목을 막아 준다.
 */
export async function unpublishResult(
  supabase: SupabaseClient,
  slug: string,
  userId: string
): Promise<boolean> {
  const read = await supabase
    .from("generation_results")
    .select("id, before_path")
    .eq("slug", slug)
    .eq("user_id", userId)
    .maybeSingle();

  let row = read.data as { id: string; before_path?: string | null } | null;

  if (isMissingColumn(read.error)) {
    ({ data: row } = await supabase
      .from("generation_results")
      .select("id")
      .eq("slug", slug)
      .eq("user_id", userId)
      .maybeSingle());
  }

  if (!row) return false;

  const patch: Record<string, unknown> = { is_public: false, slug: null };
  if ("before_path" in row) patch.before_path = null;

  const { error } = await supabase
    .from("generation_results")
    .update(patch)
    .eq("id", row.id)
    .eq("user_id", userId);

  if (error) return false;

  const beforePath = (row as { before_path?: string | null }).before_path ?? null;
  if (beforePath) await supabase.storage.from(RESULTS_BUCKET).remove([beforePath]);

  return true;
}

/** 상세 페이지 조회수 +1. 실패해도 페이지는 그대로 보여 준다. */
export async function bumpViewCount(supabase: SupabaseClient, slug: string): Promise<void> {
  await supabase.rpc("increment_gallery_view", { p_slug: slug });
}

/** 공개 동의 처리 — 중복되지 않는 slug를 붙여 준다. */
export async function publishResult(
  supabase: SupabaseClient,
  resultId: string,
  roomId: string,
  styleId: string
): Promise<{ slug: string } | null> {
  const base = buildSlug(roomId, styleId);

  for (let attempt = 0; attempt < 8; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const { error } = await supabase
      .from("generation_results")
      .update({ is_public: true, slug })
      .eq("id", resultId);

    if (!error) return { slug };
    // 23505 = unique_violation → 다음 후보로
    if ((error as { code?: string }).code !== "23505") return null;
  }

  const fallback = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  const { error } = await supabase
    .from("generation_results")
    .update({ is_public: true, slug: fallback })
    .eq("id", resultId);

  return error ? null : { slug: fallback };
}

/** 결과 id로 공개를 해제한다 (스튜디오 결과 카드에서 되돌릴 때) */
export async function unpublishResultById(
  supabase: SupabaseClient,
  resultId: string
): Promise<boolean> {
  const { error } = await supabase
    .from("generation_results")
    .update({ is_public: false, slug: null })
    .eq("id", resultId);
  return !error;
}
