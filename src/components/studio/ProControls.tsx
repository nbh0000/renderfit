"use client";

import { useState } from "react";
import { RESOLUTIONS, planAllows, type PlanId, type ResolutionId } from "@/config/plans";
import { PlanBadge } from "@/components/ui/PlanBadge";
import type { MaterialSpec } from "@/lib/types";
import { MaskCanvas } from "./MaskCanvas";

interface Props {
  plan: PlanId;
  materials: MaterialSpec;
  onMaterialsChange: (materials: MaterialSpec) => void;
  resolution: ResolutionId;
  onResolutionChange: (id: ResolutionId) => void;
  onLocked: (message: string) => void;
  /** 마스킹 대상 원본 (업로드 전이면 null) */
  sourceUrl: string | null;
  onMaskChange: (mask: File | null) => void;
}

const MATERIAL_FIELDS: { key: keyof MaterialSpec; label: string; placeholder: string }[] = [
  { key: "floor", label: "바닥", placeholder: "예: 오크 헤링본 마루" },
  { key: "wall", label: "벽", placeholder: "예: 베이지 도장" },
  { key: "accent", label: "포인트", placeholder: "예: 블랙 스틸 파티션" },
];

export function ProControls({
  plan,
  materials,
  onMaterialsChange,
  resolution,
  onResolutionChange,
  onLocked,
  sourceUrl,
  onMaskChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const isPro = planAllows(plan, "pro");

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">프로 컨트롤</span>
          <PlanBadge plan="pro" />
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="space-y-5 border-t border-line px-4 py-4">
          {/* a. 보존 마스킹 */}
          <div>
            <p className="text-[13px] font-semibold">보존 마스킹</p>
            <p className="mt-0.5 text-[11.5px] text-muted">
              브러시로 칠한 영역은 변경하지 않습니다. 붙박이장, 조명, 타일처럼 이미 확정된 부분에 사용하세요.
            </p>
            <div className="mt-2">
              {!isPro ? (
                <button
                  type="button"
                  onClick={() => onLocked("보존 마스킹은 프로 플랜 전용입니다.")}
                  className="flex h-24 w-full items-center justify-center rounded-lg border border-dashed border-line-strong bg-sunken text-[12px] text-muted"
                >
                  프로 플랜에서 사용할 수 있습니다
                </button>
              ) : sourceUrl ? (
                <MaskCanvas imageUrl={sourceUrl} onMaskChange={onMaskChange} />
              ) : (
                <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-line-strong bg-sunken text-[12px] text-muted">
                  먼저 이미지를 올려 주세요
                </div>
              )}
            </div>
          </div>

          {/* b. 재질 지정 */}
          <div>
            <p className="text-[13px] font-semibold">재질 지정</p>
            <p className="mt-0.5 text-[11.5px] text-muted">
              입력한 마감재는 프롬프트에 그대로 반영됩니다.
            </p>
            <div className="mt-2 space-y-2">
              {MATERIAL_FIELDS.map((field) => (
                <label key={field.key} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-[12px] text-ink-soft">{field.label}</span>
                  <input
                    type="text"
                    value={materials[field.key]}
                    placeholder={field.placeholder}
                    disabled={!isPro}
                    onFocus={() => {
                      if (!isPro) onLocked("재질 지정은 프로 플랜 전용입니다.");
                    }}
                    onChange={(e) =>
                      onMaterialsChange({ ...materials, [field.key]: e.target.value })
                    }
                    className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-[13px] placeholder:text-muted/70 disabled:bg-sunken disabled:text-muted"
                  />
                </label>
              ))}
            </div>
          </div>

          {/* c. 해상도 */}
          <div>
            <p className="text-[13px] font-semibold">해상도</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {RESOLUTIONS.map((option) => {
                const locked = !planAllows(plan, option.requiredPlan);
                const active = resolution === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      if (locked) {
                        onLocked("고해상도 출력은 프로 플랜 전용입니다.");
                        return;
                      }
                      onResolutionChange(option.id);
                    }}
                    className={[
                      "rounded-lg border px-3 py-2 text-left text-[12.5px] transition-colors",
                      active ? "border-accent bg-accent-soft" : "border-line hover:bg-sunken",
                      locked ? "opacity-60" : "",
                    ].join(" ")}
                  >
                    <span className="block font-medium">{option.label}</span>
                    <span className="block text-[11px] text-muted">
                      1장당 {option.creditsPerImage}크레딧
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
