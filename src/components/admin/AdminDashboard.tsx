"use client";

import { useEffect, useMemo, useState } from "react";
import type { DailyStat } from "@/app/api/admin/stats/route";

/**
 * 관리자 대시보드.
 *
 * 유료로 열면 밤에 혼자 도는 코드가 돈을 만진다. 아침에 한 번 열어 보고 "어제 무슨
 * 일이 있었나"를 30초 안에 알 수 있어야 한다 — 얼마나 들어왔고, 얼마를 벌었고,
 * 무엇이 실패했나.
 */

type Incident = {
  id: string;
  kind: string;
  severity: "info" | "warn" | "error";
  message: string;
  project_id: string | null;
  created_at: string;
  resolved_at: string | null;
};

type Payment = {
  id: string;
  order_id: string;
  plan: string;
  amount: number;
  status: string;
  failure_reason: string | null;
  created_at: string;
};

type Stats = {
  daily: DailyStat[];
  incidents: Incident[];
  payments: Payment[];
  members: { total: number; byPlan: Record<string, number> };
};

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;
const day = (iso: string) => iso.slice(5, 10).replace("-", "/");
const time = (iso: string) => new Date(iso).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });

const KIND_LABEL: Record<string, string> = {
  payment_failed: "결제 실패",
  payment_orphaned: "결제 후 반영 실패",
  credit_failed: "크레딧 실패",
  job_failed: "AI 작업 실패",
  save_failed: "저장 실패",
};

