/**
 * 공간 크기 입력 설정.
 *
 * 평수·치수를 프롬프트 문장으로 바꾸는 규칙은 전부 여기에 둔다.
 * (프롬프트 문장을 코드 곳곳에 하드코딩하지 않는다)
 */

/** 1평 = 3.305785㎡ */
export const PYEONG_TO_M2 = 3.305785;

/** 입력 허용 범위 — 밖으로 나가면 값을 무시한다 */
export const SPACE_LIMITS = {
  minPyeong: 1,
  maxPyeong: 300,
  /** 가로·세로 (mm) */
  minSide: 500,
  maxSide: 50000,
  /** 천장 높이 (mm) */
  minHeight: 1500,
  maxHeight: 10000,
} as const;

/** 빠른 선택 버튼 (평) */
export const PYEONG_PRESETS = [8, 15, 24, 34, 45] as const;

/** 천장 높이를 따로 입력하지 않았을 때 쓰는 기본값 (국내 아파트 표준) */
export const DEFAULT_CEILING_MM = 2400;

/**
 * 크기 지시문. {{size}}에는 "약 24평(79.3㎡)" 같은 요약이 들어간다.
 * 구조 보존 원칙과 충돌하지 않도록 '가구 규모'에 대한 지시만 담는다.
 */
export const SPACE_PROMPT_TEMPLATE = [
  "대상 공간의 실제 크기는 {{size}}이다.",
  "가구의 크기·개수와 통로 폭은 이 면적에 실제로 들어갈 수 있는 수준으로 맞춘다.",
  "면적에 비해 지나치게 크거나 많은 가구를 넣지 않고, 반대로 공간이 비어 보이지도 않게 채운다.",
].join("\n");
