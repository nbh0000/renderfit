"use client";

import { RESOLUTIONS, type ResolutionId } from "@/config/plans";

/**
 * 출력 해상도 선택.
 *
 * 예전에는 프로 컨트롤 안에 있어 프로 플랜만 쓸 수 있었다.
 * 해상도는 원가가 크레딧에 이미 반영돼 있어 플랜으로 막을 이유가 없다 —
 * 크레딧이 되면 누구나 고를 수 있게 밖으로 뺐다.
 */
export function ResolutionSelector({
  value,
  credits,
  onChange,
}: {
  value: ResolutionId;
  /** 남은 크레딧 — 한 장도 못 만드는 옵션은 눌러도 소용이 없어 알려 준다 */
  credits: number;
  onChange: (id: ResolutionId) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {RESOLUTIONS.map((option) => {
        const active = value === option.id;
        const affordable = credits >= option.creditsPerImage;

        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            className={[
              "rounded-lg border px-3 py-2 text-left transition-colors",
              active ? "border-accent bg-accent-soft" : "border-line hover:bg-sunken",
            ].join(" ")}
          >
            <span className="block text-[12.5px] font-medium">{option.label}</span>
            <span className="block text-[11px] text-muted">
              1장당 {option.creditsPerImage}크레딧
              {!affordable && <span className="text-danger"> · 크레딧 부족</span>}
            </span>
            <span className="mt-1 block text-[10.5px] leading-relaxed text-muted/80">
              {option.note}
            </span>
          </button>
        );
      })}
    </div>
  );
}
