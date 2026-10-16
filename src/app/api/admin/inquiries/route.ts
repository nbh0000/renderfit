import { requireAdmin } from "@/lib/admin-api";
import { isInquiryStatus, listInquiries } from "@/lib/inquiries";

/** 문의 목록 — 기본은 대기 중인 것만 */
export async function GET(request: Request) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const raw = new URL(request.url).searchParams.get("status") ?? "open";
  const status = raw === "all" ? "all" : isInquiryStatus(raw) ? raw : "open";

  return Response.json({
    inquiries: await listInquiries(guard.writer, status),
  });
}
