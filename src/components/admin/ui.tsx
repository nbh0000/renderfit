"use client";

/** 관리자 탭들이 같이 쓰는 작은 조각들 — 표, 입력, 단추 */

export const won = (value: number) => `${Math.round(value).toLocaleString("ko-KR")}원`;
export const when = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("ko-KR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
export const dateOnly = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("ko-KR") : "—";

export const inputClass =
  "rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-1.5 text-[12.5px] placeholder:text-muted/70";
export const buttonClass =
  "inline-flex items-center rounded-[var(--radius-control)] border border-line px-2.5 py-1.5 text-[12px] hover:border-line-strong hover:text-ink disabled:opacity-40";
export const primaryButtonClass =
  "inline-flex items-center rounded-[var(--radius-control)] bg-ink px-3 py-1.5 text-[12px] font-medium text-surface hover:bg-ink/90 disabled:opacity-40";
export const dangerButtonClass =
  "inline-flex items-center rounded-[var(--radius-control)] border border-danger/40 px-2.5 py-1.5 text-[12px] text-danger hover:bg-danger/5 disabled:opacity-40";

export function Table({
  heads,
  children,
  minWidth = 640,
}: {
  heads: string[];
  children: React.ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="mt-2 overflow-x-auto rounded-[var(--radius-card)] border border-line">
      <table className="w-full text-[12px] tabular-nums" style={{ minWidth }}>
        <thead className="bg-sunken text-[11px] text-muted">
          <tr>
            {heads.map((head) => (
              <th key={head} className="px-3 py-2 text-left font-medium">
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-[12.5px] text-muted">{children}</p>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[13px] font-semibold text-muted">{children}</h2>;
}

/** 상태 배지 — 색으로 한눈에 */
export function Badge({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad" | "muted";
  children: React.ReactNode;
}) {
  const cls = {
    ok: "bg-success/10 text-success",
    warn: "bg-accent/10 text-accent",
    bad: "bg-danger/10 text-danger",
    muted: "bg-sunken text-muted",
  }[tone];
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>
  );
}

/** fetch 한 뒤 JSON 을 돌려주고, 실패면 메시지를 던진다 */
export async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `요청 실패 (${res.status})`);
  return data;
}
