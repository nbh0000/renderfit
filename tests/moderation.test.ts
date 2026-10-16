import { describe, expect, it } from "vitest";
import {
  STRIKE_LIMIT,
  clientIp,
  collapse,
  screenMessage,
  shouldAutoBan,
  strikeWeight,
} from "@/lib/moderation";
import { normalizeBody } from "@/lib/community";

describe("collapse", () => {
  it("사이에 끼운 공백·숫자·기호를 걷어 낸다", () => {
    expect(collapse("시 1 발")).toBe("시발");
    expect(collapse("씨.발!!")).toBe("씨발");
    expect(collapse("F U C K")).toBe("fuck");
  });
});

describe("screenMessage", () => {
  it("보통의 인테리어 대화는 통과한다", () => {
    for (const text of [
      "거실 소파 색을 베이지로 바꾸니 훨씬 넓어 보이네요",
      "변기 교체하면서 타일도 같이 하셨나요?",
      "한남동 구축 아파트인데 전세대출 받아서 리모델링 고민 중이에요",
      "텔레비전 벽걸이 위치가 애매해요",
      "고추장 냉장고 놓을 자리가 없네요",
      "죽은 공간을 살리는 팁 있을까요",
    ]) {
      expect(screenMessage(text), text).toEqual({ ok: true });
    }
  });

  it("욕설은 변형해도 잡는다", () => {
    expect(screenMessage("아 시발 진짜").ok).toBe(false);
    expect(screenMessage("시 1 발").ok).toBe(false);
    expect(screenMessage("ㅅㅂ 뭐임").ok).toBe(false);
    const verdict = screenMessage("병1신 같은 배치");
    expect(verdict).toMatchObject({ ok: false, kind: "profanity" });
  });

  it("음란한 표현을 잡는다", () => {
    expect(screenMessage("야동 추천")).toMatchObject({ ok: false, kind: "sexual" });
  });

  it("비방을 잡는다", () => {
    expect(screenMessage("여기 업체 사기꾼임")).toMatchObject({ ok: false, kind: "abuse" });
  });

  it("링크·전화번호·메신저 아이디는 광고로 본다", () => {
    expect(screenMessage("여기 보세요 https://example.com")).toMatchObject({ kind: "ad" });
    expect(screenMessage("연락주세요 010-1234-5678")).toMatchObject({ kind: "ad" });
    expect(screenMessage("카톡 아이디 abc123")).toMatchObject({ kind: "ad" });
    expect(screenMessage("당일대출 가능")).toMatchObject({ kind: "ad" });
  });

  it("치수에 나오는 숫자는 전화번호로 오해하지 않는다", () => {
    expect(screenMessage("거실 4500x3600 정도예요")).toEqual({ ok: true });
    expect(screenMessage("예산은 1500만원 잡았어요")).toEqual({ ok: true });
  });
});

describe("자동 차단 규칙", () => {
  it("광고 한 번은 한도와 같다", () => {
    expect(strikeWeight("ad")).toBe(STRIKE_LIMIT);
    expect(shouldAutoBan(strikeWeight("ad"))).toBe(true);
  });

  it("욕설은 한도까지 쌓여야 차단한다", () => {
    expect(shouldAutoBan(strikeWeight("profanity") * (STRIKE_LIMIT - 1))).toBe(false);
    expect(shouldAutoBan(strikeWeight("profanity") * STRIKE_LIMIT)).toBe(true);
  });
});

describe("normalizeBody", () => {
  it("빈 글과 너무 긴 글은 거른다", () => {
    expect(normalizeBody("   ", 10)).toBeNull();
    expect(normalizeBody("a".repeat(11), 10)).toBeNull();
    expect(normalizeBody(42, 10)).toBeNull();
  });

  it("줄바꿈은 두 개까지만 남긴다", () => {
    expect(normalizeBody("a\n\n\n\n\nb", 100)).toBe("a\n\nb");
  });
});

describe("clientIp", () => {
  it("x-forwarded-for 의 첫 항목을 쓴다", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
    expect(clientIp(new Headers())).toBeNull();
  });
});
