import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUTO_BAN_DAYS,
  STRIKE_LIMIT,
  STRIKE_WINDOW_HOURS,
  screenMessage,
  shouldAutoBan,
  strikeWeight,
  type ViolationKind,
  VIOLATION_LABEL,
} from "@/lib/moderation";

/**
 * 차단과 위반 기록.
 *
 * 전부 서비스 롤(writer)로 읽고 쓴다 — 두 테이블에는 사용자 정책이 없다.
 * 서비스 롤 키가 없는 환경에서는 필터는 돌되 기록과 차단은 건너뛴다.
 */

export interface Ban {
  id: string;
  userId: string | null;
  ip: string | null;
  reason: string;
  createdBy: string;
  expiresAt: string | null;
  createdAt: string;
}

export interface Violation {
  id: string;
  userId: string | null;
  ip: string | null;
  kind: ViolationKind;
  body: string;
  createdAt: string;
}

interface BanRow {
  id: string;
  user_id: string | null;
  ip: string | null;
  reason: string;
  created_by: string;
  expires_at: string | null;
  created_at: string;
}

interface ViolationRow {
  id: string;
  user_id: string | null;
  ip: string | null;
  kind: string;
  body: string;
  created_at: string;
}

const BAN_COLUMNS = "id, user_id, ip, reason, created_by, expires_at, created_at";

