"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

/**
 * 결제를 마치고 돌아왔을 때 결과를 알린다.
 *
 * 토스 인증창은 우리 서버(/api/payments/confirm)를 거쳐 이 페이지로 사용자를 돌려보낸다.
 * 그때 아무 말이 없으면 결제가 된 건지 만 건지 알 수 없어 다시 누르게 된다.
 */
function Result() {
  const params = useSearchParams();
  const state = params.get("payment");
  if (!state) return null;

  const done = state === "done";
  const reason = params.get("reason");

  return (
    <div
      role="status"
      className={[
        "mb-6 rounded-[var(--radius-card)] border px-4 py-3 text-[13px]",
        done ? "border-accent bg-accent-soft text-accent" : "border-line-strong bg-sunken text-ink-soft",
      ].join(" ")}
    >
      {done
        ? "결제가 완료됐습니다. 이번 달 크레딧이 지급됐습니다."
        : `결제를 마치지 못했습니다.${reason ? ` (${reason})` : ""}`}
    </div>
  );
}

export function PaymentResult() {
  return (
    <Suspense fallback={null}>
      <Result />
    </Suspense>
  );
}
