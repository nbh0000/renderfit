export type PlanId = "free" | "basic" | "pro";

export type FeatureKey =
  | "masking"
  | "materials"
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

/**
 * 해상도 옵션.
 *
 * id는 DB(generation_jobs.resolution)에 그대로 저장되므로 기존 값을 바꾸지 않는다.
 * 해상도마다 쓰는 모델이 다르다 — 2K·4K는 Nano Banana Pro만 지원한다.
 */
export type ResolutionId = "standard" | "high" | "ultra";

export interface ResolutionOption {
  id: ResolutionId;
  label: string;
  /** 긴 변 기준 목표 픽셀 */
  px: 1024 | 2048 | 4096;
  /** 1장당 크레딧 */
  creditsPerImage: number;
  requiredPlan: PlanId;
  /** 이 해상도를 만들 수 있는 모델 (환경변수 GEMINI_IMAGE_MODEL로 전체 덮어쓰기 가능) */
  model: string;
  /** 옵션 아래에 붙는 짧은 설명 */
  note: string;
  /** 1장 생성에 걸리는 대략적인 시간(초) — 대기 화면 안내에 쓴다 */
  estimatedSeconds: number;
}

/*
 * 사용 모델과 원가.
 *
 * 2026-08 기준 공식 단가(장당)와 실측 결과다.
 *   gemini-2.5-flash-image (Nano Banana)     $0.039  → 2K를 요청해도 1184×864
 *   gemini-3.1-flash-image (Nano Banana 2)   2K $0.101 / 4K $0.151
 *                                            → 2K 2400×1792(26초), 4K 4800×3584(28초)
 *   gemini-3-pro-image     (Nano Banana Pro) 1~2K $0.134 / 4K $0.24
 *                                            → 4K 4800×3584(42초)
 *
 * 4K는 Nano Banana 2가 Pro보다 37% 싸고 더 빠르며, 실측에서 원본 구조도 덜 흐트러졌다.
 * 그래서 Pro는 기본 경로에서 쓰지 않는다.
 */

/** 기본 해상도용 — 가장 저렴하고 빠르다 */
export const MODEL_FLASH = "gemini-2.5-flash-image";
/** 2K·4K가 실제로 나오는 모델 */
export const MODEL_FLASH_HI = "gemini-3.1-flash-image";
/**
 * 상위 모델. 현재는 쓰지 않는다 — 더 비싸고 느린데 품질 이득이 뚜렷하지 않았다.
 * 필요하면 RESOLUTIONS의 model 값이나 GEMINI_IMAGE_MODEL로 바꿔 쓸 수 있다.
 */
export const MODEL_PRO = "gemini-3-pro-image";

export const RESOLUTIONS: ResolutionOption[] = [
  {
    id: "standard",
    label: "기본 (1024px)",
    px: 1024,
    creditsPerImage: 1,
    requiredPlan: "free",
    model: MODEL_FLASH,
    note: "빠르고 가볍습니다. 화면으로 보기에 충분합니다.",
    estimatedSeconds: 15,
  },
  {
    id: "high",
    label: "고해상도 (2K)",
    px: 2048,
    creditsPerImage: 3,
    // 해상도는 플랜이 아니라 크레딧으로 조절한다 — 무료 사용자도 한 장은 크게 뽑을 수 있게.
    requiredPlan: "free",
    model: MODEL_FLASH_HI,
    note: "약 2400×1792로 나옵니다. 인쇄물이나 확대해서 볼 때.",
    estimatedSeconds: 30,
  },
  {
    id: "ultra",
    label: "초고해상도 (4K)",
    px: 4096,
    creditsPerImage: 4,
    requiredPlan: "free",
    model: MODEL_FLASH_HI,
    note: "약 4800×3584로 나옵니다. 대형 출력용입니다.",
    estimatedSeconds: 35,
  },
];

export const RESOLUTION_MAP: Record<ResolutionId, ResolutionOption> = Object.fromEntries(
  RESOLUTIONS.map((r) => [r.id, r])
) as Record<ResolutionId, ResolutionOption>;

/** 한 번의 생성 요청에서 만들어지는 결과 장수 (기본값 · 최댓값) */
export const IMAGES_PER_JOB = 4;

/** 사용자가 고를 수 있는 장수. 크레딧을 아끼려는 사람을 위해 1장부터 둔다 */
export const IMAGE_COUNT_OPTIONS = [1, 2, 4] as const;

/** 참고용 배치도 1장 생성 비용 (이미지 1장 = 1크레딧 규칙을 그대로 따른다) */
export const FLOORPLAN_CREDITS = 1;

/**
 * 크레딧: 기본 1장 = 1크레딧, 2K = 3크레딧, 4K = 4크레딧. 월 갱신, 이월 없음.
 * 원가 대비로 정한 값이다 (기본 $0.039 / 2K $0.101 / 4K $0.151).
 */
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
