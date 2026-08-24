import { cookies } from "next/headers";
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
  let body: { name?: string; path?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response(null, { status: 204 });
  }

  /*
   * 브라우저가 보낼 수 있는 것은 방문 기록뿐이다.
   *
   * 나머지 기록(분석·렌더·가구 만들기)은 그 일을 실제로 한 서버 라우트가 남긴다.
   * 여기서 아무 이름이나 받으면 누구나 "렌더 100번 했다"고 던져 넣어 사용량 통계를
   * 부풀릴 수 있다 — 그 숫자로 요금제를 판단할 참이라 믿을 수 있어야 한다.
   */
  if (body.name !== "page_view" || !isEventName(body.name)) {
    return new Response(null, { status: 204 });
  }

  const jar = await cookies();
  let visitor = jar.get(VISITOR_COOKIE)?.value;
  let issued = false;

  if (!visitor) {
    visitor = crypto.randomUUID();
    issued = true;
  }

  /*
   * 클라이언트가 보낸 props는 받지 않는다.
   *
   * props.credits 는 관리자 화면에서 크레딧 사용량을 합산하는 데 쓰인다. 브라우저가
   * 보내는 값을 그대로 담으면 누구나 { credits: 99999 } 를 던져 매출·사용량 분석을
   * 망가뜨릴 수 있다. 값이 붙는 기록은 전부 서버 안에서 recordEvent 를 부른다.
   *
   * 누가 봤는지도 여기서 확인하지 않는다. 확인하려면 인증 서버에 다녀와야 하는데,
   * 페이지를 넘길 때마다 그 왕복을 하는 것은 통계 하나 남기자고 치르기엔 비싸다.
   * 방문 수는 쿠키의 방문자 값으로 세고, 사람이 붙는 기록은 서버 쪽에서 남긴다.
   */
  await recordEvent({
    name: body.name,
    visitor,
    path: typeof body.path === "string" ? body.path : null,
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
