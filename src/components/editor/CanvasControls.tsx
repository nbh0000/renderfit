"use client";

import { useEditorStore, type PlanTool, type ViewMode } from "@/lib/editor/store";

/**
 * 캔버스 하단 컨트롤 바.
 *
 * 보기 전환과 확대는 캔버스를 보면서 조작하는 것이라 툴바 대신 캔버스 위에 둔다.
 */

/** 평면도에서 쓰는 그리기 도구 */
const PLAN_TOOLS: { id: PlanTool; label: string; hint: string }[] = [
  { id: "select", label: "선택", hint: "끌어서 이동 · 우클릭 드래그로 화면 이동" },
  { id: "wall", label: "벽", hint: "두 점을 찍어 벽을 긋습니다" },
  { id: "room", label: "실", hint: "모서리를 찍고 더블클릭으로 닫습니다" },
  { id: "dimension", label: "치수", hint: "두 점 사이 길이를 표기합니다" },
  { id: "text", label: "글자", hint: "도면에 문구를 넣습니다" },
  { id: "polyline", label: "선", hint: "여러 점을 찍고 더블클릭으로 끝냅니다" },
];

/** 격자 스냅 간격 (mm) */
const SNAP_STEPS = [0, 10, 50, 100, 500];

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: "image", label: "이미지" },
  { id: "plan", label: "평면도" },
  { id: "elevation", label: "측면도" },
  { id: "3d", label: "3D" },
  { id: "split", label: "평면+3D" },
];

export function CanvasControls() {
  const viewMode = useEditorStore((state) => state.viewMode);
  const setViewMode = useEditorStore((state) => state.setViewMode);
  const zoom = useEditorStore((state) => state.zoom);
  const setZoom = useEditorStore((state) => state.setZoom);
  const showGrid = useEditorStore((state) => state.showGrid);
  const toggleGrid = useEditorStore((state) => state.toggleGrid);
  const planTool = useEditorStore((state) => state.planTool);
  const setPlanTool = useEditorStore((state) => state.setPlanTool);
  const snapMm = useEditorStore((state) => state.snapMm);
  const setSnapMm = useEditorStore((state) => state.setSnapMm);

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex flex-wrap items-center gap-2">
      {/* 보기 전환 */}
      <div className="pointer-events-auto flex gap-0.5 rounded-lg border border-white/15 bg-[#0a0a0a]/85 p-0.5 backdrop-blur">
        {VIEW_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => setViewMode(mode.id)}
            className={[
              "rounded-md px-2.5 py-1 text-[11.5px] transition-colors",
              viewMode === mode.id ? "bg-white text-ink" : "text-white/70 hover:text-white",
            ].join(" ")}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {/* 그리기 도구 — 평면도에서만 의미가 있다 */}
      {(viewMode === "plan" || viewMode === "split") && (
        <>
          <div className="pointer-events-auto flex gap-0.5 rounded-lg border border-white/15 bg-[#0a0a0a]/85 p-0.5 backdrop-blur">
            {PLAN_TOOLS.map((item) => (
              <button
                key={item.id}
                type="button"
                title={item.hint}
                onClick={() => setPlanTool(item.id)}
                className={[
                  "rounded-md px-2.5 py-1 text-[11.5px] transition-colors",
                  planTool === item.id ? "bg-white text-ink" : "text-white/70 hover:text-white",
                ].join(" ")}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-white/15 bg-[#0a0a0a]/85 px-1.5 py-1 text-white/70 backdrop-blur">
            <span className="text-[11px]">스냅</span>
            <select
              value={snapMm}
              onChange={(event) => setSnapMm(Number(event.target.value))}
              className="bg-transparent text-[11.5px] text-white outline-none"
            >
              {SNAP_STEPS.map((step) => (
                <option key={step} value={step} className="text-ink">
                  {step === 0 ? "없음" : `${step}mm`}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {/* 확대 — 3D는 휠·드래그로 조작하므로 2D 도면에서만 노출 */}
      {viewMode !== "3d" && viewMode !== "split" && (
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-lg border border-white/15 bg-[#0a0a0a]/85 p-0.5 text-white/80 backdrop-blur">
          <button
            type="button"
            onClick={() => setZoom(zoom - 0.15)}
            aria-label="축소"
            className="h-6 w-7 rounded-md text-[14px] leading-none hover:bg-white/10"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="min-w-[46px] rounded-md px-1 text-[11.5px] tabular-nums hover:bg-white/10"
            title="100%로 되돌리기"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom(zoom + 0.15)}
            aria-label="확대"
            className="h-6 w-7 rounded-md text-[14px] leading-none hover:bg-white/10"
          >
            +
          </button>
        </div>
      )}

      {viewMode !== "3d" && (
        <button
          type="button"
          onClick={toggleGrid}
          className={[
            "pointer-events-auto rounded-lg border border-white/15 px-2.5 py-1.5 text-[11.5px] backdrop-blur transition-colors",
            showGrid ? "bg-white text-ink" : "bg-[#0a0a0a]/85 text-white/70 hover:text-white",
          ].join(" ")}
        >
          격자
        </button>
      )}
    </div>
  );
}
