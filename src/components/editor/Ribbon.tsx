"use client";

import Link from "next/link";
import { useState } from "react";
import { BRAND } from "@/config/brand";
import { useEditorStore, type PlanTool, type ViewMode } from "@/lib/editor/store";

/**
 * 리본 툴바.
 *
 * Sweet Home 3D처럼 기능을 묶고 묶음마다 이름을 단다.
 * 도면 편집기는 버튼이 수십 개라, 한 줄로 늘어놓으면 무엇이 어디 있는지 외워야 한다.
 * 파일 / 그리기 / 편집 / 보기 / 주석 / 렌더 여섯 묶음으로 나눈다.
 */

interface Action {
  label: string;
  hint?: string;
  onClick?: () => void;
  href?: string;
  active?: boolean;
  disabled?: boolean;
  primary?: boolean;
}

export function Ribbon() {
  const projectId = useEditorStore((state) => state.projectId);
  const projectName = useEditorStore((state) => state.projectName);

  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);

  const planTool = useEditorStore((state) => state.planTool);
  const setPlanTool = useEditorStore((state) => state.setPlanTool);
  const viewMode = useEditorStore((state) => state.viewMode);
  const setViewMode = useEditorStore((state) => state.setViewMode);

  const showGrid = useEditorStore((state) => state.showGrid);
  const toggleGrid = useEditorStore((state) => state.toggleGrid);
  const snapMm = useEditorStore((state) => state.snapMm);
  const setSnapMm = useEditorStore((state) => state.setSnapMm);

  const runTool = useEditorStore((state) => state.runTool);
  const saveVersion = useEditorStore((state) => state.saveVersion);
  const startJob = useEditorStore((state) => state.startJob);
  const busy = useEditorStore((state) => state.busy);

  const [exportOpen, setExportOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  /** 그리기 도구는 평면도가 보이는 모드에서만 의미가 있다 */
  const drawing = viewMode === "plan" || viewMode === "split";

  const draw = (id: PlanTool, label: string, hint: string): Action => ({
    label,
    hint,
    active: drawing && planTool === id,
    disabled: !drawing,
    onClick: () => setPlanTool(id),
  });

  const view = (id: ViewMode, label: string): Action => ({
    label,
    active: viewMode === id,
    onClick: () => setViewMode(id),
  });

  return (
    <header className="shrink-0 border-b border-line bg-surface">
      {/* 제목 줄 */}
      <div className="flex h-9 items-center gap-2 border-b border-line/70 px-3">
        <Link
          href="/dashboard"
          className="shrink-0 text-[12px] font-semibold tracking-[0.14em] text-ink hover:opacity-70"
        >
          {BRAND.wordmark}
        </Link>
        <span className="max-w-[240px] truncate text-[12.5px] font-medium">{projectName}</span>

        <div className="mx-auto" />

        {busy && (
          <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
            {busy}
          </span>
        )}

        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="rounded px-2 py-0.5 text-[11.5px] text-muted hover:bg-sunken hover:text-ink"
        >
          {collapsed ? "펼치기" : "접기"}
        </button>
      </div>

      {!collapsed && (
        <div className="flex items-stretch gap-0 overflow-x-auto px-2 py-1.5">
          <Group title="파일">
            <Button
              action={{
                label: "저장",
                onClick: () => void saveVersion(`v${new Date().toLocaleTimeString("ko-KR")}`),
              }}
            />
            <div className="relative">
              <Button
                action={{ label: "내보내기", onClick: () => setExportOpen((value) => !value) }}
              />
              {exportOpen && (
                <ExportMenu projectId={projectId} onClose={() => setExportOpen(false)} />
              )}
            </div>
          </Group>

          <Group title="그리기">
            <Button action={draw("wall", "벽", "두 점을 찍어 이어 그립니다")} />
            <Button action={draw("room", "실", "모서리를 찍고 더블클릭으로 닫습니다")} />
            <Button action={draw("polyline", "폴리라인", "여러 점을 찍고 더블클릭")} />
            <Button
              action={{
                label: "자동 배치",
                hint: "가구를 벽에 맞춰 겹치지 않게 정리합니다",
                onClick: () => void runTool("arrange_objects"),
              }}
            />
          </Group>

          <Group title="편집">
            <Button
              action={{ label: "↶", hint: "실행 취소 (Ctrl+Z)", disabled: !canUndo, onClick: () => void undo() }}
            />
            <Button
              action={{
                label: "↷",
                hint: "다시 실행 (Ctrl+Shift+Z)",
                disabled: !canRedo,
                onClick: () => void redo(),
              }}
            />
            <Button action={draw("select", "선택", "클릭·드래그로 고르고 옮깁니다")} />
          </Group>

          <Group title="주석">
            <Button action={draw("dimension", "치수선", "시작 → 끝 → 띄울 위치")} />
            <Button action={draw("text", "글자", "클릭한 자리에 문구")} />
          </Group>

          <Group title="보기">
            <Button action={view("image", "이미지")} />
            <Button action={view("plan", "평면도")} />
            <Button action={view("elevation", "측면도")} />
            <Button action={view("3d", "3D")} />
            <Button action={view("split", "평면+3D")} />
          </Group>

          <Group title="보조">
            <Button
              action={{ label: "격자", active: showGrid, onClick: toggleGrid }}
            />
            <label className="flex items-center gap-1 rounded border border-line px-1.5 py-1 text-[11px] text-muted">
              스냅
              <select
                value={snapMm}
                onChange={(event) => setSnapMm(Number(event.target.value))}
                className="bg-transparent text-[11px] text-ink outline-none"
              >
                {[0, 10, 50, 100, 500].map((step) => (
                  <option key={step} value={step}>
                    {step === 0 ? "없음" : `${step}mm`}
                  </option>
                ))}
              </select>
            </label>
          </Group>

          <Group title="렌더" last>
            <Button action={{ label: "미리보기", onClick: () => void startJob("/render/preview") }} />
            <Button
              action={{ label: "렌더", primary: true, onClick: () => void startJob("/render/final") }}
            />
          </Group>
        </div>
      )}
    </header>
  );
}

