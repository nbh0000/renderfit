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

export function memoryPublish(item: Omit<GalleryItem, "slug" | "title">): GalleryItem {
  const base = buildSlug(item.roomId, item.styleId);
  let slug = base;
  let n = 2;
  while (memory.has(slug)) slug = `${base}-${n++}`;

  const record: GalleryItem = { ...item, slug, title: buildTitle(item.roomId, item.styleId) };
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
  generation_jobs: { room_id: string; style_id: string } | null;
}

const PUBLIC_SELECT =
  "slug, storage_path, width, height, created_at, generation_jobs!inner (room_id, style_id)";

function toItem(supabase: SupabaseClient, row: PublicRow): GalleryItem {
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
  };
}

export async function listPublicResults(
  supabase: SupabaseClient,
  limit = 60
): Promise<GalleryItem[]> {
  const { data, error } = await supabase
    .from("generation_results")
    .select(PUBLIC_SELECT)
    .eq("is_public", true)
    .not("slug", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return (data as unknown as PublicRow[]).map((row) => toItem(supabase, row));
}

export async function getPublicResult(
  supabase: SupabaseClient,
  slug: string
): Promise<GalleryItem | null> {
  const { data, error } = await supabase
    .from("generation_results")
    .select(PUBLIC_SELECT)
    .eq("slug", slug)
    .eq("is_public", true)
    .maybeSingle();

  if (error || !data) return null;
  return toItem(supabase, data as unknown as PublicRow);
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

export async function unpublishResult(
  supabase: SupabaseClient,
  resultId: string
): Promise<boolean> {
  const { error } = await supabase
    .from("generation_results")
    .update({ is_public: false, slug: null })
    .eq("id", resultId);
  return !error;
}
