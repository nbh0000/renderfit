"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MODES } from "@/config/modes";

/**
 * 메인 진입 모달.
 *
 * 메인 페이지에서는 설명을 늘어놓지 않고, 무엇으로 시작할지만 고르게 한 뒤
 * 곧바로 빠른 생성(/studio)으로 넘긴다. 상세 편집은 스튜디오(편집기)에서 한다.
 */

/** 모달에 노출할 시작점 — 자주 쓰는 순서 */
const QUICK_MODES = ["redesign", "staging", "sketch2render", "plan2render"] as const;

const INPUT_HINT: Record<string, string> = {
  photo: "방 사진 한 장",
  sketch: "손스케치 한 장",
  floorplan: "평면도 한 장",
};

export function QuickStartModal({
  label = "시작하기",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // 고른 즉시 넘어가도록 스튜디오 화면을 미리 받아 둔다.
  useEffect(() => {
    if (open) router.prefetch("/studio");
  }, [open, router]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const entries = QUICK_MODES.map((id) => MODES.find((mode) => mode.id === id)).filter(
    (mode): mode is (typeof MODES)[number] => Boolean(mode)
  );

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="무엇으로 시작할까요?"
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#1b1a18]/55 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[420px] rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[0_24px_60px_rgba(0,0,0,0.25)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[16px] font-semibold tracking-tight">무엇으로 시작할까요?</h2>
                <p className="mt-1 text-[12.5px] text-muted">
                  고르면 바로 빠른 생성으로 넘어갑니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="닫기"
                className="-mr-1 -mt-1 rounded-md px-2 py-1 text-[16px] leading-none text-muted hover:bg-sunken hover:text-ink"
              >
                ×
              </button>
            </div>

            <ul className="mt-4 space-y-1.5">
              {entries.map((mode) => (
                <li key={mode.id}>
                  <button
                    type="button"
                    onClick={() => router.push(`/studio?mode=${mode.id}`)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-sunken"
                  >
                    <span>
                      <span className="text-[14px] font-medium">{mode.label}</span>
                      <span className="mt-0.5 block text-[12px] leading-snug text-muted">
                        {INPUT_HINT[mode.inputType] ?? "이미지 한 장"}
                      </span>
                    </span>
                    {mode.requiredPlan === "pro" && (
                      <span className="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-medium text-accent">
                        프로
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>

            <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
              생성물은 참고용 시안이며 시공용 도면이 아닙니다.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
