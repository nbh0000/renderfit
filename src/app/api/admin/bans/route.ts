import { requireAdmin } from "@/lib/admin-api";
import { createBan, liftBan, listModeration } from "@/lib/bans";

/** 살아 있는 차단과 최근 위반 */
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  return Response.json(await listModeration(guard.writer));
}

/** 손으로 차단 — 계정 id 또는 IP, 기간(일, 비우면 영구) */
export async function POST(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as {
    userId?: unknown;
    ip?: unknown;
    reason?: unknown;
    days?: unknown;
  };
  const userId = typeof body.userId === "string" && body.userId.trim() ? body.userId.trim() : null;
  const ip = typeof body.ip === "string" && body.ip.trim() ? body.ip.trim().slice(0, 64) : null;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
  const days = typeof body.days === "number" && body.days > 0 ? Math.min(3650, body.days) : null;

  if (!userId && !ip)
    return Response.json({ error: "계정 id 나 IP 중 하나는 있어야 합니다." }, { status: 400 });
  if (!reason) return Response.json({ error: "사유를 적어 주세요." }, { status: 400 });

  const ban = await createBan(guard.writer, {
    userId,
    ip,
    reason,
    createdBy: guard.viewer.authEmail ?? "admin",
    expiresAt: days ? new Date(Date.now() + days * 86400 * 1000).toISOString() : null,
  });
  if (!ban) return Response.json({ error: "차단을 등록하지 못했습니다." }, { status: 500 });

  return Response.json({ ban });
}

/** 차단 해제 */
export async function DELETE(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id 가 필요합니다." }, { status: 400 });

  const ok = await liftBan(guard.writer, id);
  return ok
    ? Response.json({ ok: true })
    : Response.json({ error: "해제하지 못했습니다." }, { status: 500 });
}
