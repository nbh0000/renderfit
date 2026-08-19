"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * 메인 진입 모달.
 *
 * 첫 화면에서 고를 것은 하나뿐이다 — 사진으로 빠르게 볼 것인가(일반),
 * 실측 도면과 3D로 작업할 것인가(전문가). 고르면 바로 해당 화면으로 넘어간다.
 */

interface Track {
  id: "quick" | "pro";
  badge: string;
  title: string;
  points: string[];
  href: string;
}

const TRACKS: Track[] = [
  {
    id: "quick",
    badge: "일반",
    title: "사진으로 시안 만들기",
    points: [
      "방 사진 한 장이면 시작",
      "평수·치수를 넣으면 크기에 맞춰 생성",
      "스타일 16종 · 한 번에 4장",
    ],
    href: "/studio",
  },
  {
    id: "pro",
    badge: "전문가",
    title: "실측 도면·3D로 작업하기",
    points: [
      "실측 치수·벽·문·창 직접 편집",
      "3D에서 가구를 끌어다 배치",
      "DXF·평면도·GLB로 내보내기",
    ],
    href: "/dashboard",
  },
];

export function QuickStartModal({
  label = "시작하기",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    for (const track of TRACKS) router.prefetch(track.href);

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, router]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="어떤 방식으로 시작할까요?"
          className="fixed inset-0 z-50 flex items-end justify-center bg-[#0a0a0a]/55 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[680px] rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[0_24px_60px_rgba(0,0,0,0.25)] sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[17px] font-semibold tracking-tight">
                  어떤 방식으로 시작할까요?
                </h2>
                <p className="mt-1 text-[12.5px] text-muted">
                  나중에 상단 메뉴에서 언제든 바꿀 수 있습니다.
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

            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              {TRACKS.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => router.push(track.href)}
                  className="group flex flex-col rounded-xl border border-line p-4 text-left transition-colors hover:border-accent hover:bg-accent-soft/40"
                >
                  <span
                    className={[
                      "w-fit rounded-full px-2 py-0.5 text-[11px] font-medium",
                      track.id === "pro" ? "bg-ink text-canvas" : "bg-accent-soft text-accent",
                    ].join(" ")}
                  >
                    {track.badge}
                  </span>

                  <span className="mt-2.5 text-[15px] font-semibold tracking-tight">
                    {track.title}
                  </span>

                  <ul className="mt-2 space-y-1">
                    {track.points.map((point) => (
                      <li
                        key={point}
                        className="flex gap-1.5 text-[12.5px] leading-snug text-muted"
                      >
                        <span aria-hidden className="text-accent">
                          ✓
                        </span>
                        {point}
                      </li>
                    ))}
                  </ul>

                  <span className="mt-3 text-[12.5px] text-accent group-hover:underline">
                    시작하기 →
                  </span>
                </button>
              ))}
            </div>

            <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
              생성물은 참고용 시안이며 시공용 도면이 아닙니다.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
