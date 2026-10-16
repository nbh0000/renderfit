import type { SupabaseClient } from "@supabase/supabase-js";
import type { Viewer } from "@/lib/auth";
import { authorLabel, displayNameFor } from "@/lib/gallery";

/**
 * 갤러리 소통 — 시안별 댓글과 갤러리 실시간 대화.
 *
 * 두 종류 모두 사용자 세션으로 직접 쓴다. "내 글인가"는 RLS 가 본다.
 * 작성자 이름은 쓰는 시점에 행에 적어 둔다 (profiles 는 본인만 조회할 수 있다).
 */

export interface Comment {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
  /** 지금 보는 사람이 지울 수 있는지 (쓴 사람 또는 시안 주인) */
  canDelete: boolean;
}

export interface ChatMessage {
  id: string;
  userId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export const COMMENT_MAX = 500;
export const CHAT_MAX = 300;

/** 한 번에 불러오는 대화 수 — 창이 작아 이 이상은 스크롤로도 보지 않는다 */
export const CHAT_PAGE = 80;

/**
 * 글 본문 정리.
 *
 * 앞뒤 공백을 떼고 길이를 본다. 빈 글은 저장하지 않는다.
 * 줄바꿈은 두 개까지만 남긴다 — 엔터를 수십 번 쳐서 창을 밀어내는 것을 막는다.
 */
export function normalizeBody(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const body = raw
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!body || body.length > max) return null;
  return body;
}

/** 글에 적을 이름 — 갤러리 작성자 이름과 같은 규칙 (이메일은 아이디 부분만) */
export function viewerAuthorName(viewer: Viewer): string {
  return displayNameFor({
    full_name: viewer.profile?.fullName,
    email: viewer.profile?.email ?? viewer.authEmail,
  });
}

/* ─────────────────── 로컬 mock 저장소 (Supabase 미설정) ─────────────────── */

const globalRef = globalThis as unknown as {
  __interiorComments?: Map<string, Comment[]>;
  __interiorChat?: ChatMessage[];
};
const commentMemory = globalRef.__interiorComments ?? (globalRef.__interiorComments = new Map());
const chatMemory = globalRef.__interiorChat ?? (globalRef.__interiorChat = []);

let seq = 0;
const nextId = () => `local-${Date.now().toString(36)}-${++seq}`;

export function memoryListComments(slug: string): Comment[] {
  return commentMemory.get(slug) ?? [];
}

export function memoryAddComment(slug: string, body: string): Comment {
  const comment: Comment = {
    id: nextId(),
    authorName: "나",
    body,
    createdAt: new Date().toISOString(),
    canDelete: true,
  };
  commentMemory.set(slug, [...memoryListComments(slug), comment]);
  return comment;
}

export function memoryDeleteComment(slug: string, id: string): boolean {
  const list = memoryListComments(slug);
  const next = list.filter((comment) => comment.id !== id);
  commentMemory.set(slug, next);
  return next.length !== list.length;
}

export function memoryListChat(): ChatMessage[] {
  return chatMemory.slice(-CHAT_PAGE);
}

export function memoryAddChat(body: string): ChatMessage {
  const message: ChatMessage = {
    id: nextId(),
    userId: "local",
    authorName: "나",
    body,
    createdAt: new Date().toISOString(),
  };
  chatMemory.push(message);
  return message;
}

export function memoryDeleteChat(id: string): boolean {
  const index = chatMemory.findIndex((message) => message.id === id);
  if (index === -1) return false;
  chatMemory.splice(index, 1);
  return true;
}

/* ────────────────────────────── 댓글 ────────────────────────────── */

interface CommentRow {
  id: string;
  user_id: string;
  author_name: string | null;
  body: string;
  created_at: string;
}

/** slug 로 공개 시안의 id 와 주인을 찾는다. 공개되지 않은 시안에는 댓글을 달 수 없다 */
async function findPublicResult(
  supabase: SupabaseClient,
  slug: string
): Promise<{ id: string; ownerId: string } | null> {
  const { data } = await supabase
    .from("generation_results")
    .select("id, user_id")
    .eq("slug", slug)
    .eq("is_public", true)
    .maybeSingle();
  const row = data as { id: string; user_id: string } | null;
  return row ? { id: row.id, ownerId: row.user_id } : null;
}

