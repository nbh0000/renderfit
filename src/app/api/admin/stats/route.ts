import { getViewer } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { createAdminSupabase } from "@/lib/supabase/server";

/**
 * 관리자 대시보드가 쓰는 숫자.
 *
 * 서비스 롤로 읽으므로 권한 확인을 여기서 반드시 한다 — 이 응답에는 매출과 사고
 * 기록이 들어 있다.
 */

export type DailyStat = {
  day: string;
  visits: number;
  visitors: number;
  signups: number;
  ai_jobs: number;
  credits_spent: number;
  paid_count: number;
  revenue: number;
  incidents: number;
};

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!isAdminEmail(viewer.profile?.email)) {
    return Response.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const admin = createAdminSupabase();
  if (!admin) return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const days = Math.min(90, Math.max(7, Number(new URL(request.url).searchParams.get("days")) || 14));

  const [daily, incidents, payments, totals] = await Promise.all([
    admin.rpc("admin_daily_stats", { p_days: days }),
    admin
      .from("incidents")
      .select("id, kind, severity, message, project_id, created_at, resolved_at")
      .order("created_at", { ascending: false })
      .limit(30),
    admin
      .from("payments")
      .select("id, order_id, plan, amount, status, failure_reason, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    admin.from("profiles").select("plan", { count: "exact" }),
  ]);

  if (daily.error) {
    console.error("[admin] 집계 실패:", daily.error.message);
    return Response.json(
      { error: "집계를 읽지 못했습니다. migrations-admin.sql을 실행했는지 확인해 주세요." },
      { status: 500 }
    );
  }

  /* 요금제별 사용자 수 — 유료 전환이 얼마나 됐는지 본다 */
  const byPlan: Record<string, number> = { free: 0, basic: 0, pro: 0 };
  for (const row of (totals.data ?? []) as { plan: string }[]) {
    byPlan[row.plan] = (byPlan[row.plan] ?? 0) + 1;
  }

  return Response.json({
    daily: (daily.data ?? []) as DailyStat[],
    incidents: incidents.data ?? [],
    payments: payments.data ?? [],
    members: { total: totals.count ?? 0, byPlan },
  });
}
