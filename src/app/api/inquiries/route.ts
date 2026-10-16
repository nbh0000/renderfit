import { getViewer } from "@/lib/auth";
import { createAdminSupabase, createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createInquiry, listMyInquiries, validateInquiry } from "@/lib/inquiries";

/** 내가 남긴 문의 — 답변이 달렸는지 보려고 */
export async function GET() {
  if (!isSupabaseConfigured()) return Response.json({ inquiries: [] });

  const viewer = await getViewer();
  if (!viewer.userId) return Response.json({ inquiries: [] });

  const supabase = await createServerSupabase();
  if (!supabase) return Response.json({ inquiries: [] });

  return Response.json({
    inquiries: await listMyInquiries(supabase, viewer.userId),
  });
}

/**
 * 문의 남기기. 로그인하지 않아도 된다 — 로그인이 안 돼서 문의하는 사람도 있다.
 */
export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const checked = validateInquiry(payload);
  if (!checked.ok) return Response.json({ error: checked.error }, { status: 400 });

  if (!isSupabaseConfigured()) {
    // 로컬 mock 모드 — 저장할 곳이 없으니 받은 것으로 친다
    return Response.json({ ok: true });
  }

  const writer = createAdminSupabase();
  if (!writer) return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const viewer = await getViewer();
  const origin = new URL(request.url).origin;

  const inquiry = await createInquiry(
    writer,
    { userId: viewer.userId, ...checked.value },
    `${origin}/admin?tab=inquiries`
  );
  if (!inquiry) return Response.json({ error: "문의를 저장하지 못했습니다." }, { status: 500 });

  return Response.json({ ok: true, id: inquiry.id });
}
