import { isBusinessRegistered } from "@/config/business";

/**
 * 서버 쪽 결제 설정.
 *
 * 시크릿 키는 절대 클라이언트로 나가면 안 되므로 이 파일은 서버에서만 쓴다.
 */

export function tossSecretKey(): string {
  return process.env.TOSS_SECRET_KEY ?? "";
}

/**
 * 지금 돈을 받아도 되는가.
 *
 * 키가 있는 것과 팔아도 되는 것은 다르다. 사업자 정보를 표시하지 않은 채 결제를 받으면
 * 전자상거래법 위반이라, 그 정보가 채워지기 전에는 결제 경로를 아예 막는다.
 */
export function canSellOnServer(): { ok: boolean; reason?: string } {
  if (!isBusinessRegistered()) {
    return { ok: false, reason: "사업자 정보 등록 전에는 결제를 받을 수 없습니다." };
  }
  if (!tossSecretKey()) {
    return { ok: false, reason: "결제 연동 준비 중입니다." };
  }
  return { ok: true };
}

/** 토스 API는 시크릿 키를 Basic 인증으로 받는다 (키 뒤에 콜론을 붙여 base64) */
export function tossAuthHeader(): string {
  return `Basic ${Buffer.from(`${tossSecretKey()}:`).toString("base64")}`;
}

export const TOSS_API = "https://api.tosspayments.com/v1";
