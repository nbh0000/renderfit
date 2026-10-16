import { requireAdmin } from "@/lib/admin-api";
import { recordIncident } from "@/lib/incidents";

/**
 * 구독 취소 (관리자).
 *
 * - mode "cancel": 해지 예약. 이번 주기 끝까지 쓰고 다음 결제는 걸지 않는다.
 * - mode "expire": 즉시 종료. 요금제를 바로 무료로 되돌린다 (환불과 함께 쓴다).
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;
  const { writer, viewer } = guard;

  const body = (await request.json().catch(() => ({}))) as {
    mode?: unknown;
    reason?: unknown;
  };
  const mode = body.mode === "expire" ? "expire" : body.mode === "cancel" ? "cancel" : null;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
  if (!mode) return Response.json({ error: "mode 는 cancel 또는 expire 입니다." }, { status: 400 });
  if (!reason) return Response.json({ error: "사유를 적어 주세요." }, { status: 400 });

  const { data: subscription } = await writer
    .from("subscriptions")
    .select("id, user_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!subscription) return Response.json({ error: "구독을 찾을 수 없습니다." }, { status: 404 });
  if (subscription.status === "expired") {
    return Response.json({ error: "이미 끝난 구독입니다." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { error } = await writer
    .from("subscriptions")
    .update({
      status: mode === "expire" ? "expired" : "canceled",
      canceled_at: now,
      updated_at: now,
    })
    .eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  if (mode === "expire") await writer.rpc("expire_plan", { p_user: subscription.user_id });

  await recordIncident({
    kind: "admin_action",
    userId: subscription.user_id,
    message: `${mode === "expire" ? "구독 즉시 종료" : "구독 해지 예약"} — ${reason}`,
    context: { subscriptionId: id, by: viewer.authEmail },
  });

  return Response.json({ ok: true });
}
