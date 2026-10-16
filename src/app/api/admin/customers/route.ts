import { requireAdmin } from "@/lib/admin-api";

export type Customer = {
  id: string;
  email: string | null;
  full_name: string | null;
  plan: string;
  credits: number;
  created_at: string;
  revenue: number;
  refunded: number;
  ai_jobs: number;
  last_seen: string | null;
  subscription_status: string | null;
  inquiries_open: number;
};

/** 고객 목록 — 이름·이메일로 찾는다 */
export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);

  const { data, error } = await guard.writer.rpc("admin_customers", {
    p_query: q,
    p_limit: 100,
  });
  if (error) {
    console.error("[admin] 고객 목록 실패:", error.message);
    return Response.json(
      {
        error: "고객 목록을 읽지 못했습니다. migrations-admin-cs.sql 을 실행했는지 확인해 주세요.",
      },
      { status: 500 }
    );
  }

  const customers = ((data ?? []) as Customer[]).map((row) => ({
    ...row,
    revenue: Number(row.revenue),
    refunded: Number(row.refunded),
    ai_jobs: Number(row.ai_jobs),
    inquiries_open: Number(row.inquiries_open),
  }));

  return Response.json({ customers });
}
