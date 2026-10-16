"use client";

import { useEffect, useState } from "react";
import type { AdminPayment } from "@/app/api/admin/payments/route";
import { useToast } from "@/components/ui/Toast";
import {
  Badge,
  Empty,
  SectionTitle,
  Table,
  buttonClass,
  call,
  dangerButtonClass,
  inputClass,
  when,
  won,
} from "./ui";

/**
 * 결제·환불.
 *
 * 환불은 돌이킬 수 없다. 그래서 한 줄을 고르면 아래에 확인 칸이 열리고, 금액과
 * 사유를 적은 뒤에야 단추가 살아난다.
 */

const STATUS: { id: string; label: string }[] = [
  { id: "all", label: "전체" },
  { id: "paid", label: "승인" },
  { id: "refunded", label: "환불" },
  { id: "failed", label: "실패" },
  { id: "pending", label: "대기" },
];

const TONE: Record<string, "ok" | "warn" | "bad" | "muted"> = {
  paid: "ok",
  refunded: "warn",
  canceled: "muted",
  failed: "bad",
  pending: "muted",
};

export function PaymentsTab() {
  const { toast } = useToast();
  const [status, setStatus] = useState("all");
  const [q, setQ] = useState("");
  const [payments, setPayments] = useState<AdminPayment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState<AdminPayment | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [manual, setManual] = useState(false);
  const [endSubscription, setEndSubscription] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const data = await call<{ payments: AdminPayment[] }>(
        `/api/admin/payments?status=${status}&q=${encodeURIComponent(q)}`
      );
      setPayments(data.payments);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const pick = (payment: AdminPayment) => {
    setTarget(payment);
    setAmount(String(payment.amount - payment.refunded_amount));
    setReason("");
    setManual(false);
    setEndSubscription(true);
  };

  const refund = async () => {
    if (!target || busy) return;
    const remaining = target.amount - target.refunded_amount;
    const value = Number(amount);
    if (!Number.isInteger(value) || value <= 0 || value > remaining) {
      toast(`환불 금액은 1원 이상 ${won(remaining)} 이하여야 합니다.`, "error");
      return;
    }
    setBusy(true);
    try {
      const data = await call<{
        refundedAmount: number;
        fullyRefunded: boolean;
        subscriptionEnded: boolean;
      }>(`/api/admin/payments/${target.id}/refund`, {
        method: "POST",
        body: JSON.stringify({
          amount: value,
          reason,
          manual,
          endSubscription,
        }),
      });
      toast(
        `${won(value)} 환불${data.fullyRefunded ? " (전액)" : ""}${data.subscriptionEnded ? " · 구독 종료" : ""}`,
        "success"
      );
      setTarget(null);
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remaining = target ? target.amount - target.refunded_amount : 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {STATUS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setStatus(option.id)}
              className={[
                "rounded-[var(--radius-control)] border px-2.5 py-1 text-[12px]",
                option.id === status
                  ? "border-ink bg-ink text-surface"
                  : "border-line text-muted hover:text-ink",
              ].join(" ")}
            >
              {option.label}
            </button>
          ))}
        </div>
        <form
          className="ml-auto flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이메일 또는 주문번호"
            className={`${inputClass} w-[220px]`}
          />
          <button type="submit" className={buttonClass}>
            찾기
          </button>
        </form>
      </div>

      {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
      {!payments && !error && <Empty>불러오는 중…</Empty>}
      {payments && payments.length === 0 && <Empty>결제가 없습니다.</Empty>}

      {payments && payments.length > 0 && (
        <Table
          heads={["일시", "고객", "주문번호", "요금제", "금액", "환불", "상태", ""]}
          minWidth={820}
        >
          {payments.map((p) => {
            const refundable =
              ["paid", "refunded"].includes(p.status) && p.amount - p.refunded_amount > 0;
            return (
              <tr
                key={p.id}
                className={`border-t border-line ${target?.id === p.id ? "bg-sunken" : ""}`}
              >
                <td className="px-3 py-1.5">{when(p.created_at)}</td>
                <td className="px-3 py-1.5">{p.email ?? p.user_id.slice(0, 8)}</td>
                <td className="px-3 py-1.5 font-mono text-[11px]">{p.order_id}</td>
                <td className="px-3 py-1.5">{p.plan}</td>
                <td className="px-3 py-1.5">{won(p.amount)}</td>
                <td className="px-3 py-1.5">{p.refunded_amount ? won(p.refunded_amount) : "—"}</td>
                <td className="px-3 py-1.5">
                  <Badge tone={TONE[p.status] ?? "muted"}>{p.status}</Badge>
                  {p.failure_reason && (
                    <span className="ml-1 text-[11px] text-muted">
                      {p.failure_reason.slice(0, 40)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right">
                  {refundable && (
                    <button type="button" onClick={() => pick(p)} className={buttonClass}>
                      환불
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}

      {target && (
        <section className="mt-6 rounded-[var(--radius-card)] border border-danger/40 bg-danger/5 p-4">
          <SectionTitle>환불 — {target.email ?? target.user_id}</SectionTitle>
          <p className="mt-1 text-[12.5px] text-ink-soft">
            {target.order_id} · {target.plan} · 결제 {won(target.amount)} · 남은 금액{" "}
            {won(remaining)}
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-[160px_1fr]">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              placeholder="환불 금액"
              className={inputClass}
            />
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="환불 사유 (고객에게도 전달됩니다)"
              className={inputClass}
            />
          </div>

          <div className="mt-2 flex flex-wrap gap-4 text-[12px]">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={endSubscription}
                onChange={(e) => setEndSubscription(e.target.checked)}
              />
              전액 환불이면 구독도 종료하고 무료로 되돌린다
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={manual}
                onChange={(e) => setManual(e.target.checked)}
              />
              토스 콘솔에서 이미 취소함 — 장부만 반영
            </label>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void refund()}
              disabled={busy || !reason.trim() || !amount}
              className={dangerButtonClass}
            >
              {busy ? "처리 중…" : `${amount ? won(Number(amount)) : ""} 환불 실행`}
            </button>
            <button type="button" onClick={() => setTarget(null)} className={buttonClass}>
              취소
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
