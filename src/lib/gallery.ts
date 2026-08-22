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
  likeCount: number;
  /** 지금 보는 사람이 좋아요를 눌러 뒀는지 */
  likedByViewer: boolean;
  /** 전/후 비교에 쓰는 원본 사진. 공개 전 만들어진 항목은 없을 수 있다 */
  beforeUrl: string | null;
  /** 지금 보는 사람이 이 항목을 내릴 수 있는지 */
  canDelete: boolean;
  /** 생성에 쓰인 전체 프롬프트 — 어떤 지시로 만든 결과인지 보여 준다 */
  prompt: string | null;
}

/** 갤러리 목록 정렬 기준 */
export type GallerySort = "recent" | "popular" | "views";

export const GALLERY_SORTS: { id: GallerySort; label: string }[] = [
  { id: "recent", label: "최신순" },
  { id: "popular", label: "좋아요순" },
  { id: "views", label: "조회순" },
];

/** 쿼리스트링으로 들어온 값을 정렬 기준으로 (모르는 값이면 최신순) */
export function parseSort(value: string | undefined): GallerySort {
  return GALLERY_SORTS.some((sort) => sort.id === value) ? (value as GallerySort) : "recent";
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

/**
 * 카드 위에 잠깐 얹을 만큼 짧은 디자인 설명.
 *
 * 스타일 프롬프트는 "모던 스타일: A, B, C." 꼴이라 접두어를 떼고 앞의 두 마디만 남긴다.
 * 목록에서 어떤 결의 시안인지 가늠하는 용도라 문장을 다 보여 줄 필요는 없다.
 */
export function styleBlurb(styleId: StyleId): string {
  if (styleId === "custom") return "참고 이미지의 색과 마감을 그대로 옮긴 시안";

  const fragment = STYLE_MAP[styleId]?.promptFragment ?? "";
  const colon = fragment.indexOf(":");
  const body = colon === -1 ? fragment : fragment.slice(colon + 1);

  return body
    .replace(/\.\s*$/, "")
    .split(",")
    .map((clause) => clause.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" · ");
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
  item: Omit<
    GalleryItem,
    "slug" | "title" | "viewCount" | "likeCount" | "likedByViewer" | "canDelete" | "prompt"
  >
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
    likeCount: 0,
    likedByViewer: false,
    canDelete: true,
    prompt: null,
  };
  memory.set(slug, record);
  return record;
}

/** 정렬 비교 — 같은 값이면 최신 것이 앞으로 온다 */
export function compareBySort(sort: GallerySort) {
  return (a: GalleryItem, b: GalleryItem): number => {
    if (sort === "popular" && a.likeCount !== b.likeCount) return b.likeCount - a.likeCount;
    if (sort === "views" && a.viewCount !== b.viewCount) return b.viewCount - a.viewCount;
    return b.createdAt.localeCompare(a.createdAt);
  };
}

export function memoryListGallery(sort: GallerySort = "recent"): GalleryItem[] {
  return [...memory.values()].sort(compareBySort(sort));
}

/**
 * mock 모드 좋아요 토글.
 * 로그인 개념이 없으므로 눌렀는지 여부만 항목에 기억해 둔다.
 */
export function memoryToggleLike(slug: string): { liked: boolean; likeCount: number } | null {
  const item = memory.get(slug);
  if (!item) return null;

  const liked = !item.likedByViewer;
  const likeCount = Math.max(0, item.likeCount + (liked ? 1 : -1));
  memory.set(slug, { ...item, likedByViewer: liked, likeCount });
  return { liked, likeCount };
}

export function memoryGetGallery(slug: string): GalleryItem | undefined {
  return memory.get(slug);
}

/* ────────────────────────────── Supabase ────────────────────────────── */

interface PublicRow {
  id: string;
  slug: string;
  storage_path: string;
  width: number;
  height: number;
  created_at: string;
  author_name: string | null;
  view_count: number | null;
  like_count: number | null;
  before_path: string | null;
  user_id: string;
  generation_jobs: { room_id: string; style_id: string; prompt?: string | null } | null;
}

const BASE_COLUMNS = "id, slug, storage_path, width, height, created_at, user_id";
const JOB_COLUMNS = "generation_jobs!inner (room_id, style_id, prompt)";

/**
 * 마이그레이션을 어디까지 돌렸는지 모르는 DB에서도 갤러리가 열려야 한다.
 *
 * 위에서부터 시도하고 "그런 컬럼 없음"(42703)이면 한 단계 내려간다.
 * 컬럼이 없는 단계에서는 그 컬럼으로 정렬할 수도 없으므로 최신순으로 물러난다.
 */
