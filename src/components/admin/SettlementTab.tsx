"use client";

import { useEffect, useMemo, useState } from "react";
import type { SettlementRow, SettlementUnit } from "@/app/api/admin/settlement/route";
import { Metric } from "./AdminDashboard";
import { Empty, SectionTitle, Table, call, won } from "./ui";

/**
 * 정산 — 받은 돈에서 돌려준 돈과 API 비용을 뺀 것이 남는 돈이다.
 *
 * API 비용은 config/costs.ts 의 단가로 계산한 추정치다. 실제 청구서가 나오면 그 파일의
 * 단가를 맞춘다 — 여기 숫자만 믿고 세금 신고를 하면 안 된다.
 */

const UNITS: { id: SettlementUnit; label: string }[] = [
  { id: "day", label: "일간" },
  { id: "month", label: "월간" },
  { id: "year", label: "연간" },
];

function periodLabel(unit: SettlementUnit, iso: string): string {
  if (unit === "year") return `${iso.slice(0, 4)}년`;
  if (unit === "month") return `${iso.slice(0, 4)}.${iso.slice(5, 7)}`;
  return iso.slice(5, 10).replace("-", "/");
}

export function SettlementTab() {
  const [unit, setUnit] = useState<SettlementUnit>("day");
  const [rows, setRows] = useState<SettlementRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const data = await call<{ rows: SettlementRow[] }>(`/api/admin/settlement?unit=${unit}`);
        if (!alive) return;
        setRows(data.rows);
        setError(null);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [unit]);

  const totals = useMemo(() => {
    if (!rows) return null;
    const sum = (pick: (r: SettlementRow) => number) => rows.reduce((t, r) => t + pick(r), 0);
    const revenue = sum((r) => r.revenue);
    const refunds = sum((r) => r.refunds);
    const apiCost = sum((r) => r.api_cost);
    return {
      revenue,
      refunds,
      apiCost,
      apiCalls: sum((r) => r.api_calls),
      net: revenue - refunds - apiCost,
      visits: sum((r) => r.visits),
      signups: sum((r) => r.signups),
    };
  }, [rows]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>기간 단위</SectionTitle>
        <div className="flex gap-1">
          {UNITS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setRows(null);
                setUnit(option.id);
              }}
              className={[
                "rounded-[var(--radius-control)] border px-2.5 py-1 text-[12px]",
                option.id === unit
                  ? "border-ink bg-ink text-surface"
                  : "border-line text-muted hover:text-ink",
              ].join(" ")}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-4 text-[13px] text-danger">{error}</p>}
      {!rows && !error && <Empty>불러오는 중…</Empty>}

      {rows && totals && (
        <>
          <section className="mt-4">
            <SectionTitle>
              합계 ({rows.length}
              {unit === "day" ? "일" : unit === "month" ? "개월" : "년"})
            </SectionTitle>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="매출" value={totals.revenue} format={won} />
              <Metric label="환불" value={totals.refunds} format={won} />
              <Metric label="API 호출" value={totals.apiCalls} />
              <Metric label="API 비용 (추정)" value={totals.apiCost} format={won} />
              <Metric label="순수익" value={totals.net} format={won} />
              <Metric
                label="비용 비율"
                value={totals.revenue > 0 ? Math.round((totals.apiCost / totals.revenue) * 100) : 0}
                format={(v) => (totals.revenue > 0 ? `${v}%` : "—")}
              />
            </div>
          </section>

          <section className="mt-6">
            <SectionTitle>{UNITS.find((u) => u.id === unit)?.label} 정산표</SectionTitle>
            <Table
              heads={[
                "기간",
                "방문",
                "가입",
                "결제 건",
                "매출",
                "환불 건",
                "환불",
                "API 호출",
                "API 비용",
                "순수익",
              ]}
              minWidth={820}
            >
              {rows.map((row) => {
                const net = row.revenue - row.refunds - row.api_cost;
                return (
                  <tr key={row.period} className="border-t border-line">
                    <td className="px-3 py-1.5">{periodLabel(unit, row.period)}</td>
                    <td className="px-3 py-1.5">{row.visits}</td>
                    <td className="px-3 py-1.5">{row.signups}</td>
                    <td className="px-3 py-1.5">{row.paid_count}</td>
                    <td className="px-3 py-1.5">{row.revenue ? won(row.revenue) : "—"}</td>
                    <td className="px-3 py-1.5">{row.refund_count || "—"}</td>
                    <td className="px-3 py-1.5">{row.refunds ? won(row.refunds) : "—"}</td>
                    <td className="px-3 py-1.5">{row.api_calls}</td>
                    <td className="px-3 py-1.5">{row.api_cost ? won(row.api_cost) : "—"}</td>
                    <td className={`px-3 py-1.5 font-medium ${net < 0 ? "text-danger" : ""}`}>
                      {net ? won(net) : "—"}
                    </td>
                  </tr>
                );
              })}
            </Table>
            <p className="mt-2 text-[11.5px] text-muted">
              API 비용은 모델별 공개 단가(config/costs.ts)로 계산한 추정치입니다. 실제 청구서와
              다르면 그 파일의 단가를 고쳐 주세요.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
