import { requireAdmin } from "@/lib/admin-api";

export type AdminPayment = {
  id: string;
  user_id: string;
  email: string | null;
  order_id: string;
  payment_key: string | null;
  plan: string;
  amount: number;
  status: string;
  refunded_amount: number;
  failure_reason: string | null;
  subscription_id: string | null;
  created_at: string;
  updated_at: string;
};

const STATUSES = ["all", "paid", "refunded", "canceled", "failed", "pending"];

/**
 * 결제 목록 — 환불·취소 화면이 쓴다.
 * 이메일은 profiles 에서 붙여 준다 (payments 에는 user_id 뿐이다).
 */
export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const params = new URL(request.url).searchParams;
  const status = STATUSES.includes(params.get("status") ?? "") ? params.get("status")! : "all";
  const q = (params.get("q") ?? "").trim().slice(0, 100);

  let query = guard.writer
    .from("payments")
    .select(
      "id, user_id, order_id, payment_key, plan, amount, status, refunded_amount, failure_reason, subscription_id, created_at, updated_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as Omit<AdminPayment, "email">[];
  const userIds = [...new Set(rows.map((row) => row.user_id))];

  const emails = new Map<string, string | null>();
  if (userIds.length > 0) {
    const { data: profiles } = await guard.writer
      .from("profiles")
      .select("id, email")
      .in("id", userIds);
    for (const p of (profiles ?? []) as {
      id: string;
      email: string | null;
    }[]) {
      emails.set(p.id, p.email);
    }
  }

  let payments: AdminPayment[] = rows.map((row) => ({
    ...row,
    email: emails.get(row.user_id) ?? null,
  }));
  if (q) {
    const needle = q.toLowerCase();
    payments = payments.filter(
      (p) =>
        p.order_id.toLowerCase().includes(needle) || (p.email ?? "").toLowerCase().includes(needle)
    );
  }

  return Response.json({ payments });
}
