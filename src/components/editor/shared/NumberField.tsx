"use client";

import { useEffect, useState } from "react";

/**
 * 숫자 입력 — 타이핑 중에는 로컬 draft만 바꾸고,
 * blur/Enter로 확정될 때만 onCommit을 호출한다.
 * (한 글자마다 Scene operation이 쌓여 undo 히스토리가 오염되는 것을 막는다)
 */
export function NumberField({
  label,
  value,
  unit,
  min = 1,
  onCommit,
}: {
  label: string;
  value: number;
  unit?: string;
  /** 허용 최소값 — 좌표처럼 0이 정상인 값은 0을 넘긴다 */
  min?: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(Math.round(value)));

  useEffect(() => {
    setDraft(String(Math.round(value)));
  }, [value]);

  const commit = () => {
    const next = Number(draft);
    if (!Number.isFinite(next) || next < min) {
      setDraft(String(Math.round(value)));
      return;
    }
    if (next !== Math.round(value)) onCommit(next);
  };

  return (
    <label className="flex items-center gap-1.5">
      <span className="w-8 shrink-0 text-[10.5px] text-muted">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(String(Math.round(value)));
            event.currentTarget.blur();
          }
        }}
        className="h-7 w-full rounded border border-line bg-surface px-1.5 text-right text-[11px] tabular-nums"
      />
      {unit && <span className="shrink-0 text-[10px] text-muted">{unit}</span>}
    </label>
  );
}
