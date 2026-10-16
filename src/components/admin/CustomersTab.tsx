"use client";

import { useEffect, useState } from "react";
import type { Customer } from "@/app/api/admin/customers/route";
import { PLANS } from "@/config/plans";
import { useToast } from "@/components/ui/Toast";
import {
  Badge,
  Empty,
  SectionTitle,
  Table,
  buttonClass,
  call,
  dangerButtonClass,
  dateOnly,
  inputClass,
  primaryButtonClass,
  when,
  won,
} from "./ui";

/**
 * 고객 관리 — 찾고, 열어 보고, 고친다.
 *
 * 고칠 수 있는 것은 크레딧과 요금제뿐이고, 고칠 때마다 사유를 받는다. 사유 없이
 * 크레딧이 오가면 나중에 왜 그랬는지 아무도 모른다.
 */

type Detail = {
  profile: {
    id: string;
    email: string | null;
    full_name: string | null;
    plan: string;
    credits: number;
    period_start: string;
    created_at: string;
  };
  payments: {
    id: string;
    order_id: string;
    plan: string;
    amount: number;
    status: string;
    refunded_amount: number;
    failure_reason: string | null;
    created_at: string;
  }[];
  subscriptions: {
    id: string;
    plan: string;
    status: string;
    period_start: string;
    period_end: string;
    failed_attempts: number;
    canceled_at: string | null;
  }[];
  inquiries: {
    id: string;
    category: string;
    subject: string;
    status: string;
    created_at: string;
  }[];
  activity: {
    id: number;
    name: string;
    path: string | null;
    props: Record<string, unknown>;
    created_at: string;
  }[];
  bans: {
    id: string;
    reason: string;
    expires_at: string | null;
    created_at: string;
    created_by: string;
  }[];
};

const SUB_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "muted" }> = {
  active: { label: "구독 중", tone: "ok" },
  past_due: { label: "결제 실패·재시도", tone: "bad" },
  canceled: { label: "해지 예약", tone: "warn" },
  expired: { label: "종료", tone: "muted" },
};

