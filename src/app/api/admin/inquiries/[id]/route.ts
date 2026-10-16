import { requireAdmin } from "@/lib/admin-api";
import { isInquiryStatus, updateInquiry, type InquiryStatus } from "@/lib/inquiries";

/** 문의에 답변·메모·상태를 적는다 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  const { id } = await ctx.params;

  const body = (await request.json().catch(() => ({}))) as {
    reply?: unknown;
    adminNote?: unknown;
    status?: unknown;
  };

  const patch: {
    reply?: string | null;
    adminNote?: string | null;
    status?: InquiryStatus;
  } = {};
  if (typeof body.reply === "string") patch.reply = body.reply.trim().slice(0, 3000) || null;
  if (typeof body.adminNote === "string")
    patch.adminNote = body.adminNote.trim().slice(0, 1000) || null;
  if (isInquiryStatus(body.status)) patch.status = body.status;

  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "바꿀 내용이 없습니다." }, { status: 400 });
  }

  const inquiry = await updateInquiry(guard.writer, id, patch);
  if (!inquiry) return Response.json({ error: "문의를 고치지 못했습니다." }, { status: 500 });

  return Response.json({ inquiry });
}