const TIERS = [
  {
    select: `${BASE_COLUMNS}, author_name, view_count, like_count, before_path, ${JOB_COLUMNS}`,
    likes: true,
    counters: true,
  },
  {
    select: `${BASE_COLUMNS}, author_name, view_count, before_path, ${JOB_COLUMNS}`,
    likes: false,
    counters: true,
  },
  { select: `${BASE_COLUMNS}, ${JOB_COLUMNS}`, likes: false, counters: false },
];

/** 42703 = undefined_column */
function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "42703";
}

/** 정렬에 쓸 컬럼 — 그 컬럼이 없는 DB에서는 최신순으로 물러난다 */
function orderColumn(sort: GallerySort, tier: (typeof TIERS)[number]): string {
  if (sort === "popular" && tier.likes) return "like_count";
  if (sort === "views" && tier.counters) return "view_count";
  return "created_at";
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
    likeCount: row.like_count ?? 0,
    // 내가 눌렀는지는 gallery_likes를 따로 읽어 채운다 (markLiked)
    likedByViewer: false,
    beforeUrl: row.before_path
      ? supabase.storage.from(RESULTS_BUCKET).getPublicUrl(row.before_path).data.publicUrl
      : null,
    canDelete: Boolean(viewerId && viewerId === row.user_id),
    prompt: row.generation_jobs?.prompt ?? null,
  };
}

/**
 * 지금 보는 사람이 좋아요를 눌러 둔 항목에 표시를 남긴다.
 *
 * gallery_likes는 "본인 것만" 읽히므로 한 번 조회하면 내 좋아요만 돌아온다.
 * 테이블이 아직 없는 DB에서는 조용히 넘어간다 — 목록은 그대로 보여야 한다.
 */
async function markLiked(
  supabase: SupabaseClient,
  rows: PublicRow[],
  items: GalleryItem[],
  viewerId?: string | null
): Promise<GalleryItem[]> {
  if (!viewerId || rows.length === 0) return items;

  const { data, error } = await supabase
    .from("gallery_likes")
    .select("result_id")
    .eq("user_id", viewerId)
    .in(
      "result_id",
      rows.map((row) => row.id)
    );

  if (error || !data) return items;

  const liked = new Set((data as { result_id: string }[]).map((row) => row.result_id));
  return items.map((item, index) =>
    liked.has(rows[index].id) ? { ...item, likedByViewer: true } : item
  );
}

export interface ListOptions {
  limit?: number;
  sort?: GallerySort;
  /** 좋아요 표시를 채울 사람 */
  viewerId?: string | null;
}

export async function listPublicResults(
  supabase: SupabaseClient,
  options: ListOptions = {}
): Promise<GalleryItem[]> {
  const { limit = 60, sort = "recent", viewerId = null } = options;

  for (const tier of TIERS) {
    const { data, error } = await supabase
      .from("generation_results")
      .select(tier.select)
      .eq("is_public", true)
      .not("slug", "is", null)
      .order(orderColumn(sort, tier), { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (isMissingColumn(error)) continue;
    if (error || !data) return [];

    const rows = data as unknown as PublicRow[];
    return markLiked(
      supabase,
      rows,
      rows.map((row) => toItem(supabase, row, viewerId)),
      viewerId
    );
  }

  return [];
}

export async function getPublicResult(
  supabase: SupabaseClient,
  slug: string,
  viewerId?: string | null
): Promise<GalleryItem | null> {
  for (const tier of TIERS) {
    const { data, error } = await supabase
      .from("generation_results")
      .select(tier.select)
      .eq("slug", slug)
      .eq("is_public", true)
      .maybeSingle();

    if (isMissingColumn(error)) continue;
    if (error || !data) return null;

    const row = data as unknown as PublicRow;
    const [item] = await markLiked(supabase, [row], [toItem(supabase, row, viewerId)], viewerId);
    return item;
  }

  return null;
}

/**
 * 좋아요를 켜고 끈다.
 *
 * 등록·취소·합계 갱신이 한 트랜잭션 안에서 끝나야 하므로 DB 함수를 부른다.
 * (합계를 앱에서 세면 동시에 누른 두 사람이 서로의 증가분을 덮어쓴다)
 */
export async function toggleLike(
  supabase: SupabaseClient,
  slug: string
): Promise<{ liked: boolean; likeCount: number } | { error: string }> {
  const { data, error } = await supabase.rpc("toggle_gallery_like", { p_slug: slug });

  if (error) {
    if (error.message?.includes("AUTH_REQUIRED")) return { error: "로그인이 필요합니다." };
    if (error.message?.includes("NOT_FOUND")) return { error: "시안을 찾을 수 없습니다." };
    return { error: "좋아요를 반영하지 못했습니다." };
  }

  const row = (data as { liked: boolean; like_count: number }[] | null)?.[0];
  if (!row) return { error: "좋아요를 반영하지 못했습니다." };

  return { liked: row.liked, likeCount: row.like_count };
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
