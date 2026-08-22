"use client";

import { MODES, type ModeId } from "@/config/modes";
import { planAllows, type PlanId } from "@/config/plans";
import { PlanBadge } from "@/components/ui/PlanBadge";

const ICONS: Record<ModeId, React.ReactNode> = {
  redesign: (
    <path d="M4 19h16M6 19V9l6-4 6 4v10M10 19v-5h4v5" strokeLinejoin="round" strokeLinecap="round" />
  ),
  "keep-style": (
    <path d="M12 4v3m0 10v3m8-8h-3M7 12H4m12.9-4.9l-2.1 2.1M9.2 14.8l-2.1 2.1m9.8 0l-2.1-2.1M9.2 9.2L7.1 7.1M14.5 12a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" strokeLinecap="round" />
  ),
  staging: (
    <path d="M4 17v-4a2 2 0 012-2h12a2 2 0 012 2v4M6 11V8a2 2 0 012-2h8a2 2 0 012 2v3M4 17h16M6 17v2m12-2v2" strokeLinecap="round" strokeLinejoin="round" />
  ),
  empty: (
    <path d="M4 20h16M6 20V8l6-4 6 4v12M9.5 12.5l5 5m0-5l-5 5" strokeLinecap="round" strokeLinejoin="round" />
  ),
};

interface Props {
  value: ModeId;
  onChange: (id: ModeId) => void;
  plan: PlanId;
  onLocked: (message: string) => void;
}

export function ModeSelector({ value, onChange, plan, onLocked }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {MODES.map((mode) => {
        const locked = !planAllows(plan, mode.requiredPlan);
        const active = value === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (locked) {
                onLocked(`${mode.label} 모드는 프로 플랜부터 사용할 수 있습니다.`);
                return;
              }
              onChange(mode.id);
            }}
            className={[
              "group relative flex h-full flex-col gap-1.5 rounded-[var(--radius-card)] border p-3 text-left transition-colors",
              active
                ? "border-accent bg-accent-soft"
                : "border-line bg-surface hover:border-line-strong hover:bg-sunken",
              locked ? "opacity-60" : "",
            ].join(" ")}
          >
            <span className="flex items-center justify-between">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke={active ? "var(--color-accent)" : "currentColor"}
                strokeWidth="1.5"
                className="text-ink-soft"
                aria-hidden
              >
                {ICONS[mode.id]}
              </svg>
              {mode.requiredPlan !== "free" && <PlanBadge plan={mode.requiredPlan} />}
            </span>
            <span className="text-[13px] font-semibold">{mode.label}</span>
            <span className="text-[11.5px] leading-snug text-muted">{mode.description}</span>
          </button>
        );
      })}
    </div>
  );
}
