import Link from "next/link";
import type { Metadata } from "next";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { AppHeader } from "@/components/AppHeader";
import { BRAND } from "@/config/brand";
import { MODES } from "@/config/modes";
import { PLANS } from "@/config/plans";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    title: `${BRAND.name} — ${BRAND.headline}`,
    description: BRAND.description,
    type: "website",
  },
};

const FAQ = [
  {
    q: "구조가 바뀌지 않는다는 게 무슨 뜻인가요?",
    a: "모든 생성 프롬프트에 '벽·창문·문·천장의 위치와 구조는 변경하지 않고, 원본의 카메라 앵글과 원근을 유지한다'는 원칙이 항상 들어갑니다. 바뀌는 것은 가구, 마감재, 조명, 소품이며 붙박이 구조물은 원본을 따릅니다. 더 확실히 지키고 싶은 부분은 보존 마스킹으로 직접 칠해 고정할 수 있습니다.",
  },
  {
    q: "만든 이미지를 클라이언트 제안서에 써도 되나요?",
    a: "프로 플랜에서 상업적 이용이 허용됩니다. 무료 플랜 결과물에는 워터마크가 들어가며 상업적 사용은 제한됩니다. 베이직 플랜은 워터마크가 제거되지만 상업적 이용은 프로 플랜부터입니다.",
  },
  {
    q: "배치도는 실제 도면으로 쓸 수 있나요?",
    a: "쓸 수 없습니다. 배치도는 시안의 가구 배치를 이해하기 쉽게 보여 주는 AI 추정 이미지이며, 치수를 표기하지 않습니다. 이미지와 다운로드 파일 모두에 '실제 치수와 다를 수 있으며 시공용 도면이 아닙니다'라는 고지가 함께 표시됩니다. 시공 전에는 반드시 실측 도면을 사용하세요.",
  },
  {
    q: "생성에 실패하면 크레딧은 어떻게 되나요?",
    a: "실패한 생성은 크레딧이 자동으로 환불됩니다. 구독 요금 자체의 환불은 결제일로부터 7일 이내이면서 해당 달의 크레딧을 사용하지 않은 경우에 가능합니다.",
  },
];

const PRO_FEATURES = [
  {
    title: "보존 마스킹",
    body: "이미 확정된 붙박이장, 조명, 타일 위를 브러시로 칠해 두면 그 영역은 손대지 않습니다. 클라이언트가 승인한 부분은 지키고 나머지만 다시 제안하세요.",
  },
  {
    title: "재질 지정",
    body: "바닥·벽·포인트에 '오크 헤링본 마루', '베이지 도장'처럼 실제 마감재를 적어 넣으면 그대로 반영됩니다. 자재 리스트가 정해진 현장에서 바로 쓸 수 있습니다.",
  },
  {
    title: "고해상도 출력",
    body: "2048px 출력으로 제안서 인쇄와 대형 화면 프레젠테이션에 견딥니다. 평면도 → 렌더 모드도 프로 플랜에서 열립니다.",
  },
];

