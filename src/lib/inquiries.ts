import type { SupabaseClient } from "@supabase/supabase-js";
import { notify } from "@/lib/alerts";

/**
 * 고객 문의.
 *
 * 남기는 것은 서버(서비스 롤)가 대신 쓰고, 들어오는 즉시 운영자에게 알린다 —
 * 관리자 화면을 하루 종일 열어 두지 않아도 놓치지 않게. 답변은 관리자 화면에서
 * 적고, 로그인해서 남긴 문의라면 본인이 /contact 에서 답변을 본다.
 */

export type InquiryCategory = "general" | "payment" | "refund" | "bug" | "other";
export type InquiryStatus = "open" | "answered" | "closed";

export const INQUIRY_CATEGORIES: { id: InquiryCategory; label: string }[] = [
  { id: "general", label: "이용 문의" },
  { id: "payment", label: "결제" },
  { id: "refund", label: "환불·취소" },
  { id: "bug", label: "오류 신고" },
  { id: "other", label: "기타" },
];

export const INQUIRY_STATUS_LABEL: Record<InquiryStatus, string> = {
  open: "대기",
  answered: "답변함",
  closed: "종료",
};

export const SUBJECT_MAX = 120;
export const BODY_MAX = 3000;

export interface Inquiry {
  id: string;
  userId: string | null;
  name: string;
  email: string;
  category: InquiryCategory;
  subject: string;
  body: string;
  status: InquiryStatus;
  reply: string | null;
  adminNote: string | null;
  answeredAt: string | null;
  createdAt: string;
}

interface InquiryRow {
  id: string;
  user_id: string | null;
  name: string;
  email: string;
  category: string;
  subject: string;
  body: string;
  status: string;
  reply: string | null;
  admin_note: string | null;
  answered_at: string | null;
  created_at: string;
}

const COLUMNS =
  "id, user_id, name, email, category, subject, body, status, reply, admin_note, answered_at, created_at";

export function isInquiryCategory(value: unknown): value is InquiryCategory {
  return INQUIRY_CATEGORIES.some((c) => c.id === value);
}

export function isInquiryStatus(value: unknown): value is InquiryStatus {
  return typeof value === "string" && value in INQUIRY_STATUS_LABEL;
}

export function toInquiry(row: InquiryRow): Inquiry {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    category: isInquiryCategory(row.category) ? row.category : "other",
    subject: row.subject,
    body: row.body,
    status: isInquiryStatus(row.status) ? row.status : "open",
    reply: row.reply,
    adminNote: row.admin_note,
    answeredAt: row.answered_at,
    createdAt: row.created_at,
  };
}

export interface InquiryInput {
  name: string;
  email: string;
  category: InquiryCategory;
  subject: string;
  body: string;
}

/** 문의 폼 입력 검사 — 통과하면 저장할 값, 아니면 사람에게 보여 줄 이유 */
export function validateInquiry(
  input: Record<string, unknown>
): { ok: true; value: InquiryInput } | { ok: false; error: string } {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 60) : "";
  const email = typeof input.email === "string" ? input.email.trim().slice(0, 200) : "";
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";

  if (!name) return { ok: false, error: "이름을 적어 주세요." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "답변 받을 이메일을 정확히 적어 주세요." };
  }
  if (!subject || subject.length > SUBJECT_MAX) {
    return {
      ok: false,
      error: `제목은 1자 이상 ${SUBJECT_MAX}자 이하로 적어 주세요.`,
    };
  }
  if (!body || body.length > BODY_MAX) {
    return {
      ok: false,
      error: `내용은 1자 이상 ${BODY_MAX}자 이하로 적어 주세요.`,
    };
  }

  return {
    ok: true,
    value: {
      name,
      email,
      category: isInquiryCategory(input.category) ? input.category : "general",
      subject,
      body,
    },
  };
}

/** 문의를 저장하고 운영자에게 알린다 */
export async function createInquiry(
  writer: SupabaseClient,
  input: InquiryInput & { userId: string | null },
  adminUrl: string
): Promise<Inquiry | null> {
  const { data, error } = await writer
    .from("inquiries")
    .insert({
      user_id: input.userId,
      name: input.name,
      email: input.email,
      category: input.category,
      subject: input.subject,
      body: input.body,
    })
    .select(COLUMNS)
    .single();

  if (error || !data) {
    console.error("문의 저장 실패", error?.code, error?.message);
    return null;
  }

  const inquiry = toInquiry(data as InquiryRow);
  const category = INQUIRY_CATEGORIES.find((c) => c.id === inquiry.category)?.label ?? "문의";

  // 알림이 실패해도 문의는 이미 저장돼 있다 — 기다리지 않는다
  void notify({
    level: "info",
    title: `새 문의 (${category})`,
    body: `${inquiry.name} <${inquiry.email}>\n${inquiry.subject}\n${inquiry.body.slice(0, 120)}`,
    url: adminUrl,
  });

  return inquiry;
}

/** 로그인한 사람이 남긴 문의 (사용자 세션 — RLS 가 본인 것만 돌려준다) */
export async function listMyInquiries(
  supabase: SupabaseClient,
  userId: string
): Promise<Inquiry[]> {
  const { data, error } = await supabase
    .from("inquiries")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return (data as InquiryRow[]).map(toInquiry);
}

/* ───────────────────────────── 관리자 ───────────────────────────── */

export async function listInquiries(
  writer: SupabaseClient,
  status: InquiryStatus | "all"
): Promise<Inquiry[]> {
  let query = writer
    .from("inquiries")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(200);
  if (status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as InquiryRow[]).map(toInquiry);
}

/**
 * 답변·상태·메모를 고친다.
 * 답변을 적으면 상태가 자동으로 '답변함'이 된다 — 답변만 적고 상태를 안 바꿔 대기
 * 목록에 계속 남는 일이 없게.
 */
export async function updateInquiry(
  writer: SupabaseClient,
  id: string,
  patch: {
    reply?: string | null;
    adminNote?: string | null;
    status?: InquiryStatus;
  }
): Promise<Inquiry | null> {
  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.reply !== undefined) {
    update.reply = patch.reply;
    if (patch.reply) {
      update.answered_at = new Date().toISOString();
      update.status = "answered";
    }
  }
  if (patch.adminNote !== undefined) update.admin_note = patch.adminNote;
  if (patch.status) update.status = patch.status;

  const { data, error } = await writer
    .from("inquiries")
    .update(update)
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error || !data) return null;
  return toInquiry(data as InquiryRow);
}
