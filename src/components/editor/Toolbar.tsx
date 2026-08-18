"use client";

import Link from "next/link";
import { useState } from "react";
import { useEditorStore, type EditorTool, type ViewMode } from "@/lib/editor/store";
import { BRAND } from "@/config/brand";

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: "image", label: "Image" },
  { id: "2.5d", label: "2.5D" },
  { id: "3d", label: "3D" },
];

const TOOLS: { id: EditorTool; label: string; hint: string }[] = [
  { id: "select", label: "선택", hint: "V" },
  { id: "move", label: "이동", hint: "M" },
  { id: "rotate", label: "회전", hint: "R" },
  { id: "scale", label: "크기", hint: "S" },
];

export function Toolbar() {
  const projectId = useEditorStore((state) => state.projectId);
  const projectName = useEditorStore((state) => state.projectName);
  const viewMode = useEditorStore((state) => state.viewMode);
  const setViewMode = useEditorStore((state) => state.setViewMode);
  const tool = useEditorStore((state) => state.tool);
  const setTool = useEditorStore((state) => state.setTool);
  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);
  const undo = useEditorStore((state) => state.undo);
  const redo = useEditorStore((state) => state.redo);
  const saveVersion = useEditorStore((state) => state.saveVersion);
  const startJob = useEditorStore((state) => state.startJob);
  const busy = useEditorStore((state) => state.busy);

  const [exportOpen, setExportOpen] = useState(false);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
      <Link href="/dashboard" className="serif-display shrink-0 text-[15px]">
        {BRAND.name}
      </Link>
      <span className="max-w-[180px] truncate text-[13px] font-medium">{projectName}</span>

      <div className="mx-2 h-5 w-px bg-line" />

      <ToolbarButton disabled={!canUndo} onClick={() => void undo()} title="실행 취소 (Ctrl+Z)">
        ↶
      </ToolbarButton>
      <ToolbarButton disabled={!canRedo} onClick={() => void redo()} title="다시 실행 (Ctrl+Shift+Z)">
        ↷
      </ToolbarButton>

      <div className="mx-1 h-5 w-px bg-line" />

      <div className="flex gap-0.5">
        {TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTool(item.id)}
            title={`${item.label} (${item.hint})`}
            className={[
              "rounded-md px-2 py-1 text-[12px] transition-colors",
              tool === item.id ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink",
            ].join(" ")}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="mx-auto flex items-center gap-1 rounded-lg bg-sunken p-0.5">
        {VIEW_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => setViewMode(mode.id)}
            className={[
              "rounded-md px-3 py-1 text-[12px] transition-colors",
              viewMode === mode.id ? "bg-surface font-medium text-ink shadow-sm" : "text-muted",
            ].join(" ")}
          >
            {mode.label}
          </button>
        ))}
      </div>

      {busy && (
        <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
          {busy}
        </span>
      )}

      <ToolbarButton onClick={() => void saveVersion(`v${new Date().toLocaleTimeString("ko-KR")}`)}>
        저장
      </ToolbarButton>
      <ToolbarButton onClick={() => void startJob("/render/preview")}>미리보기</ToolbarButton>
      <ToolbarButton onClick={() => void startJob("/render/final")} primary>
        렌더
      </ToolbarButton>

      <div className="relative">
        <ToolbarButton onClick={() => setExportOpen((value) => !value)}>내보내기</ToolbarButton>
        {exportOpen && (
          <div
            className="absolute right-0 top-9 z-30 w-44 rounded-lg border border-line bg-surface p-1 shadow-lg"
            onMouseLeave={() => setExportOpen(false)}
          >
            <ExportItem href={`/api/projects/${projectId}/export?format=scene`}>Scene JSON</ExportItem>
            <ExportItem href={`/api/projects/${projectId}/export?format=project`}>
              Project JSON
            </ExportItem>
            <ExportItem href={`/api/projects/${projectId}/export?format=image`} newTab>
              이미지 (SVG)
            </ExportItem>
            <ExportPng />
          </div>
        )}
      </div>
    </header>
  );
}

function ToolbarButton({
  children,
  onClick,
  disabled,
  title,
  primary,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={[
        "rounded-md px-2.5 py-1 text-[12px] transition-colors disabled:opacity-35",
        primary
          ? "bg-accent text-white hover:bg-accent-hover"
          : "border border-line text-ink-soft hover:bg-sunken",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function ExportItem({
  href,
  children,
  newTab,
}: {
  href: string;
  children: React.ReactNode;
  newTab?: boolean;
}) {
  return (
    <a
      href={href}
      target={newTab ? "_blank" : undefined}
      rel="noreferrer"
      className="block rounded px-2 py-1.5 text-[12px] text-ink-soft hover:bg-sunken"
    >
      {children}
    </a>
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
