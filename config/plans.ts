export type PlanId = "free" | "basic" | "pro";

export type FeatureKey =
  | "masking"
  | "materials"
  | "plan2render"
  | "highRes"
  | "commercialUse"
  | "noWatermark";

export interface Plan {
  id: PlanId;
  label: string;
  /** 월 구독료 (원). 무료 플랜은 0 */
  priceMonthly: number;
  /** 월 지급 크레딧. free는 가입 시 1회 지급 */
  monthlyCredits: number;
  /** 크레딧 지급 방식 */
  grant: "signup" | "monthly";
  /** 최대 출력 해상도 (px, 긴 변 기준) */
  maxResolution: 1024 | 2048;
  features: Record<FeatureKey, boolean>;
  /** 요금제 카드에 노출할 문구 */
  highlights: string[];
  tagline: string;
}

export const PLANS: Plan[] = [
  {
    id: "free",
    label: "무료",
    priceMonthly: 0,
    monthlyCredits: 3,
    grant: "signup",
    maxResolution: 1024,
    features: {
      masking: false,
      materials: false,
      plan2render: false,
      highRes: false,
      commercialUse: false,
      noWatermark: false,
    },
    highlights: [
      "가입 시 3장 무료 생성",
      "기본 해상도(1024px)",
      "결과물에 워터마크 표시",
      "마스킹 · 재질 지정 · 평면도 렌더 사용 불가",
    ],
    tagline: "먼저 결과를 확인해 보세요",
  },
  {
    id: "basic",
    label: "베이직",
    priceMonthly: 9900,
    monthlyCredits: 100,
    grant: "monthly",
    maxResolution: 1024,
    features: {
      masking: false,
      materials: false,
      plan2render: false,
      highRes: false,
      commercialUse: false,
      noWatermark: true,
    },
    highlights: [
      "월 100장 생성",
      "워터마크 제거",
      "기본 해상도(1024px)",
      "내 프로젝트 정리 기능",
    ],
    tagline: "집 꾸미기, 매물 사진 정리용",
  },
  {
    id: "pro",
    label: "프로",
    priceMonthly: 29900,
    monthlyCredits: 500,
    grant: "monthly",
    maxResolution: 2048,
    features: {
      masking: true,
      materials: true,
      plan2render: true,
      highRes: true,
      commercialUse: true,
      noWatermark: true,
    },
    highlights: [
      "월 500장 생성",
      "고해상도 4K급 출력(2048px)",
      "보존 마스킹 · 재질 지정 컨트롤",
      "평면도 → 렌더 모드",
      "상업적 이용 가능",
    ],
    tagline: "인테리어 디자이너 · 공인중개사용",
  },
];

export const PLAN_MAP: Record<PlanId, Plan> = Object.fromEntries(
  PLANS.map((p) => [p.id, p])
) as Record<PlanId, Plan>;

export function getPlan(id: string): Plan {
  return PLAN_MAP[id as PlanId] ?? PLAN_MAP.free;
}

/** 플랜 상하 관계 비교용 서열 */
export const PLAN_RANK: Record<PlanId, number> = { free: 0, basic: 1, pro: 2 };

export function planAllows(planId: PlanId, required: PlanId): boolean {
  return PLAN_RANK[planId] >= PLAN_RANK[required];
}

/* ── 해상도 옵션 · 크레딧 정책 ── */

export type ResolutionId = "standard" | "high";

export interface ResolutionOption {
  id: ResolutionId;
  label: string;
  px: 1024 | 2048;
  /** 1장당 크레딧 */
  creditsPerImage: number;
  requiredPlan: PlanId;
}

export const RESOLUTIONS: ResolutionOption[] = [
  { id: "standard", label: "기본 (1024px)", px: 1024, creditsPerImage: 1, requiredPlan: "free" },
  { id: "high", label: "고해상도 (2048px)", px: 2048, creditsPerImage: 2, requiredPlan: "pro" },
];

export const RESOLUTION_MAP: Record<ResolutionId, ResolutionOption> = Object.fromEntries(
  RESOLUTIONS.map((r) => [r.id, r])
) as Record<ResolutionId, ResolutionOption>;

/** 한 번의 생성 요청에서 만들어지는 결과 장수 (기본값) */
export const IMAGES_PER_JOB = 4;

/** 참고용 배치도 1장 생성 비용 (이미지 1장 = 1크레딧 규칙을 그대로 따른다) */
export const FLOORPLAN_CREDITS = 1;

/** 크레딧: 1장 = 1크레딧, 고해상도 1장 = 2크레딧. 월 갱신, 이월 없음. */
export function creditCost(resolution: ResolutionId, count: number = IMAGES_PER_JOB): number {
  return RESOLUTION_MAP[resolution].creditsPerImage * count;
}

/**
 * 남은 크레딧으로 만들 수 있는 장수.
 * 무료 플랜(3크레딧)처럼 4장 값이 안 되는 경우에도 생성이 가능하도록 장수를 줄인다.
 */
export function affordableImageCount(resolution: ResolutionId, credits: number): number {
  const perImage = RESOLUTION_MAP[resolution].creditsPerImage;
  return Math.max(0, Math.min(IMAGES_PER_JOB, Math.floor(credits / perImage)));
}
