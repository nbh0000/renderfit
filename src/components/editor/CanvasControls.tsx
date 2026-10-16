"use client";

import { useEditorStore } from "@/lib/editor/store";

/**
 * 캔버스 하단 컨트롤.
 *
 * 보기 전환·그리기 도구·격자·스냅은 전부 리본 툴바로 올렸다.
 * 여기에는 캔버스를 보면서 손이 자주 가는 확대만 남긴다 —
 * 같은 기능을 두 곳에 두면 어느 쪽이 진짜인지 헷갈린다.
 */
export function CanvasControls() {
  const viewMode = useEditorStore((state) => state.viewMode);
  const zoom = useEditorStore((state) => state.zoom);
  const setZoom = useEditorStore((state) => state.setZoom);
  const fitView = useEditorStore((state) => state.fitView);

  // 평면도는 자체 확대(휠·화면에 맞추기)를 쓰고, 3D는 휠·드래그로 조작한다.
  if (viewMode !== "image" && viewMode !== "elevation") return null;

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex items-center gap-2">
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-line bg-surface/95 p-0.5 text-ink-soft shadow-sm backdrop-blur">
        <button
          type="button"
          onClick={() => setZoom(zoom - 0.15)}
          aria-label="축소"
          className="h-6 w-7 rounded-md text-[14px] leading-none hover:bg-sunken"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => setZoom(1)}
          className="min-w-[46px] rounded-md px-1 text-[11.5px] tabular-nums hover:bg-sunken"
          title="100%로 되돌리기"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={() => setZoom(zoom + 0.15)}
          aria-label="확대"
          className="h-6 w-7 rounded-md text-[14px] leading-none hover:bg-sunken"
        >
          +
        </button>
      </div>

      {/*
        화면에 맞추기.

        열 때 자동으로 줄이지 않는 대신 여기 둔다 — 큰 도면을 한눈에 보고 싶을 때
        한 번 누르면 되고, 무엇보다 지금 보는 배율이 우리가 정한 것이 아니라
        사용자가 누른 결과라는 것이 분명해진다.
      */}
      {fitView && (
        <button
          type="button"
          onClick={fitView}
          className="pointer-events-auto rounded-lg border border-line bg-surface/95 px-2 py-1 text-[11.5px] text-ink-soft shadow-sm backdrop-blur hover:bg-sunken"
        >
          화면에 맞추기
        </button>
      )}
    </div>
  );
}
