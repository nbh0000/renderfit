import { requireAdmin } from "@/lib/admin-api";
import { recordIncident } from "@/lib/incidents";
import { PLAN_MAP, type PlanId } from "@/config/plans";

/** 고객 한 사람의 상세 — 결제·구독·문의·최근 작업·차단 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const { writer } = guard;

  const [profile, payments, subscriptions, inquiries, activity, bans] = await Promise.all([
    writer
      .from("profiles")
      .select("id, email, full_name, plan, credits, period_start, created_at")
      .eq("id", id)
      .maybeSingle(),
    writer
      .from("payments")
      .select(
        "id, order_id, payment_key, plan, amount, status, refunded_amount, failure_reason, created_at"
      )
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    writer
      .from("subscriptions")
      .select(
        "id, plan, status, period_start, period_end, failed_attempts, canceled_at, created_at"
      )
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    writer
      .from("inquiries")
      .select("id, category, subject, status, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    writer
      .from("events")
      .select("id, name, path, props, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
    writer
      .from("gallery_bans")
      .select("id, reason, expires_at, created_at, created_by")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  if (!profile.data) return Response.json({ error: "고객을 찾을 수 없습니다." }, { status: 404 });

  return Response.json({
    profile: profile.data,
    payments: payments.data ?? [],
    subscriptions: subscriptions.data ?? [],
    inquiries: inquiries.data ?? [],
    activity: activity.data ?? [],
    bans: bans.data ?? [],
  });
}

/**
 * 고객 정보 조정 — 크레딧 가감, 요금제 변경.
 *
 * 무엇을 왜 바꿨는지 incidents 에 남긴다. 나중에 "왜 이 사람 크레딧이 이만큼이지"를
 * 되짚을 수 있어야 한다.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const { writer, viewer } = guard;

  const body = (await request.json().catch(() => ({}))) as {
    creditsDelta?: unknown;
    plan?: unknown;
    reason?: unknown;
  };
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  if (!reason) return Response.json({ error: "사유를 적어 주세요." }, { status: 400 });

  const changes: string[] = [];

  if (
    typeof body.creditsDelta === "number" &&
    Number.isInteger(body.creditsDelta) &&
    body.creditsDelta !== 0
  ) {
    const { data, error } = await writer.rpc("admin_adjust_credits", {
      p_user: id,
      p_delta: body.creditsDelta,
    });
    if (error)
      return Response.json({ error: `크레딧 조정 실패: ${error.message}` }, { status: 500 });
    changes.push(`크레딧 ${body.creditsDelta > 0 ? "+" : ""}${body.creditsDelta} → ${data}`);
  }

  if (typeof body.plan === "string") {
    if (!(body.plan in PLAN_MAP))
      return Response.json({ error: "모르는 요금제입니다." }, { status: 400 });
    const plan = body.plan as PlanId;
    const { error } = await writer
      .from("profiles")
      .update({ plan, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error)
      return Response.json({ error: `요금제 변경 실패: ${error.message}` }, { status: 500 });
    changes.push(`요금제 → ${plan}`);
  }

  if (changes.length === 0)
    return Response.json({ error: "바꿀 내용이 없습니다." }, { status: 400 });

  await recordIncident({
    kind: "admin_action",
    userId: id,
    message: `관리자 조정: ${changes.join(", ")} — ${reason}`,
    context: { by: viewer.authEmail, reason },
  });

  return Response.json({ ok: true, changes });
}
