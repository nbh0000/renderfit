"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * 3D 네비게이션 기즈모.
 *
 * Sweet Home 3D 좌하단의 십자 컨트롤과 같은 역할이다.
 * 마우스 드래그만으로 시점을 돌리는 건 손에 익어야 하고, 노트북 트랙패드에서는
 * 특히 불편하다. 누르고 있으면 계속 도는 방향 버튼을 둔다.
 *
 * OrbitControls를 직접 건드리지 않고 부모가 넘긴 콜백만 호출한다 —
 * 3D 상태는 Canvas 안에 있고 이 컴포넌트는 그 바깥(HTML)에 있기 때문이다.
 */

export interface GizmoHandlers {
  /** 좌우 회전 (라디안, 양수 = 오른쪽) */
  orbit: (dTheta: number, dPhi: number) => void;
  /** 확대·축소 (양수 = 가까이) */
  dolly: (delta: number) => void;
  /** 처음 각도로 되돌린다 */
  reset: () => void;
}

const STEP = 0.06;
const REPEAT_MS = 40;

export function NavGizmo({ handlers }: { handlers: GizmoHandlers | null }) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }, []);

  /** 누르고 있는 동안 반복 실행한다 — 한 번 누를 때마다 조금씩 도는 건 답답하다 */
  const hold = useCallback(
    (action: () => void) => {
      stop();
      action();
      timer.current = setInterval(action, REPEAT_MS);
    },
    [stop]
  );

  useEffect(() => stop, [stop]);

  if (!handlers) return null;

  const pad = (
    label: string,
    aria: string,
    action: () => void,
    className: string
  ) => (
    <button
      type="button"
      aria-label={aria}
      onPointerDown={() => hold(action)}
      onPointerUp={stop}
      onPointerLeave={stop}
      className={[
        "absolute grid h-6 w-6 place-items-center text-[11px] leading-none text-ink-soft transition-colors hover:bg-sunken hover:text-ink",
        className,
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-20 flex items-end gap-1.5">
      {/* 십자 방향 패드 */}
      <div className="relative h-[76px] w-[76px] rounded-full border border-line bg-surface/95 shadow-sm backdrop-blur">
        {pad("▲", "위에서 보기", () => handlers.orbit(0, -STEP), "left-1/2 top-1 -translate-x-1/2")}
        {pad("▼", "아래에서 보기", () => handlers.orbit(0, STEP), "bottom-1 left-1/2 -translate-x-1/2")}
        {pad("◀", "왼쪽으로 돌리기", () => handlers.orbit(-STEP, 0), "left-1 top-1/2 -translate-y-1/2")}
        {pad("▶", "오른쪽으로 돌리기", () => handlers.orbit(STEP, 0), "right-1 top-1/2 -translate-y-1/2")}

        <button
          type="button"
          onClick={handlers.reset}
          title="처음 시점으로"
          className="absolute left-1/2 top-1/2 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line text-[9px] text-muted hover:bg-sunken hover:text-ink"
        >
          ⌂
        </button>
      </div>

      {/* 확대·축소 */}
      <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface/95 shadow-sm backdrop-blur">
        <button
          type="button"
          aria-label="확대"
          onPointerDown={() => hold(() => handlers.dolly(0.12))}
          onPointerUp={stop}
          onPointerLeave={stop}
          className="h-6 w-7 text-[13px] leading-none text-ink-soft hover:bg-sunken"
        >
          +
        </button>
        <button
          type="button"
          aria-label="축소"
          onPointerDown={() => hold(() => handlers.dolly(-0.12))}
          onPointerUp={stop}
          onPointerLeave={stop}
          className="h-6 w-7 border-t border-line text-[13px] leading-none text-ink-soft hover:bg-sunken"
        >
          −
        </button>
      </div>
    </div>
  );
}
