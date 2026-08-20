"use client";

import type { PlanViewport } from "./usePlanViewport";

/**
 * 도면 눈금자.
 *
 * 확대 배율이 바뀌어도 "지금 화면의 1cm가 몇 mm인지"를 눈으로 확인할 수 있어야
 * 손으로 그은 벽의 길이를 감으로 잡을 수 있다. 배율에 따라 눈금 간격을 바꾼다.
 */

const SIZE = 22;

export function PlanRulers({
  view,
  width,
  length,
}: {
  view: PlanViewport;
  width: number;
  length: number;
}) {
  const rect = view.containerRef.current?.getBoundingClientRect();
  if (!rect) return null;

  const { scale } = view.viewport;
  const step = scale > 0.09 ? 500 : scale > 0.03 ? 1000 : 5000;

  const [left, top] = view.toPlan(rect.left, rect.top);
  const [right, bottom] = view.toPlan(rect.right, rect.bottom);

  const ticksX: React.ReactElement[] = [];
  for (let x = Math.floor(left / step) * step; x < right; x += step) {
    const [sx] = view.toScreen(x, 0);
    if (sx < SIZE) continue;
    ticksX.push(
      <g key={`x${x}`}>
        <line x1={sx} y1={SIZE - 6} x2={sx} y2={SIZE} stroke="#b9b6b0" strokeWidth={1} />
        <text x={sx + 2} y={SIZE - 8} fontSize={9} fill="#7b7d80" fontFamily="Pretendard, sans-serif">
          {x / 1000}m
        </text>
      </g>
    );
  }

  const ticksY: React.ReactElement[] = [];
  for (let y = Math.floor(bottom / step) * step; y < top; y += step) {
    const [, sy] = view.toScreen(0, y);
    if (sy < SIZE) continue;
    ticksY.push(
      <g key={`y${y}`}>
        <line x1={SIZE - 6} y1={sy} x2={SIZE} y2={sy} stroke="#b9b6b0" strokeWidth={1} />
        <text
          x={SIZE - 8}
          y={sy - 3}
          fontSize={9}
          fill="#7b7d80"
          textAnchor="middle"
          transform={`rotate(-90 ${SIZE - 8} ${sy - 3})`}
          fontFamily="Pretendard, sans-serif"
        >
          {y / 1000}m
        </text>
      </g>
    );
  }

  return (
    <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full">
      <rect x={0} y={0} width={rect.width} height={SIZE} fill="#fbfbfa" />
      <rect x={0} y={0} width={SIZE} height={rect.height} fill="#fbfbfa" />
      <line x1={0} y1={SIZE} x2={rect.width} y2={SIZE} stroke="#e6e5e2" strokeWidth={1} />
      <line x1={SIZE} y1={0} x2={SIZE} y2={rect.height} stroke="#e6e5e2" strokeWidth={1} />

      {ticksX}
      {ticksY}

      {/* 방 전체 크기 — 눈금자 모서리에 늘 띄워 둔다 */}
      <text x={4} y={13} fontSize={9} fill="#7b7d80" fontFamily="Pretendard, sans-serif">
        {Math.round(width / 100) / 10}×{Math.round(length / 100) / 10}m
      </text>
    </svg>
  );
}
