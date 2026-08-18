import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { PlanCards } from "@/components/pricing/PlanCards";
import { getViewer } from "@/lib/auth";

export const metadata: Metadata = {
  title: "요금제",
  description: "무료 3장으로 시작하고, 필요할 때 베이직·프로로 올리세요.",
};

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const viewer = await getViewer();

  return (
    <div className="min-h-dvh">
      <AppHeader active="pricing" />

      <main className="mx-auto max-w-[1000px] px-4 py-10 sm:px-6">
        <h1 className="serif-display text-[26px] leading-tight sm:text-[30px]">요금제</h1>
        <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-ink-soft">
          1장 생성에 1크레딧, 고해상도는 2크레딧입니다. 크레딧은 매월 갱신되며 다음 달로 이월되지 않습니다.
        </p>

        <div className="mt-8">
          <PlanCards
            currentPlan={viewer.profile?.plan ?? null}
            authed={Boolean(viewer.userId)}
            email={viewer.profile?.email}
          />
        </div>

        <p className="mt-6 text-[12px] leading-relaxed text-muted">
          {/* TODO: 토스페이먼츠 실연동 후 문구 교체 */}
          결제는 토스페이먼츠로 준비 중입니다. 연동 전까지는 결제 없이 무료 플랜으로 이용할 수 있습니다.
          상업적 이용은 프로 플랜에서 허용되며, 생성물은 참고용 시안으로 실제 시공 도면이 아닙니다.
        </p>
      </main>
    </div>
  );
}
