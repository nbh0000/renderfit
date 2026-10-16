"use client";

import Link from "next/link";
import { useState } from "react";
import { BRAND } from "@/config/brand";
import { ELECTRICAL_SPECS } from "@/config/electrical";
import type { ElectricalKind } from "@/scene/types";
import { useEditorStore, type PlanTool } from "@/lib/editor/store";
import { Icon, type IconName } from "./icons";

/**
 * 리본 툴바.
 *
 * Sweet Home 3D처럼 기능을 묶고 묶음마다 이름을 단다.
 * 도면 편집기는 버튼이 수십 개라, 한 줄로 늘어놓으면 무엇이 어디 있는지 외워야 한다.
 * 파일 / 그리기 / 편집 / 주석 / 보조 / 렌더로 나눈다.
 *
 * "보기"(이미지·평면도·3D…)는 여기 두지 않는다. 그리기 도구가 아니라 "지금 무엇을
 * 보고 있는가"이고 가장 자주 누르는 버튼이라, 캔버스 바로 위 띠로 내렸다 —
 * 도면에서 눈을 떼고 화면 꼭대기까지 올라갔다 오지 않아도 된다. ViewSwitch 참고.
 */

interface Action {
  label: string;
  icon?: IconName;
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

  const showGrid = useEditorStore((state) => state.showGrid);
  const toggleGrid = useEditorStore((state) => state.toggleGrid);
  const snapMm = useEditorStore((state) => state.snapMm);
  const setSnapMm = useEditorStore((state) => state.setSnapMm);

  const runTool = useEditorStore((state) => state.runTool);
  const saveVersion = useEditorStore((state) => state.saveVersion);
  const startJob = useEditorStore((state) => state.startJob);
  const busy = useEditorStore((state) => state.busy);

  const setImportOpen = useEditorStore((state) => state.setImportOpen);

