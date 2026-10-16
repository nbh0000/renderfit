/**
 * 외부 API 단가 (추정치).
 *
 * "수익 대비 비용"을 대시보드에 보이려고 호출마다 원화로 환산해 적는다.
 * 여기 숫자는 공개 요금표를 보고 넣은 추정치다 — 실제 청구서와 다르면 이 파일만 고친다.
 * 이미지 생성은 장당, 텍스트 호출은 건당으로 센다.
 */

/** 달러 → 원. 환경변수 USD_KRW 로 바꿀 수 있다 */
export function usdToKrw(): number {
  const value = Number(process.env.USD_KRW);
  return Number.isFinite(value) && value > 0 ? value : 1400;
}

/** 모델별 이미지 한 장 값 (USD). 모르는 모델은 DEFAULT_IMAGE_USD 로 친다 */
export const IMAGE_USD: Record<string, number> = {
  "gemini-2.5-flash-image": 0.039,
  "gemini-3.1-flash-image": 0.067,
  "gemini-3-pro-image": 0.134,
};
export const DEFAULT_IMAGE_USD = 0.05;

/** 텍스트(JSON) 호출 한 건 값 (USD) — 짧은 프롬프트라 이 정도다 */
export const TEXT_CALL_USD = 0.001;

/** 한 호출의 추정 비용(원) */
export function estimateCostKrw(model: string, images: number): number {
  const usd = images > 0 ? (IMAGE_USD[model] ?? DEFAULT_IMAGE_USD) * images : TEXT_CALL_USD;
  return Math.round(usd * usdToKrw() * 100) / 100;
}