function toBan(row: BanRow): Ban {
  return {
    id: row.id,
    userId: row.user_id,
    ip: row.ip,
    reason: row.reason,
    createdBy: row.created_by,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/** 사람이 읽는 차단 안내 — 언제 풀리는지까지 */
export function banMessage(ban: Ban): string {
  if (!ban.expiresAt) return "갤러리 글쓰기가 차단된 계정입니다.";
  const until = new Date(ban.expiresAt).toLocaleString("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
  });
  return `갤러리 글쓰기가 ${until}까지 차단됐습니다. (사유: ${ban.reason})`;
}

/**
 * 계정 또는 IP 에 걸린 살아 있는 차단.
 * 둘 중 하나라도 걸려 있으면 막는다. 만료된 줄은 지우지 않고 무시한다 — 기록은 남긴다.
 */
export async function findActiveBan(
  writer: SupabaseClient,
  userId: string | null,
  ip: string | null
): Promise<Ban | null> {
  if (!userId && !ip) return null;

  const filters: string[] = [];
  if (userId) filters.push(`user_id.eq.${userId}`);
  if (ip) filters.push(`ip.eq.${ip}`);

  const { data, error } = await writer
    .from("gallery_bans")
    .select(BAN_COLUMNS)
    .or(filters.join(","))
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return toBan(data[0] as BanRow);
}

/**
 * 위반을 적고, 최근 위반이 쌓였으면 자동 차단한다.
 *
 * 창(STRIKE_WINDOW_HOURS) 안의 위반을 계정·IP 어느 쪽으로든 세어 한도에 닿으면
 * 계정과 IP 를 함께 AUTO_BAN_DAYS 동안 막는다. 돌려주는 값은 화면에 "경고 n/3"
 * 을 띄우는 데 쓴다.
 */
export async function recordViolation(
  writer: SupabaseClient,
  input: {
    userId: string | null;
    ip: string | null;
    kind: ViolationKind;
    body: string;
  }
): Promise<{ strikes: number; banned: Ban | null }> {
  await writer.from("gallery_violations").insert({
    user_id: input.userId,
    ip: input.ip,
    kind: input.kind,
    body: input.body.slice(0, 500),
  });

  const since = new Date(Date.now() - STRIKE_WINDOW_HOURS * 3600 * 1000).toISOString();
  const filters: string[] = [];
  if (input.userId) filters.push(`user_id.eq.${input.userId}`);
  if (input.ip) filters.push(`ip.eq.${input.ip}`);

  const { data } = await writer
    .from("gallery_violations")
    .select("kind")
    .or(filters.join(","))
    .gte("created_at", since);

  const strikes = ((data ?? []) as { kind: string }[]).reduce(
    (sum, row) => sum + strikeWeight(row.kind as ViolationKind),
    0
  );

  if (!shouldAutoBan(strikes)) return { strikes, banned: null };

  const expiresAt = new Date(Date.now() + AUTO_BAN_DAYS * 86400 * 1000).toISOString();
  const banned = await createBan(writer, {
    userId: input.userId,
    ip: input.ip,
    reason: `${VIOLATION_LABEL[input.kind]} 반복`,
    createdBy: "auto",
    expiresAt,
  });
  return { strikes, banned };
}

/**
 * 차단을 건다. 계정과 IP 를 한 줄에 함께 적는다 — 어느 쪽으로 와도 같은 줄에 걸린다.
 */
export async function createBan(
  writer: SupabaseClient,
  input: {
    userId: string | null;
    ip: string | null;
    reason: string;
    createdBy: string;
    expiresAt: string | null;
  }
): Promise<Ban | null> {
  if (!input.userId && !input.ip) return null;

  const { data, error } = await writer
    .from("gallery_bans")
    .insert({
      user_id: input.userId,
      ip: input.ip,
      reason: input.reason,
      created_by: input.createdBy,
      expires_at: input.expiresAt,
    })
    .select(BAN_COLUMNS)
    .single();

  if (error || !data) {
    console.error("차단 등록 실패", error?.code, error?.message);
    return null;
  }
  return toBan(data as BanRow);
}

export async function liftBan(writer: SupabaseClient, id: string): Promise<boolean> {
  const { error } = await writer.from("gallery_bans").delete().eq("id", id);
  return !error;
}

/** 관리자 화면용 — 살아 있는 차단과 최근 위반 */
export async function listModeration(
  writer: SupabaseClient
): Promise<{ bans: Ban[]; violations: Violation[] }> {
  const [bans, violations] = await Promise.all([
    writer
      .from("gallery_bans")
      .select(BAN_COLUMNS)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("created_at", { ascending: false })
      .limit(100),
    writer
      .from("gallery_violations")
      .select("id, user_id, ip, kind, body, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  return {
    bans: ((bans.data ?? []) as BanRow[]).map(toBan),
    violations: ((violations.data ?? []) as ViolationRow[]).map((row) => ({
      id: row.id,
      userId: row.user_id,
      ip: row.ip,
      kind: row.kind as ViolationKind,
      body: row.body,
      createdAt: row.created_at,
    })),
  };
}

/* ───────────────────────────── 쓰기 전 검사 ───────────────────────────── */

export type WriteCheck = { ok: true } | { ok: false; status: number; error: string };

/**
 * 글을 저장하기 전에 두 가지를 본다 — 차단된 사람인가, 걸리는 내용인가.
 *
 * 걸리면 위반으로 적고 경고 횟수를 알려 준다. 한도에 닿으면 이 자리에서 바로
 * 차단돼 다음 글부터는 내용을 보기도 전에 막힌다.
 * writer 가 없으면(서비스 롤 키 없음) 필터만 돌고 기록·차단은 건너뛴다.
 */
export async function checkWrite(
  writer: SupabaseClient | null,
  input: { userId: string | null; ip: string | null; body: string }
): Promise<WriteCheck> {
  if (writer) {
    const ban = await findActiveBan(writer, input.userId, input.ip);
    if (ban) return { ok: false, status: 403, error: banMessage(ban) };
  }

  const verdict = screenMessage(input.body);
  if (verdict.ok) return { ok: true };

  if (!writer) {
    return {
      ok: false,
      status: 400,
      error: `${verdict.label}으로 보이는 내용은 보낼 수 없습니다.`,
    };
  }

  const { strikes, banned } = await recordViolation(writer, {
    userId: input.userId,
    ip: input.ip,
    kind: verdict.kind,
    body: input.body,
  });

  if (banned) return { ok: false, status: 403, error: banMessage(banned) };

  return {
    ok: false,
    status: 400,
    error: `${verdict.label}으로 보이는 내용은 보낼 수 없습니다. (경고 ${Math.min(strikes, STRIKE_LIMIT)}/${STRIKE_LIMIT} — 한도에 닿으면 ${AUTO_BAN_DAYS}일간 차단됩니다)`,
  };
}