/** 기능 묶음 — 아래에 묶음 이름을 단다 */
function Group({
  title,
  children,
  last,
}: {
  title: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={[
        "flex shrink-0 flex-col items-center gap-1 px-2.5",
        last ? "" : "border-r border-line/70",
      ].join(" ")}
    >
      <div className="flex items-center gap-1">{children}</div>
      <span className="text-[9.5px] uppercase tracking-[0.1em] text-muted">{title}</span>
    </div>
  );
}

function Button({ action }: { action: Action }) {
  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={action.disabled}
      title={action.hint ? `${action.label} — ${action.hint}` : action.label}
      className={[
        "h-7 rounded-md px-2.5 text-[12px] transition-colors disabled:opacity-30",
        action.primary
          ? "bg-accent font-medium text-white hover:bg-accent-hover"
          : action.active
            ? "bg-accent-soft font-medium text-accent"
            : "border border-line text-ink-soft hover:bg-sunken",
      ].join(" ")}
    >
      {action.label}
    </button>
  );
}

function ExportMenu({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const item = (href: string, label: string, newTab?: boolean) => (
    <a
      key={href}
      href={href}
      target={newTab ? "_blank" : undefined}
      rel="noreferrer"
      className="block rounded px-2 py-1.5 text-[12px] text-ink-soft hover:bg-sunken"
    >
      {label}
    </a>
  );

  return (
    <div
      className="absolute left-0 top-9 z-30 w-48 rounded-lg border border-line bg-surface p-1 shadow-lg"
      onMouseLeave={onClose}
    >
      <p className="px-2 pb-1 pt-1.5 text-[10.5px] font-medium text-muted">도면 · CAD</p>
      {item(`/api/projects/${projectId}/export?format=dxf`, "평면도 (DXF · mm)")}
      {item(`/api/projects/${projectId}/export?format=plan`, "치수 평면도 (SVG)", true)}
      {item(`/api/projects/${projectId}/export?format=elevation`, "입면도 (SVG)", true)}

      <ExportGlb />

      <p className="px-2 pb-1 pt-2 text-[10.5px] font-medium text-muted">이미지 · 데이터</p>
      <ExportPng />
      {item(`/api/projects/${projectId}/export?format=image`, "장면 이미지 (SVG)", true)}
      {item(`/api/projects/${projectId}/export?format=scene`, "Scene JSON")}
      {item(`/api/projects/${projectId}/export?format=project`, "Project JSON")}
    </div>
  );
}

/** 3D 씬을 GLB로 내보낸다 (SketchUp·Blender·3ds Max에서 열 수 있다) */
function ExportGlb() {
  const viewportExport = useEditorStore((state) => state.viewportExport);
  const viewMode = useEditorStore((state) => state.viewMode);
  const projectName = useEditorStore((state) => state.projectName);
  const setMessage = useEditorStore((state) => state.setMessage);

  const download = async () => {
    if (!viewportExport) {
      setMessage("3D 뷰를 먼저 연 뒤 내보내 주세요.");
      return;
    }
    try {
      const blob = await viewportExport();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${projectName || "scene"}.glb`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch {
      setMessage("GLB로 내보내지 못했습니다.");
    }
  };

  return (
    <button
      type="button"
      onClick={() => void download()}
      title={viewMode === "3d" ? "" : "3D 뷰에서 사용할 수 있습니다"}
      className="block w-full rounded px-2 py-1.5 text-left text-[12px] text-ink-soft hover:bg-sunken disabled:opacity-40"
      disabled={!viewportExport}
    >
      3D 모델 (GLB)
    </button>
  );
}

/** SVG 장면을 canvas로 래스터화해서 PNG로 내려받는다 */
function ExportPng() {
  const projectId = useEditorStore((state) => state.projectId);
  const setMessage = useEditorStore((state) => state.setMessage);

  const download = async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/export?format=image`);
      const svg = await response.text();
      const blob = new Blob([svg], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);

      const image = new Image();
      image.crossOrigin = "anonymous";
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || 1280;
      canvas.height = image.naturalHeight || 960;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas 사용 불가");
      ctx.drawImage(image, 0, 0);
      URL.revokeObjectURL(url);

      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return;
        const link = document.createElement("a");
        link.href = URL.createObjectURL(pngBlob);
        link.download = "scene.png";
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      }, "image/png");
    } catch {
      setMessage("PNG로 내보내지 못했습니다.");
    }
  };

  return (
    <button
      type="button"
      onClick={() => void download()}
      className="block w-full rounded px-2 py-1.5 text-left text-[12px] text-ink-soft hover:bg-sunken"
    >
      이미지 (PNG)
    </button>
  );
}
