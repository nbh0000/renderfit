"use client";

import { useState } from "react";

/**
 * 생성에 쓰인 프롬프트 표시.
 *
 * 사용자가 직접 쓴 요청은 늘 보여 주고, 모델에 실제로 나간 전체 문장은 접어 둔다.
 * 전체 프롬프트는 스무 줄이 넘어 그대로 펼치면 결과물이 밀려나지만,
 * "왜 이렇게 나왔는지" 확인하려면 반드시 필요하다.
 */
export function PromptDetails({
  userRequest,
  fullPrompt,
  className = "",
}: {
  userRequest: string | null;
  fullPrompt?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);

  if (!userRequest && !fullPrompt) return null;

  return (
    <div className={`text-[12px] ${className}`}>
      {userRequest && (
        <p className="rounded-lg border border-line bg-sunken px-2.5 py-1.5 leading-relaxed text-ink-soft">
          <span className="mr-1.5 text-[11px] text-muted">직접 지시</span>
          {userRequest}
        </p>
      )}

      {fullPrompt && (
        <>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="mt-1 text-[11.5px] text-muted hover:text-ink"
          >
            {open ? "전체 프롬프트 접기" : "전체 프롬프트 보기"}
          </button>

          {open && (
            <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-surface px-2.5 py-2 text-[11px] leading-relaxed text-muted">
              {fullPrompt}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
