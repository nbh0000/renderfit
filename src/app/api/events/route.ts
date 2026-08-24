import { cookies } from "next/headers";
import { getViewer } from "@/lib/auth";
import { isEventName, recordEvent } from "@/lib/events";

/**
 * 브라우저가 보내는 사용 기록을 받는다.
 *
 * 방문자를 세려면 브라우저마다 값이 하나 있어야 하는데, 그 값을 클라이언트가 만들어
 * 보내면 마음대로 바꿀 수 있다. 그래서 여기서 쿠키로 발급한다. 무작위 문자열이라
 * 개인을 알아볼 수 없고, 광고나 추적에 쓰지 않는다.
 */

const VISITOR_COOKIE = "rf_visitor";
const YEAR = 60 * 60 * 24 * 365;

export async function POST(request: Request) {
  let body: { name?: string; path?: string; props?: Record<string, unknown> };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response(null, { status: 204 });
  }

  // 모르는 이름은 조용히 버린다 — 통계가 지저분해지는 것을 막는다
  if (!isEventName(body.name)) return new Response(null, { status: 204 });

  const jar = await cookies();
  let visitor = jar.get(VISITOR_COOKIE)?.value;
  let issued = false;

  if (!visitor) {
    visitor = crypto.randomUUID();
    issued = true;
  }

  const viewer = await getViewer();
  await recordEvent({
    name: body.name,
    userId: viewer.userId,
    visitor,
    path: typeof body.path === "string" ? body.path : null,
    props: body.props ?? {},
  });

  const response = new Response(null, { status: 204 });

  if (issued) {
    jar.set(VISITOR_COOKIE, visitor, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: YEAR,
      path: "/",
    });
  }

  return response;
}