function toComment(row: CommentRow, viewerId: string | null, ownerId: string): Comment {
  return {
    id: row.id,
    authorName: authorLabel(row.author_name),
    body: row.body,
    createdAt: row.created_at,
    canDelete: Boolean(viewerId && (viewerId === row.user_id || viewerId === ownerId)),
  };
}

/**
 * 시안의 댓글을 오래된 순으로 읽는다.
 * 테이블이 아직 없는 DB 에서는 빈 목록을 돌려준다 — 갤러리는 그대로 보여야 한다.
 */
export async function listComments(
  supabase: SupabaseClient,
  slug: string,
  viewerId: string | null
): Promise<Comment[]> {
  const result = await findPublicResult(supabase, slug);
  if (!result) return [];

  const { data, error } = await supabase
    .from("gallery_comments")
    .select("id, user_id, author_name, body, created_at")
    .eq("result_id", result.id)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error || !data) return [];
  return (data as CommentRow[]).map((row) => toComment(row, viewerId, result.ownerId));
}

export async function addComment(
  supabase: SupabaseClient,
  slug: string,
  viewer: { userId: string; authorName: string },
  body: string
): Promise<Comment | { error: string }> {
  const result = await findPublicResult(supabase, slug);
  if (!result) return { error: "시안을 찾을 수 없습니다." };

  const { data, error } = await supabase
    .from("gallery_comments")
    .insert({
      result_id: result.id,
      user_id: viewer.userId,
      author_name: viewer.authorName,
      body,
    })
    .select("id, user_id, author_name, body, created_at")
    .single();

  if (error || !data) {
    console.error("댓글 저장 실패", error?.code, error?.message);
    return { error: "댓글을 저장하지 못했습니다." };
  }
  return toComment(data as CommentRow, viewer.userId, result.ownerId);
}

/**
 * 댓글 삭제. 누가 지울 수 있는지는 RLS 가 본다 — 조건에 안 맞으면 지워진 행이 0개다.
 * 관리자는 서비스 롤(writer)로 지운다.
 */
export async function deleteComment(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("gallery_comments")
    .delete()
    .eq("id", id)
    .select("id");
  return !error && Boolean(data && data.length > 0);
}

/* ────────────────────────────── 실시간 대화 ────────────────────────────── */

interface ChatRow {
  id: string;
  user_id: string;
  author_name: string | null;
  body: string;
  created_at: string;
}

export function toChatMessage(row: ChatRow): ChatMessage {
  return {
    id: row.id,
    userId: row.user_id,
    authorName: authorLabel(row.author_name),
    body: row.body,
    createdAt: row.created_at,
  };
}

/** 최근 대화를 오래된 순으로 — 창에 위에서 아래로 쌓인다 */
export async function listChat(supabase: SupabaseClient): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("gallery_chat_messages")
    .select("id, user_id, author_name, body, created_at")
    .order("created_at", { ascending: false })
    .limit(CHAT_PAGE);

  if (error || !data) return [];
  return (data as ChatRow[]).map(toChatMessage).reverse();
}

export async function addChat(
  supabase: SupabaseClient,
  viewer: { userId: string; authorName: string },
  body: string
): Promise<ChatMessage | { error: string }> {
  const { data, error } = await supabase
    .from("gallery_chat_messages")
    .insert({ user_id: viewer.userId, author_name: viewer.authorName, body })
    .select("id, user_id, author_name, body, created_at")
    .single();

  if (error || !data) {
    console.error("대화 저장 실패", error?.code, error?.message);
    return { error: "메시지를 보내지 못했습니다." };
  }
  return toChatMessage(data as ChatRow);
}

export async function deleteChat(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("gallery_chat_messages")
    .delete()
    .eq("id", id)
    .select("id");
  return !error && Boolean(data && data.length > 0);
}
