import { requireAdmin } from "@/lib/admin-api";

export type SettlementRow = {
  period: string;
  revenue: number;
  refunds: number;
  paid_count: number;
  refund_count: number;
  api_calls: number;
  api_cost: number;
  visits: number;
  signups: number;
};

export type SettlementUnit = "day" | "month" | "year";

const UNITS: SettlementUnit[] = ["day", "month", "year"];
const DEFAULT_COUNT: Record<SettlementUnit, number> = {
  day: 30,
  month: 12,
  year: 3,
};

/**
 * 정산표 — 일·월·년 단위로 받은 돈, 돌려준 돈, API 비용.
 * "수익 대비 비용"은 클라이언트가 revenue - refunds - api_cost 로 계산한다.
 */
export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const unit = (UNITS as string[]).includes(params.get("unit") ?? "")
    ? (params.get("unit") as SettlementUnit)
    : "day";
  const count = Math.min(120, Math.max(1, Number(params.get("count")) || DEFAULT_COUNT[unit]));

  const { data, error } = await guard.writer.rpc("admin_settlement", {
    p_unit: unit,
    p_count: count,
  });

  if (error) {
    console.error("[admin] 정산 집계 실패:", error.message);
    return Response.json(
      {
        error: "정산을 읽지 못했습니다. migrations-admin-cs.sql 을 실행했는지 확인해 주세요.",
      },
      { status: 500 }
    );
  }

  // bigint·numeric 은 문자열로 오므로 숫자로 바꿔 준다
  const rows = ((data ?? []) as SettlementRow[]).map((row) => ({
    ...row,
    revenue: Number(row.revenue),
    refunds: Number(row.refunds),
    paid_count: Number(row.paid_count),
    refund_count: Number(row.refund_count),
    api_calls: Number(row.api_calls),
    api_cost: Number(row.api_cost),
    visits: Number(row.visits),
    signups: Number(row.signups),
  }));

  return Response.json({ unit, rows });
}
