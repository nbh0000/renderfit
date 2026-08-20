"use client";

import { useCallback, useMemo, useRef, useState } from "react";

/**
 * 평면도 뷰포트 — 화면 픽셀과 도면 좌표(mm) 사이를 오간다.
 *
 * 도면 작업은 "지금 몇 mm를 그리고 있는가"가 늘 보여야 해서, 화면 좌표를 직접
 * 다루지 않고 이 훅을 통해서만 변환한다. 확대·이동이 바뀌어도 그리기 로직은
 * mm 좌표만 알면 된다.
 */

export interface Viewport {
  /** 1mm가 화면에서 차지하는 px */
  scale: number;
  /** 도면 원점의 화면상 위치 (px) */
  offsetX: number;
  offsetY: number;
}

export interface PlanViewport {
  viewport: Viewport;
  /** 도면 좌표(mm) → 화면 좌표(px) */
  toScreen: (x: number, y: number) => [number, number];
  /** 화면 좌표(px) → 도면 좌표(mm) */
  toPlan: (clientX: number, clientY: number) => [number, number];
  zoomAt: (clientX: number, clientY: number, factor: number) => void;
  panBy: (dxPx: number, dyPx: number) => void;
  /** 방 전체가 보이도록 맞춘다 */
  fit: (widthMm: number, lengthMm: number) => void;
  setZoom: (scale: number) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}

const MIN_SCALE = 0.008;
const MAX_SCALE = 0.6;

export function usePlanViewport(): PlanViewport {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ scale: 0.06, offsetX: 80, offsetY: 80 });

  const toScreen = useCallback(
    (x: number, y: number): [number, number] => [
      viewport.offsetX + x * viewport.scale,
      // 도면은 y가 위로 증가하고 화면은 아래로 증가한다.
      viewport.offsetY - y * viewport.scale,
    ],
    [viewport]
  );

  const toPlan = useCallback(
    (clientX: number, clientY: number): [number, number] => {
      const rect = containerRef.current?.getBoundingClientRect();
      const px = clientX - (rect?.left ?? 0);
      const py = clientY - (rect?.top ?? 0);
      return [(px - viewport.offsetX) / viewport.scale, (viewport.offsetY - py) / viewport.scale];
    },
    [viewport]
  );

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    setViewport((current) => {
      const rect = containerRef.current?.getBoundingClientRect();
      const px = clientX - (rect?.left ?? 0);
      const py = clientY - (rect?.top ?? 0);

      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, current.scale * factor));
      if (next === current.scale) return current;

      // 커서 아래의 도면 좌표가 제자리에 남도록 오프셋을 보정한다.
      const planX = (px - current.offsetX) / current.scale;
      const planY = (current.offsetY - py) / current.scale;

      return {
        scale: next,
        offsetX: px - planX * next,
        offsetY: py + planY * next,
      };
    });
  }, []);

  const panBy = useCallback((dxPx: number, dyPx: number) => {
    setViewport((current) => ({
      ...current,
      offsetX: current.offsetX + dxPx,
      offsetY: current.offsetY + dyPx,
    }));
  }, []);

  const fit = useCallback((widthMm: number, lengthMm: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || widthMm <= 0 || lengthMm <= 0) return;

    const padding = 90;
    const scale = Math.min(
      (rect.width - padding * 2) / widthMm,
      (rect.height - padding * 2) / lengthMm
    );
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

    setViewport({
      scale: clamped,
      offsetX: (rect.width - widthMm * clamped) / 2,
      offsetY: (rect.height + lengthMm * clamped) / 2,
    });
  }, []);

  const setZoom = useCallback((scale: number) => {
    setViewport((current) => ({
      ...current,
      scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)),
    }));
  }, []);

  return useMemo(
    () => ({ viewport, toScreen, toPlan, zoomAt, panBy, fit, setZoom, containerRef }),
    [viewport, toScreen, toPlan, zoomAt, panBy, fit, setZoom]
  );
}

/** 격자에 맞춰 좌표를 떨어뜨린다 (snap이 0이면 그대로) */
export function snapPoint(point: [number, number], snap: number): [number, number] {
  if (snap <= 0) return point;
  return [Math.round(point[0] / snap) * snap, Math.round(point[1] / snap) * snap];
}

/**
 * 직교 보정 — 시작점에서 거의 수평·수직이면 정확히 맞춘다.
 * 손으로 그은 벽이 0.4도씩 기울어 있으면 도면으로 쓸 수 없다.
 */
export function orthogonalize(
  from: [number, number],
  to: [number, number],
  toleranceDeg = 8
): [number, number] {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (dx === 0 && dy === 0) return to;

  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const nearest = Math.round(angle / 90) * 90;
  if (Math.abs(angle - nearest) > toleranceDeg) return to;

  const length = Math.hypot(dx, dy);
  const rad = (nearest * Math.PI) / 180;
  return [from[0] + Math.cos(rad) * length, from[1] + Math.sin(rad) * length];
}
