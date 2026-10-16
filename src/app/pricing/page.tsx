import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { PlanCards } from "@/components/pricing/PlanCards";
import { getViewer } from "@/lib/auth";
import { SiteFooter } from "@/components/legal/SiteFooter";
import { PaymentResult } from "@/components/pricing/PaymentResult";
import { PRICING_FAQ } from "@/config/faq";
import { BRAND } from "@/config/brand";
import { JsonLd, breadcrumbLd, faqPageLd, pricingOffersLd } from "@/lib/seo";

export const metadata: Metadata = {
  title: "요금제",
  description: "무료 3장으로 시작하고, 필요할 때 베이직·프로로 올리세요.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: `요금제 | ${BRAND.name}`,
    description: "무료 3장으로 시작하고, 필요할 때 베이직·프로로 올리세요.",
  },
};

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const viewer = await getViewer();

  return (
    <AppShell active="pricing" authed={Boolean(viewer.userId)}>
      <JsonLd
        graph={[
          ...pricingOffersLd(),
          faqPageLd(PRICING_FAQ),
          breadcrumbLd([
            { name: BRAND.name, path: "/" },
            { name: "요금제", path: "/pricing" },
          ]),
        ]}
      />

      <main className="mx-auto max-w-[1000px] px-4 py-10 sm:px-6">
        <PaymentResult />
        <h1 className="serif-display text-[26px] leading-tight sm:text-[30px]">요금제</h1>
        <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-ink-soft">
          1장 생성에 1크레딧, 고해상도는 2크레딧입니다. 크레딧은 매월 갱신되며 다음 달로 이월되지
          않습니다.
        </p>

        <div className="mt-8">
          <PlanCards
            currentPlan={viewer.profile?.plan ?? null}
            authed={Boolean(viewer.userId)}
            email={viewer.profile?.email}
          />
        </div>

        {/* 메인에서 덜어 낸 안내는 여기로 모은다 */}
        <section className="mt-12">
          <h2 className="text-[18px] font-semibold tracking-tight">자주 묻는 질문</h2>
          <div className="mt-4 divide-y divide-line border-y border-line">
            {PRICING_FAQ.map((item) => (
              <details key={item.q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[14.5px] font-medium">
                  {item.q}
                  <span
                    aria-hidden
                    className="shrink-0 text-muted transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-[13.5px] leading-relaxed text-ink-soft">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <p className="mt-6 text-[12px] leading-relaxed text-muted">
          {/* TODO: 토스페이먼츠 실연동 후 문구 교체 */}
          결제는 토스페이먼츠로 준비 중입니다. 연동 전까지는 결제 없이 무료 플랜으로 이용할 수
          있습니다. 상업적 이용은 프로 플랜에서 허용되며, 생성물은 참고용 시안으로 실제 시공 도면이
          아닙니다.
        </p>
      </main>

      <SiteFooter />
    </AppShell>
  );
}
