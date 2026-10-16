import { getViewer, getViewerId } from "@/lib/auth";
import { createAdminSupabase, createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { checkWrite } from "@/lib/bans";
import { clientIp, screenMessage } from "@/lib/moderation";
import {
  COMMENT_MAX,
  addComment,
  listComments,
  memoryAddComment,
  memoryListComments,
  normalizeBody,
  viewerAuthorName,
} from "@/lib/community";

/** 시안 댓글 목록 (오래된 순) */
export async function GET(_request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const decoded = decodeURIComponent(slug);

  if (!isSupabaseConfigured()) return Response.json({ comments: memoryListComments(decoded) });

  const supabase = await createServerSupabase();
  if (!supabase) return Response.json({ error: "서버 설정 오류입니다." }, { status: 500 });

  const viewerId = await getViewerId();
  return Response.json({
    comments: await listComments(supabase, decoded, viewerId),
  });
}

/** 댓글 작성 — 로그인한 사람만. 이름은 쓰는 시점의 프로필에서 가져와 행에 적는다 */
export async function POST(request: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const decoded = decodeURIComponent(slug);

  const payload = (await request.json().catch(() => ({}))) as {
    body?: unknown;
  };
  const body = normalizeBody(payload.body, COMMENT_MAX);
  if (!body) {
    return Response.json(
      { error: `댓글은 1자 이상 ${COMMENT_MAX}자 이하로 적어 주세요.` },
      { status: 400 }
    );
  }

  /* 로컬 mock 모드 — 로그인 개념이 없으므로 메모리에 쌓는다. 필터는 똑같이 돈다 */
  if (!isSupabaseConfigured()) {
    const verdict = screenMessage(body);
    if (!verdict.ok) {
      return Response.json(
        { error: `${verdict.label}으로 보이는 내용은 보낼 수 없습니다.` },
        { status: 400 }
      );
    }
    return Response.json({ comment: memoryAddComment(decoded, body) });
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

  const result = await addComment(
    supabase,
    decoded,
    { userId: viewer.userId, authorName: viewerAuthorName(viewer) },
    body
  );
  if ("error" in result) {
    return Response.json(
      { error: result.error },
      { status: result.error.includes("찾을") ? 404 : 500 }
    );
  }
  return Response.json({ comment: result });
}