  const [exportOpen, setExportOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  /** 그리기 도구는 평면도가 보이는 모드에서만 의미가 있다 */
  const drawing = viewMode === "plan" || viewMode === "split";

  /*
   * 걷는 중에는 장면을 고치는 버튼을 전부 잠근다.
   *
   * 눈높이에서 돌아다니는 중에 자동 배치가 돌면 발밑이 통째로 바뀐다. 되돌리기는
   * 남겨 둔다 — 걷기 전에 한 일을 무를 수 있어야 한다.
   */
  const walking = viewMode === "walk";

  const draw = (id: PlanTool, label: string, icon: IconName, hint: string): Action => ({
    label,
    icon,
    hint,
    active: drawing && planTool === id,
    disabled: !drawing,
    onClick: () => setPlanTool(id),
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
            {/*
              들여오기는 언제든 열린다.

              예전에는 도면·사진을 넣는 길이 새 프로젝트 시작 화면에만 있었다. 그런데
              빈 프로젝트에도 기본 벽 넉 장이 서 있어 그 화면이 아예 뜨지 않았고,
              캔버스는 "방 사진을 업로드하면 여기에 표시됩니다" 라고만 적혀 있을 뿐
              올릴 방법이 없었다. 이미 만들어 둔 프로젝트에 나중에 사진을 붙이는 일도
              여기서 한다.
            */}
            <Button
              action={{
                label: "가져오기",
                icon: "image",
                hint: "도면 파일(DXF·DWG·이미지·PDF) 또는 방 사진을 넣습니다",
                onClick: () => setImportOpen(true),
              }}
            />
            <Button
              action={{
                label: "저장",
                icon: "save",
                onClick: () => void saveVersion(`v${new Date().toLocaleTimeString("ko-KR")}`),
              }}
            />
            <div className="relative">
              <Button
                action={{ label: "내보내기", icon: "export", onClick: () => setExportOpen((value) => !value) }}
              />
              {exportOpen && (
                <ExportMenu projectId={projectId} onClose={() => setExportOpen(false)} />
              )}
            </div>
          </Group>

          <Group title="그리기">
            <Button action={draw("wall", "벽", "wall", "두 점을 찍어 이어 그립니다")} />
            <Button action={draw("room", "실", "room", "모서리를 찍고 더블클릭으로 닫습니다")} />
            <Button action={draw("polyline", "폴리라인", "polyline", "여러 점을 찍고 더블클릭")} />
            <Button
              action={{
                label: "자동 배치",
                icon: "arrange",
                hint: "가구를 벽에 맞춰 겹치지 않게 정리합니다",
                disabled: walking,
                onClick: () => void runTool("arrange_objects"),
              }}
            />
          </Group>

          <Group title="편집">
            <Button
              action={{ label: "취소", icon: "undo", hint: "실행 취소 (Ctrl+Z)", disabled: !canUndo, onClick: () => void undo() }}
            />
            <Button
              action={{
                label: "다시",
                icon: "redo",
                hint: "다시 실행 (Ctrl+Shift+Z)",
                disabled: !canRedo,
                onClick: () => void redo(),
              }}
            />
            <Button action={draw("select", "선택", "select", "클릭·드래그로 고르고 옮깁니다")} />
          </Group>

          <Group title="전기">
            <ElectricalPicker />
            <Button
              action={draw("circuit", "배선", "circuit", "스위치를 찍고 조명을 찍으면 이어집니다")}
            />
          </Group>

          <Group title="주석">
            <Button action={draw("dimension", "치수선", "dimension", "시작 → 끝 → 띄울 위치")} />
            <Button action={draw("text", "글자", "text", "클릭한 자리에 문구")} />
          </Group>

          <Group title="보조">
            <Button
              action={{ label: "격자", icon: "grid", active: showGrid, onClick: toggleGrid }}
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

          {drawing && <UnderlayGroup />}

          <Group title="렌더" last>
            <Button action={{ label: "미리보기", icon: "preview", onClick: () => void startJob("/render/preview") }} />
            <Button
              action={{ label: "렌더", icon: "render", primary: true, onClick: () => void startJob("/render/final") }}
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

/**
 * 밑그림 묶음 — 도면을 올린 프로젝트에서만 보인다.
 *
 * 사진 프로젝트에는 아예 그리지 않는다. 사진을 평면 뒤에 겹쳐 봐야 맞출 선이 없어서,
 * 버튼만 있고 눌러도 쓸모없는 상태가 된다. 쓸 수 없는 버튼은 없는 편이 낫다.
 */
function UnderlayGroup() {
  const source = useEditorStore((state) => state.scene?.source);
  const underlay = useEditorStore((state) => state.scene?.room?.underlay ?? null);
  const toggleUnderlay = useEditorStore((state) => state.toggleUnderlay);
  const runTool = useEditorStore((state) => state.runTool);
  const setCalibrating = useEditorStore((state) => state.setUnderlayCalibrating);
  const [open, setOpen] = useState(false);

  if (source?.kind !== "floorplan" || !source.imageUrl) return null;

  const on = Boolean(underlay?.visible);
  const patch = (values: Record<string, unknown>) => void runTool("set_underlay", values);

  return (
    <Group title="밑그림">
      <div className="relative">
        <Button
          action={{
            label: "밑그림",
            icon: "image",
            hint: "원본 도면을 평면 뒤에 깝니다 (B)",
            active: on,
            onClick: () => void toggleUnderlay(),
          }}
        />

        {on && underlay && (
          <>
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              className="ml-1 h-7 rounded-md border border-line px-1.5 text-[11px] text-ink-soft hover:bg-sunken"
              title="밑그림 설정"
            >
              ⋯
            </button>

            {open && (
              <div
                className="absolute left-0 top-9 z-30 w-56 rounded-lg border border-line bg-surface p-2.5 shadow-lg"
                onMouseLeave={() => setOpen(false)}
              >
                <label className="block text-[11px] text-muted">
                  투명도 {Math.round(underlay.opacity * 100)}%
                  <input
                    type="range"
                    min={10}
                    max={80}
                    value={Math.round(underlay.opacity * 100)}
                    onChange={(event) => patch({ opacity: Number(event.target.value) / 100 })}
                    className="mt-1 w-full accent-[var(--accent)]"
                  />
                </label>

                <div className="mt-2 flex flex-wrap gap-1">
                  <PopButton
                    label={underlay.locked ? "잠금 해제" : "잠금"}
                    active={underlay.locked}
                    onClick={() => patch({ locked: !underlay.locked })}
                  />
                  <PopButton
                    label="축척 맞추기"
                    onClick={() => {
                      setCalibrating(true);
                      setOpen(false);
                    }}
                  />
                  <PopButton
                    label="위치 맞추기"
                    onClick={() => {
                      patch({ locked: false });
                      setOpen(false);
                    }}
                  />
                </div>

                <div className="mt-2 flex items-center gap-1">
                  <span className="text-[11px] text-muted">기울기</span>
                  <PopButton
                    label="−0.5°"
                    onClick={() => patch({ rotation: underlay.rotation - Math.PI / 360 })}
                  />
                  <PopButton
                    label="+0.5°"
                    onClick={() => patch({ rotation: underlay.rotation + Math.PI / 360 })}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => {
                    void runTool("set_underlay", { remove: true });
                    setOpen(false);
                  }}
                  className="mt-2 w-full rounded border border-line px-2 py-1 text-[11px] text-ink-soft hover:bg-sunken"
                >
                  초기화 (다시 깔기)
                </button>

                <p className="mt-2 text-[10.5px] leading-relaxed text-muted">
                  잠금을 풀면 빈 곳을 끌어 밑그림을 옮길 수 있습니다. 벽 위에서는 벽이 잡힙니다.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </Group>
  );
}

function PopButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded border px-1.5 py-1 text-[11px] transition-colors",
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-line text-ink-soft hover:bg-sunken",
      ].join(" ")}
    >
      {label}
    </button>
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
        "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] transition-colors disabled:opacity-30",
        action.primary
          ? "bg-accent font-medium text-white hover:bg-accent-hover"
          : action.active
            ? "bg-accent-soft font-medium text-accent"
            : "border border-line text-ink-soft hover:bg-sunken",
      ].join(" ")}
    >
      {action.icon && <Icon name={action.icon} />}
      {action.label}
    </button>
  );
}

function ExportMenu({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  /*
   * DXF는 실측을 확정해야 열린다.
   * 서버도 막지만, 눌러 본 뒤에 거절당하는 것보다 왜 못 쓰는지 먼저 보여 주는 편이 낫다.
   */
  const measured = useEditorStore((state) => Boolean(state.scene?.room?.measured));

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
      {measured ? (
        item(`/api/projects/${projectId}/export?format=dxf`, "평면도 (DXF · mm)")
      ) : (
        <div className="rounded px-2 py-1.5">
          <p className="text-[12px] text-muted">평면도 (DXF · mm)</p>
          <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted">
            공간 패널에서 한 변의 실제 길이를 넣어 축척을 맞추면 열립니다.
          </p>
        </div>
      )}
      {item(`/api/projects/${projectId}/export?format=plan`, "치수 평면도 (SVG)", true)}
      {item(`/api/projects/${projectId}/export?format=elevation`, "입면도 (SVG)", true)}

      <ExportPdf />

      <ExportGlb />

      <p className="px-2 pb-1 pt-2 text-[10.5px] font-medium text-muted">이미지 · 데이터</p>
      <ExportPng />
      {item(`/api/projects/${projectId}/export?format=image`, "장면 이미지 (SVG)", true)}
      {item(`/api/projects/${projectId}/export?format=scene`, "Scene JSON")}
      {item(`/api/projects/${projectId}/export?format=project`, "Project JSON")}
    </div>
  );
}

/**
 * 평면도·입면도·3D를 PDF 한 부로 묶어 내려받는다.
 *
 * 도면을 주고받는 방식은 장마다 파일 하나가 아니라 "한 부"다. 시공사에도
 * 집주인에게도 파일 하나만 보내면 되고, 그대로 인쇄하면 도면집이 된다.
 *
 * 3D는 브라우저 캔버스에만 있어서 서버가 만들 수 없다(헤드리스 WebGL이 필요하다).
 * 3D 뷰가 열려 있으면 여기서 찍어 함께 보내고, 아니면 도면만 담는다 —
 * 3D를 안 켰다고 도면까지 못 받는 것은 곤란하다.
 */
function ExportPdf() {
  const projectId = useEditorStore((state) => state.projectId);
  const viewportCapture = useEditorStore((state) => state.viewportCapture);
  const setMessage = useEditorStore((state) => state.setMessage);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    setMessage("도면을 PDF로 묶는 중입니다…");

    try {
      const viewport = viewportCapture ? viewportCapture() : null;

      const response = await fetch(`/api/projects/${projectId}/export/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewport }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "PDF를 만들지 못했습니다.");
      }

      const blob = await response.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `${useEditorStore.getState().projectName || "도면"}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);

      const sheets = decodeURIComponent(response.headers.get("X-Sheets") ?? "");
      const count = sheets ? sheets.split(", ").length : 0;
      setMessage(
        viewport
          ? `${count}장을 PDF로 묶었습니다 (3D 포함).`
          : `${count}장을 PDF로 묶었습니다. 3D 뷰를 열고 다시 누르면 3D도 함께 들어갑니다.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "PDF를 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void download()}
      disabled={busy}
      className="block w-full rounded px-2 py-1.5 text-left text-[12px] font-medium text-ink hover:bg-sunken disabled:opacity-40"
    >
      {busy ? "묶는 중…" : "도면 한 부 (PDF)"}
    </button>
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

/**
 * 전기 설비 도구.
 *
 * 무엇을 놓을지 고르고 평면도를 찍으면 그 자리에 선다. 벽 가까이 찍으면 그 벽에
 * 붙고(콘센트·스위치), 벽에서 멀면 좌표 그대로 놓인다(천장등).
 *
 * 종류를 고르는 순간 도구가 전기로 바뀐다 — 고르고 나서 버튼을 또 누르게 하면
 * 한 번에 될 일이 두 번이 된다.
 */
function ElectricalPicker() {
  const planTool = useEditorStore((state) => state.planTool);
  const setPlanTool = useEditorStore((state) => state.setPlanTool);
  const kind = useEditorStore((state) => state.electricalKind);
  const setKind = useEditorStore((state) => state.setElectricalKind);
  const setViewMode = useEditorStore((state) => state.setViewMode);
  const viewMode = useEditorStore((state) => state.viewMode);

  const active = planTool === "electrical";

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          if (viewMode !== "plan") setViewMode("plan");
          setPlanTool(active ? "select" : "electrical");
        }}
        title="평면도를 찍어 콘센트·스위치·조명을 놓습니다"
        className={[
          "flex h-[54px] w-[58px] flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] text-[11px]",
          active ? "bg-ink text-surface" : "text-ink-soft hover:bg-sunken",
        ].join(" ")}
      >
        <Icon name="outlet" />
        설비
      </button>

      <select
        value={kind}
        onChange={(event) => {
          setKind(event.target.value as ElectricalKind);
          if (viewMode !== "plan") setViewMode("plan");
          setPlanTool("electrical");
        }}
        className="h-7 rounded-[var(--radius-control)] border border-line bg-surface px-1.5 text-[11.5px]"
      >
        {ELECTRICAL_SPECS.map((spec) => (
          <option key={spec.kind} value={spec.kind}>
            {spec.label}
          </option>
        ))}
      </select>
    </div>
  );
}
