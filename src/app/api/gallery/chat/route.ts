import { getViewer } from "@/lib/auth";
import { createAdminSupabase, createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { checkWrite } from "@/lib/bans";
import { clientIp, screenMessage } from "@/lib/moderation";
import {
  CHAT_MAX,
  addChat,
  listChat,
  memoryAddChat,
  memoryListChat,
  normalizeBody,
  viewerAuthorName,
} from "@/lib/community";

/** 최근 대화 (오래된 순). 실시간 구독 전에 한 번 채우고, mock 모드에서는 주기적으로 다시 읽는다 */
export async function GET() {
  if (!isSupabaseConfigured()) return Response.json({ messages: memoryListChat() });

  const supabase = await createServerSupabase();
  if (!supabase) return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  return Response.json({ messages: await listChat(supabase) });
}

/** 메시지 보내기 — 로그인한 사람만 */
export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as {
    body?: unknown;
  };
  const body = normalizeBody(payload.body, CHAT_MAX);
  if (!body) {
    return Response.json(
      { error: `메시지는 1자 이상 ${CHAT_MAX}자 이하로 적어 주세요.` },
      { status: 400 }
    );
  }

  /* 로컬 mock 모드 — 차단 기록은 없지만 필터는 똑같이 돈다 */
  if (!isSupabaseConfigured()) {
    const verdict = screenMessage(body);
    if (!verdict.ok) {
      return Response.json(
        { error: `${verdict.label}으로 보이는 내용은 보낼 수 없습니다.` },
        { status: 400 }
      );
    }
    return Response.json({ message: memoryAddChat(body) });
  }

  const viewer = await getViewer();
  if (!viewer.userId) return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const supabase = await createServerSupabase();
  if (!supabase) return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  // 차단됐거나 걸리는 내용이면 여기서 끝난다 — 저장하지 않는다
  const check = await checkWrite(createAdminSupabase(), {
    userId: viewer.userId,
    ip: clientIp(request.headers),
    body,
  });
  if (!check.ok) return Response.json({ error: check.error }, { status: check.status });

  const result = await addChat(
    supabase,
    { userId: viewer.userId, authorName: viewerAuthorName(viewer) },
    body
  );
  if ("error" in result) return Response.json({ error: result.error }, { status: 500 });
  return Response.json({ message: result });
}
