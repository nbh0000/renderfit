import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { adminEmails, hasAdmins, isAdminEmail } from "@/lib/admin";
import { formatAlert, alertsConfigured } from "@/lib/alerts";
import { isEventName } from "@/lib/events";

/**
 * 관리자 권한과 알림.
 *
 * 관리자 화면에는 매출과 사고 기록이 들어 있다. 권한 판별이 헐거우면 그게 그대로
 * 새어 나가므로, 설정을 잊었을 때 어느 쪽으로 기우는지까지 시험한다.
 */

const original = { admins: process.env.ADMIN_EMAILS, hook: process.env.ALERT_WEBHOOK_URL };

beforeEach(() => {
  delete process.env.ADMIN_EMAILS;
  delete process.env.ALERT_WEBHOOK_URL;
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.KAKAO_ACCESS_TOKEN;
});

afterEach(() => {
  process.env.ADMIN_EMAILS = original.admins;
  process.env.ALERT_WEBHOOK_URL = original.hook;
});

describe("관리자 판별", () => {
  it("목록에 있으면 관리자다", () => {
    process.env.ADMIN_EMAILS = "boss@example.com";
    expect(isAdminEmail("boss@example.com")).toBe(true);
  });

  it("대소문자와 앞뒤 공백은 무시한다", () => {
    process.env.ADMIN_EMAILS = " Boss@Example.com , other@example.com ";
    expect(isAdminEmail("boss@example.com")).toBe(true);
    expect(isAdminEmail("OTHER@EXAMPLE.COM")).toBe(true);
  });

  it("목록에 없으면 아니다", () => {
    process.env.ADMIN_EMAILS = "boss@example.com";
    expect(isAdminEmail("someone@example.com")).toBe(false);
  });

  it("설정을 잊으면 아무도 관리자가 아니다", () => {
    /*
     * 여기서 반대로 기울면 — 목록이 비었을 때 모두 통과시키면 — 매출과 사고 기록이
     * 통째로 열린다. 아무도 못 들어가는 쪽이 훨씬 안전하다.
     */
    expect(hasAdmins()).toBe(false);
    expect(isAdminEmail("anyone@example.com")).toBe(false);
    expect(adminEmails()).toEqual([]);
  });

  it("이메일이 없는 사용자는 아니다", () => {
    process.env.ADMIN_EMAILS = "boss@example.com";
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
    expect(isAdminEmail("")).toBe(false);
  });
});

describe("알림 문구", () => {
  it("한눈에 심각도를 알아볼 수 있다", () => {
    const text = formatAlert({ level: "error", title: "결제 실패", body: "카드 한도 초과" });

    expect(text).toContain("🚨");
    expect(text).toContain("[렌더핏]");
    expect(text).toContain("결제 실패");
    expect(text).toContain("카드 한도 초과");
  });

  it("주소를 주면 눌러 볼 수 있게 붙인다", () => {
    const text = formatAlert({
      level: "warn",
      title: "AI 작업 실패",
      body: "렌더 실패",
      url: "https://example.com/admin",
    });

    expect(text).toContain("https://example.com/admin");
  });

  it("보낼 곳이 없으면 설정되지 않은 것으로 본다", () => {
    expect(alertsConfigured()).toBe(false);
  });

  it("웹훅 하나만 있어도 보낼 곳이 있는 것이다", () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example.com/abc";
    expect(alertsConfigured()).toBe(true);
  });
});

describe("사용 기록 이름", () => {
  it("우리가 세는 이름만 받는다", () => {
    expect(isEventName("page_view")).toBe(true);
    expect(isEventName("render_start")).toBe(true);
  });

  it("모르는 이름은 버린다 — 통계가 지저분해지면 못 쓴다", () => {
    expect(isEventName("아무거나")).toBe(false);
    expect(isEventName("")).toBe(false);
    expect(isEventName(123)).toBe(false);
    expect(isEventName(null)).toBe(false);
  });
});
