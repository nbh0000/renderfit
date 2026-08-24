import { createAdminSupabase } from "@/lib/supabase/server";

/**
 * 사용 기록.
 *
 * 방문·클릭·AI 작업을 우리 DB에 직접 담는다. 외부 분석 도구를 붙이지 않는 것은
 * 개인정보처리방침에 "광고·행태정보 수집 목적의 쿠키는 쓰지 않는다"고 적어 뒀기
 * 때문이다 — 말과 코드가 어긋나면 안 된다.
 *
 * 기록이 실패해도 부르는 쪽을 막지 않는다. 통계를 남기려다 사용자의 일을 막는 것은
 * 앞뒤가 바뀐 것이다.
 */

export type EventName =
  /** 페이지를 봤다 */
  | "page_view"
  /** 편집기를 열었다 */
  | "editor_open"
  /** 사진·도면 분석을 시작했다 */
  | "analyze_start"
  /** 렌더를 시작했다 */
  | "render_start"
  /** 설명으로 가구를 만들었다 */
  | "generate_asset"
  /** AI 명령을 실행했다 */
  | "ai_command"
  /** 시안을 갤러리에 공개했다 */
  | "gallery_publish";

export interface EventInput {
  name: EventName;
  userId?: string | null;
  /** 로그인하지 않은 방문을 세기 위한 브라우저별 값 */
  visitor?: string | null;
  path?: string | null;
  /** 크레딧을 쓴 작업이면 얼마를 썼는지 넣는다 — 대시보드가 이 값을 합산한다 */
  props?: Record<string, unknown>;
}

export async function recordEvent(event: EventInput): Promise<void> {
  try {
    const admin = createAdminSupabase();
    if (!admin) return;

    await admin.from("events").insert({
      name: event.name,
      user_id: event.userId ?? null,
      visitor: event.visitor?.slice(0, 64) ?? null,
      path: event.path?.slice(0, 200) ?? null,
      props: event.props ?? {},
    });
  } catch (error) {
    console.warn(
      "[events] 남기지 못했습니다:",
      error instanceof Error ? error.message : "알 수 없는 오류"
    );
  }
}

/** 우리가 세는 이름인가 — 아무 문자열이나 들어오면 통계가 지저분해진다 */
const KNOWN: EventName[] = [
  "page_view",
  "editor_open",
  "analyze_start",
  "render_start",
  "generate_asset",
  "ai_command",
  "gallery_publish",
];

export function isEventName(value: unknown): value is EventName {
  return typeof value === "string" && (KNOWN as string[]).includes(value);
}