export function CustomersTab() {
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  const [creditsDelta, setCreditsDelta] = useState("");
  const [plan, setPlan] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const search = async (query: string) => {
    try {
      const data = await call<{ customers: Customer[] }>(
        `/api/admin/customers?q=${encodeURIComponent(query)}`
      );
      setCustomers(data.customers);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void (async () => {
      await search("");
    })();
  }, []);

  const open = async (id: string) => {
    setSelected(id);
    setDetail(null);
    setCreditsDelta("");
    setPlan("");
    setReason("");
    try {
      setDetail(await call<Detail>(`/api/admin/customers/${id}`));
    } catch (e) {
      toast((e as Error).message, "error");
      setSelected(null);
    }
  };

  const apply = async () => {
    if (!selected || busy) return;
    const delta = Number(creditsDelta);
    const body: Record<string, unknown> = { reason };
    if (creditsDelta && Number.isInteger(delta) && delta !== 0) body.creditsDelta = delta;
    if (plan) body.plan = plan;
    setBusy(true);
    try {
      const data = await call<{ changes: string[] }>(`/api/admin/customers/${selected}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      toast(data.changes.join(", "), "success");
      await Promise.all([open(selected), search(q)]);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  /* 구독 조작도 위의 사유 칸을 쓴다 — 창을 하나 더 띄우지 않는다 */
  const cancelSubscription = async (id: string, mode: "cancel" | "expire") => {
    if (!reason.trim()) {
      toast("먼저 조정 칸에 사유를 적어 주세요.", "error");
      return;
    }
    try {
      await call(`/api/admin/subscriptions/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ mode, reason }),
      });
      toast(mode === "expire" ? "구독을 종료했습니다." : "해지를 예약했습니다.", "success");
      if (selected) await open(selected);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void search(q);
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이메일 또는 이름"
            className={`${inputClass} flex-1`}
          />
          <button type="submit" className={buttonClass}>
            찾기
          </button>
        </form>

        {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
        {!customers && !error && <Empty>불러오는 중…</Empty>}
        {customers && customers.length === 0 && <Empty>고객이 없습니다.</Empty>}

        {customers && customers.length > 0 && (
          <Table
            heads={["고객", "요금제", "크레딧", "결제 합계", "AI 작업", "마지막 활동", "문의"]}
            minWidth={720}
          >
            {customers.map((c) => (
              <tr
                key={c.id}
                onClick={() => void open(c.id)}
                className={[
                  "cursor-pointer border-t border-line hover:bg-sunken/60",
                  c.id === selected ? "bg-sunken" : "",
                ].join(" ")}
              >
                <td className="px-3 py-1.5">
                  <p className="font-medium">{c.full_name || "이름 없음"}</p>
                  <p className="text-[11px] text-muted">{c.email}</p>
                </td>
                <td className="px-3 py-1.5">
                  {c.plan}
                  {c.subscription_status && SUB_STATUS[c.subscription_status] && (
                    <span className="ml-1">
                      <Badge tone={SUB_STATUS[c.subscription_status].tone}>
                        {SUB_STATUS[c.subscription_status].label}
                      </Badge>
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5">{c.credits}</td>
                <td className="px-3 py-1.5">
                  {c.revenue ? won(c.revenue) : "—"}
                  {c.refunded > 0 && <span className="text-danger"> (−{won(c.refunded)})</span>}
                </td>
                <td className="px-3 py-1.5">{c.ai_jobs}</td>
                <td className="px-3 py-1.5">{when(c.last_seen)}</td>
                <td className="px-3 py-1.5">
                  {c.inquiries_open > 0 ? <Badge tone="bad">대기 {c.inquiries_open}</Badge> : "—"}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      {/* 오른쪽: 선택한 고객 */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        {!selected && <Empty>고객을 고르면 상세가 여기 나옵니다.</Empty>}
        {selected && !detail && <Empty>불러오는 중…</Empty>}
        {detail && (
          <div className="space-y-5 rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <div>
              <p className="text-[14px] font-semibold">{detail.profile.full_name || "이름 없음"}</p>
              <p className="text-[12px] text-muted">{detail.profile.email}</p>
              <p className="mt-1 text-[11.5px] text-muted">
                가입 {dateOnly(detail.profile.created_at)} · 요금제 {detail.profile.plan} · 크레딧{" "}
                {detail.profile.credits}
              </p>
              <p className="mt-0.5 break-all text-[10.5px] text-muted/70">{detail.profile.id}</p>
            </div>

            <section>
              <SectionTitle>조정</SectionTitle>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  value={creditsDelta}
                  onChange={(e) => setCreditsDelta(e.target.value)}
                  placeholder="크레딧 ±  (예: +5, -3)"
                  className={inputClass}
                />
                <select
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                  className={inputClass}
                >
                  <option value="">요금제 그대로</option>
                  {PLANS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label} ({p.id})
                    </option>
                  ))}
                </select>
              </div>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="사유 (필수)"
                className={`${inputClass} mt-2 w-full`}
              />
              <button
                type="button"
                onClick={() => void apply()}
                disabled={busy || !reason.trim() || (!creditsDelta && !plan)}
                className={`${primaryButtonClass} mt-2`}
              >
                반영
              </button>
            </section>

            <section>
              <SectionTitle>구독</SectionTitle>
              {detail.subscriptions.length === 0 && <Empty>구독 기록 없음</Empty>}
              <ul className="mt-2 space-y-2">
                {detail.subscriptions.map((s) => (
                  <li key={s.id} className="rounded-lg border border-line px-3 py-2 text-[12px]">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.plan}</span>
                      <Badge tone={SUB_STATUS[s.status]?.tone ?? "muted"}>
                        {SUB_STATUS[s.status]?.label ?? s.status}
                      </Badge>
                      {s.failed_attempts > 0 && (
                        <span className="text-danger">실패 {s.failed_attempts}회</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {dateOnly(s.period_start)} ~ {dateOnly(s.period_end)}
                    </p>
                    {(s.status === "active" || s.status === "past_due") && (
                      <div className="mt-1.5 flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => void cancelSubscription(s.id, "cancel")}
                          className={buttonClass}
                        >
                          해지 예약
                        </button>
                        <button
                          type="button"
                          onClick={() => void cancelSubscription(s.id, "expire")}
                          className={dangerButtonClass}
                        >
                          즉시 종료
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <SectionTitle>결제</SectionTitle>
              {detail.payments.length === 0 && <Empty>결제 기록 없음</Empty>}
              <ul className="mt-2 space-y-1 text-[12px]">
                {detail.payments.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 border-t border-line py-1.5 first:border-0"
                  >
                    <span>
                      {dateOnly(p.created_at)} · {p.plan} · {won(p.amount)}
                      {p.refunded_amount > 0 && (
                        <span className="text-danger"> (환불 {won(p.refunded_amount)})</span>
                      )}
                    </span>
                    <Badge
                      tone={p.status === "paid" ? "ok" : p.status === "failed" ? "bad" : "muted"}
                    >
                      {p.status}
                    </Badge>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[11px] text-muted">환불은 결제·환불 탭에서 합니다.</p>
            </section>

            {detail.bans.length > 0 && (
              <section>
                <SectionTitle>갤러리 차단</SectionTitle>
                <ul className="mt-2 space-y-1 text-[12px]">
                  {detail.bans.map((b) => (
                    <li key={b.id}>
                      {b.reason} · {b.expires_at ? `${when(b.expires_at)}까지` : "영구"} ·{" "}
                      {b.created_by}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section>
              <SectionTitle>최근 활동</SectionTitle>
              {detail.activity.length === 0 && <Empty>기록 없음</Empty>}
              <ul className="mt-2 max-h-[200px] space-y-0.5 overflow-y-auto text-[11.5px] text-muted">
                {detail.activity.map((a) => (
                  <li key={a.id}>
                    {when(a.created_at)} · {a.name}
                    {a.path ? ` · ${a.path}` : ""}
                    {typeof a.props?.credits === "number" ? ` · ${a.props.credits}크레딧` : ""}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}
