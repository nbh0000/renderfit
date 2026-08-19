import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { PlanCards } from "@/components/pricing/PlanCards";
import { getViewer } from "@/lib/auth";

export const metadata: Metadata = {
  title: "요금제",
  description: "무료 3장으로 시작하고, 필요할 때 베이직·프로로 올리세요.",
};

export const dynamic = "force-dynamic";

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
    a: "쓸 수 없습니다. 배치도는 시안의 가구 배치를 이해하기 쉽게 보여 주는 AI 추정 이미지이며, 치수를 표기하지 않습니다. 스튜디오(편집기)에서 실측 치수를 직접 입력하면 그 값 기준의 도면을 받을 수 있지만, 이 경우에도 시공 전에는 반드시 현장 실측으로 최종 확인하세요.",
  },
  {
    q: "생성에 실패하면 크레딧은 어떻게 되나요?",
    a: "실패한 생성은 크레딧이 자동으로 환불됩니다. 구독 요금 자체의 환불은 결제일로부터 7일 이내이면서 해당 달의 크레딧을 사용하지 않은 경우에 가능합니다.",
  },
];

export default async function PricingPage() {
  const viewer = await getViewer();

  return (
    <div className="min-h-dvh">
      <AppHeader active="pricing" authed={Boolean(viewer.userId)} />

      <main className="mx-auto max-w-[1000px] px-4 py-10 sm:px-6">
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
            {FAQ.map((item) => (
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
    </div>
  );
}