export function AdminDashboard() {
  const [days, setDays] = useState(14);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    void (async () => {
      const response = await fetch(`/api/admin/stats?days=${days}`, { cache: "no-store" });
      const data = (await response.json()) as Stats & { error?: string };
      if (!alive) return;

      if (!response.ok) setError(data.error ?? "불러오지 못했습니다.");
      else {
        setStats(data);
        setError(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [days]);

  /* 오늘과 어제를 견줘 화살표를 보여 준다 — 숫자 하나만 보면 좋은지 나쁜지 모른다 */
  const summary = useMemo(() => {
    if (!stats?.daily.length) return null;
    const [today, yesterday] = stats.daily;

    const sum = (pick: (row: DailyStat) => number) =>
      stats.daily.reduce((total, row) => total + pick(row), 0);

    return {
      today,
      yesterday,
      totals: {
        visits: sum((row) => row.visits),
        signups: sum((row) => row.signups),
        aiJobs: sum((row) => row.ai_jobs),
        revenue: sum((row) => row.revenue),
        incidents: sum((row) => row.incidents),
      },
    };
  }, [stats]);

  if (error) {
    return (
      <main className="mx-auto max-w-[900px] px-5 py-16">
        <p className="text-[14px] text-danger">{error}</p>
      </main>
    );
  }

  if (!stats || !summary) {
    return (
      <main className="mx-auto max-w-[900px] px-5 py-16">
        <p className="text-[13px] text-muted">불러오는 중…</p>
      </main>
    );
  }

  const open = stats.incidents.filter((item) => !item.resolved_at);

  return (
    <main className="mx-auto max-w-[1080px] px-5 py-10 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">관리자</h1>
          <p className="mt-1 text-[12.5px] text-muted">
            회원 {stats.members.total}명 · 무료 {stats.members.byPlan.free ?? 0} · 베이직{" "}
            {stats.members.byPlan.basic ?? 0} · 프로 {stats.members.byPlan.pro ?? 0}
          </p>
        </div>

        <div className="flex gap-1">
          {[7, 14, 30].map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDays(option)}
              className={[
                "rounded-[var(--radius-control)] border px-2.5 py-1 text-[12px]",
                option === days ? "border-ink bg-ink text-surface" : "border-line text-muted hover:text-ink",
              ].join(" ")}
            >
              {option}일
            </button>
          ))}
        </div>
      </header>

      {open.length > 0 && (
        <div
          role="alert"
          className="mt-5 rounded-[var(--radius-card)] border border-danger/40 bg-danger/5 px-4 py-3"
        >
          <p className="text-[13px] font-medium text-danger">
            확인하지 않은 사고 {open.length}건
          </p>
          <p className="mt-0.5 text-[12px] text-ink-soft">
            {KIND_LABEL[open[0].kind] ?? open[0].kind} — {open[0].message.slice(0, 80)}
          </p>
        </div>
      )}

      {/* 오늘 */}
      <section className="mt-6">
        <h2 className="text-[13px] font-semibold text-muted">오늘</h2>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Metric label="방문" value={summary.today.visits} before={summary.yesterday?.visits} />
          <Metric label="방문자" value={summary.today.visitors} before={summary.yesterday?.visitors} />
          <Metric label="가입" value={summary.today.signups} before={summary.yesterday?.signups} />
          <Metric label="AI 작업" value={summary.today.ai_jobs} before={summary.yesterday?.ai_jobs} />
          <Metric label="결제" value={summary.today.paid_count} before={summary.yesterday?.paid_count} />
          <Metric
            label="매출"
            value={summary.today.revenue}
            before={summary.yesterday?.revenue}
            format={won}
          />
        </div>
      </section>

      {/* 기간 합계 */}
      <section className="mt-6">
        <h2 className="text-[13px] font-semibold text-muted">{days}일 합계</h2>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Metric label="방문" value={summary.totals.visits} />
          <Metric label="가입" value={summary.totals.signups} />
          <Metric label="AI 작업" value={summary.totals.aiJobs} />
          <Metric label="매출" value={summary.totals.revenue} format={won} />
          <Metric label="사고" value={summary.totals.incidents} />
        </div>
      </section>

      {/* 날짜별 */}
      <section className="mt-8">
        <h2 className="text-[13px] font-semibold text-muted">날짜별</h2>
        <div className="mt-2 overflow-x-auto rounded-[var(--radius-card)] border border-line">
          <table className="w-full min-w-[620px] text-[12px] tabular-nums">
            <thead className="bg-sunken text-[11px] text-muted">
              <tr>
                {["날짜", "방문", "방문자", "가입", "AI 작업", "크레딧", "결제", "매출", "사고"].map(
                  (head) => (
                    <th key={head} className="px-3 py-2 text-right font-medium first:text-left">
                      {head}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {stats.daily.map((row) => (
                <tr key={row.day} className="border-t border-line">
                  <td className="px-3 py-1.5">{day(row.day)}</td>
                  <td className="px-3 py-1.5 text-right">{row.visits}</td>
                  <td className="px-3 py-1.5 text-right">{row.visitors}</td>
                  <td className="px-3 py-1.5 text-right">{row.signups}</td>
                  <td className="px-3 py-1.5 text-right">{row.ai_jobs}</td>
                  <td className="px-3 py-1.5 text-right">{row.credits_spent}</td>
                  <td className="px-3 py-1.5 text-right">{row.paid_count}</td>
                  <td className="px-3 py-1.5 text-right">{row.revenue ? won(row.revenue) : "—"}</td>
                  <td
                    className={[
                      "px-3 py-1.5 text-right",
                      row.incidents > 0 ? "font-medium text-danger" : "",
                    ].join(" ")}
                  >
                    {row.incidents || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 사고 */}
      <section className="mt-8">
        <h2 className="text-[13px] font-semibold text-muted">최근 사고</h2>
        {stats.incidents.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-muted">아직 기록된 사고가 없습니다.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {stats.incidents.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 rounded-[var(--radius-control)] border border-line px-3 py-2 text-[12px]"
              >
                <span
                  className={[
                    "shrink-0 font-medium",
                    item.severity === "error" ? "text-danger" : "text-ink-soft",
                  ].join(" ")}
                >
                  {KIND_LABEL[item.kind] ?? item.kind}
                </span>
                <span className="min-w-0 flex-1 text-ink-soft">{item.message}</span>
                <span className="shrink-0 text-[11px] text-muted">{time(item.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 결제 */}
      <section className="mt-8 pb-12">
        <h2 className="text-[13px] font-semibold text-muted">최근 결제</h2>
        {stats.payments.length === 0 ? (
          <p className="mt-2 text-[12.5px] text-muted">아직 결제가 없습니다.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {stats.payments.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 rounded-[var(--radius-control)] border border-line px-3 py-2 text-[12px] tabular-nums"
              >
                <span className="shrink-0 font-medium">{item.plan}</span>
                <span className="shrink-0">{won(item.amount)}</span>
                <span
                  className={[
                    "shrink-0",
                    item.status === "paid" ? "text-accent" : "text-danger",
                  ].join(" ")}
                >
                  {item.status}
                </span>
                <span className="min-w-0 flex-1 text-muted">{item.failure_reason ?? item.order_id}</span>
                <span className="shrink-0 text-[11px] text-muted">{time(item.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/** 숫자 하나 — 어제와 견줘 늘었는지 줄었는지 함께 보여 준다 */
function Metric({
  label,
  value,
  before,
  format,
}: {
  label: string;
  value: number;
  before?: number;
  format?: (value: number) => string;
}) {
  const diff = before === undefined ? null : value - before;

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface px-3 py-2.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-0.5 text-[17px] font-semibold tabular-nums">
        {format ? format(value) : value.toLocaleString("ko-KR")}
      </p>
      {diff !== null && diff !== 0 && (
        <p
          className={[
            "mt-0.5 text-[11px] tabular-nums",
            diff > 0 ? "text-accent" : "text-muted",
          ].join(" ")}
        >
          {diff > 0 ? "▲" : "▼"} {Math.abs(diff).toLocaleString("ko-KR")}
        </p>
      )}
    </div>
  );
}