export default function HomePage() {
  return (
    <div className="min-h-dvh">
      <AppHeader
        right={
          <Link
            href="/studio"
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:bg-accent-hover"
          >
            무료로 시작하기
          </Link>
        }
      />

      {/* 1. 히어로 */}
      <section className="mx-auto max-w-[1100px] px-4 pb-14 pt-12 sm:px-6 sm:pt-16">
        <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
          <div>
            <p className="text-[13px] tracking-tight text-muted">{BRAND.tagline}</p>
            <h1 className="serif-display mt-3 text-[30px] leading-[1.25] sm:text-[40px]">
              사진 한 장, 도면 한 장이
              <br />
              완성된 시안이 됩니다
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-ink-soft">
              벽·창문·문의 구조는 그대로 둔 채 스타일 시안과 포토리얼 렌더를 만듭니다. 마스킹과 재질
              지정으로 원하는 부분만 정확히 조정하세요.
            </p>
            <div className="mt-7 flex flex-wrap gap-2">
              <Link
                href="/studio"
                className="inline-flex h-12 items-center rounded-lg bg-accent px-6 text-[15px] font-medium text-white transition-colors hover:bg-accent-hover"
              >
                무료로 시작하기
              </Link>
              <Link
                href="/gallery"
                className="inline-flex h-12 items-center rounded-lg border border-line-strong px-5 text-[15px] hover:bg-sunken"
              >
                시안 둘러보기
              </Link>
            </div>
            <p className="mt-3 text-[12px] text-muted">가입하면 3장을 무료로 만들어 볼 수 있습니다.</p>
          </div>

          <BeforeAfterSlider
            beforeSrc="/api/placeholder/hero/before"
            afterSrc="/api/placeholder/hero/after"
            beforeLabel="원본 사진"
            afterLabel="생성 시안"
          />
        </div>
      </section>

      {/* 2. 모드 6종 */}
      <section className="border-t border-line bg-surface/60">
        <div className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6">
          <h2 className="text-[20px] font-semibold tracking-tight sm:text-[24px]">
            무엇을 올리든 시안이 됩니다
          </h2>
          <p className="mt-2 text-[14px] text-ink-soft">
            사진, 손스케치, 평면도까지 — 목적에 맞는 6가지 변환 모드를 고르세요.
          </p>

          <ul className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MODES.map((mode) => (
              <li
                key={mode.id}
                className="rounded-[var(--radius-card)] border border-line bg-surface p-5"
              >
                <div className="flex items-center gap-2">
                  <h3 className="text-[15px] font-semibold">{mode.label}</h3>
                  {mode.requiredPlan === "pro" && (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                      프로
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{mode.description}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 3. 프로 기능 */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6">
          <p className="text-[13px] tracking-tight text-accent">디자이너를 위한 컨트롤</p>
          <h2 className="mt-2 text-[20px] font-semibold tracking-tight sm:text-[24px]">
            &lsquo;대충 예쁜 그림&rsquo;이 아니라, 지시한 대로 나오는 시안
          </h2>
          <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-ink-soft">
            현장에서 확정된 조건은 고정하고, 아직 정해지지 않은 부분만 여러 안으로 받아 보세요.
            제안 회차를 줄이는 것이 목표입니다.
          </p>

          <div className="mt-7 grid grid-cols-1 gap-4 md:grid-cols-3">
            {PRO_FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="rounded-[var(--radius-card)] border border-line bg-surface p-5"
              >
                <h3 className="text-[15px] font-semibold">{feature.title}</h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">{feature.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 4. 요금제 미리보기 */}
      <section className="border-t border-line bg-surface/60">
        <div className="mx-auto max-w-[1100px] px-4 py-14 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-[20px] font-semibold tracking-tight sm:text-[24px]">요금제</h2>
            <Link href="/pricing" className="text-[13px] text-accent hover:underline">
              자세히 보기 →
            </Link>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                className={[
                  "rounded-[var(--radius-card)] border bg-surface p-5",
                  plan.id === "pro" ? "border-accent" : "border-line",
                ].join(" ")}
              >
                <h3 className="text-[15px] font-semibold">{plan.label}</h3>
                <p className="mt-1 text-[12.5px] text-muted">{plan.tagline}</p>
                <p className="mt-3 text-[20px] font-semibold tracking-tight">
                  {plan.priceMonthly === 0 ? (
                    "무료"
                  ) : (
                    <>
                      {plan.priceMonthly.toLocaleString("ko-KR")}
                      <span className="text-[13px] font-normal text-muted">원 / 월</span>
                    </>
                  )}
                </p>
                <p className="mt-2 text-[12.5px] text-muted">
                  {plan.grant === "signup"
                    ? `가입 시 ${plan.monthlyCredits}장`
                    : `월 ${plan.monthlyCredits}장`}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. FAQ */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-[760px] px-4 py-14 sm:px-6">
          <h2 className="text-[20px] font-semibold tracking-tight sm:text-[24px]">자주 묻는 질문</h2>
          <div className="mt-6 divide-y divide-line border-y border-line">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium">
                  {item.q}
                  <span
                    aria-hidden
                    className="shrink-0 text-muted transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-[14px] leading-relaxed text-ink-soft">{item.a}</p>
              </details>
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/studio"
              className="inline-flex h-12 items-center rounded-lg bg-accent px-6 text-[15px] font-medium text-white hover:bg-accent-hover"
            >
              무료로 시작하기
            </Link>
            <span className="text-[12px] text-muted">
              생성물은 참고용 시안이며 시공용 도면이 아닙니다.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
