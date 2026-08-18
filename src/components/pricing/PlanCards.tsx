"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PLANS, type PlanId } from "@/config/plans";
import { requestSubscription } from "@/lib/payments/toss";
import { useToast } from "@/components/ui/Toast";

interface Props {
  currentPlan: PlanId | null;
  /** 로그인하지 않은 상태면 결제 대신 로그인으로 보낸다 */
  authed: boolean;
  email?: string | null;
}

export function PlanCards({ currentPlan, authed, email }: Props) {
  const { toast } = useToast();
  const router = useRouter();
  const [pending, setPending] = useState<PlanId | null>(null);

  const checkout = async (planId: PlanId) => {
    if (!authed) {
      router.push("/login?next=/pricing");
      return;
    }

    const plan = PLANS.find((p) => p.id === planId)!;
    setPending(planId);
    const result = await requestSubscription({
      planId,
      amount: plan.priceMonthly,
      customerEmail: email,
    });
    setPending(null);
    toast(result.message, result.ok ? "success" : "neutral");
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {PLANS.map((plan) => {
        const isCurrent = currentPlan === plan.id;
        const highlighted = plan.id === "pro";

        return (
          <section
            key={plan.id}
            className={[
              "flex flex-col rounded-[var(--radius-card)] border bg-surface p-5",
              highlighted ? "border-accent" : "border-line",
            ].join(" ")}
          >
            <div className="flex items-center gap-2">
              <h3 className="text-[16px] font-semibold">{plan.label}</h3>
              {highlighted && (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                  디자이너 추천
                </span>
              )}
            </div>
            <p className="mt-1 text-[12.5px] text-muted">{plan.tagline}</p>

            <p className="mt-4 text-[24px] font-semibold tracking-tight">
              {plan.priceMonthly === 0 ? (
                "무료"
              ) : (
                <>
                  {plan.priceMonthly.toLocaleString("ko-KR")}
                  <span className="text-[14px] font-normal text-muted">원 / 월</span>
                </>
              )}
            </p>

            <ul className="mt-4 flex-1 space-y-1.5">
              {plan.highlights.map((item) => (
                <li key={item} className="flex gap-2 text-[13px] leading-relaxed text-ink-soft">
                  <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                  {item}
                </li>
              ))}
            </ul>

            <button
              type="button"
              disabled={isCurrent || pending === plan.id || plan.id === "free"}
              onClick={() => checkout(plan.id)}
              className={[
                "mt-5 h-11 rounded-lg text-[14px] font-medium transition-colors",
                isCurrent
                  ? "cursor-default border border-line bg-sunken text-muted"
                  : highlighted
                    ? "bg-accent text-white hover:bg-accent-hover"
                    : "border border-line-strong bg-surface text-ink hover:bg-sunken",
                plan.id === "free" && !isCurrent ? "cursor-default opacity-60" : "",
              ].join(" ")}
            >
              {isCurrent
                ? "현재 플랜"
                : plan.id === "free"
                  ? "가입 시 자동 적용"
                  : pending === plan.id
                    ? "처리 중…"
                    : "이 플랜으로 시작"}
            </button>
          </section>
        );
      })}
    </div>
  );
}
