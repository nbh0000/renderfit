"use client";

import { useEffect, useRef, useState } from "react";
import type { DesignProject } from "@/scene/types";
import { useEditorStore } from "@/lib/editor/store";
import { STYLE_PRESETS } from "@/models/styles";
import { Ribbon } from "./Ribbon";
import { CanvasControls } from "./CanvasControls";
import { VariantCompare } from "./VariantCompare";
import { Canvas2D } from "./Canvas/Canvas2D";
import { Canvas3D } from "./Canvas/Canvas3D";
import { DrawingView } from "./Drawings/DrawingView";
import { PlanEditor } from "./Plan/PlanEditor";
import { LevelTabs } from "./Plan/LevelTabs";
import { FurnitureTable } from "./Furniture/FurnitureTable";
import { LayersPanel } from "./Layers/LayersPanel";
import { PropertiesPanel } from "./Properties/PropertiesPanel";
import { RoomPanel } from "./Room/RoomPanel";
import { AssetsPanel } from "./Assets/AssetsPanel";
import { AICommandBar } from "./AICommand/AICommandBar";
import { AgentPanel } from "./AICommand/AgentPanel";
import { useShortcuts } from "./useShortcuts";

export function EditorShell({ project }: { project: DesignProject }) {
  const init = useEditorStore((state) => state.init);
  const scene = useEditorStore((state) => state.scene);
  const viewMode = useEditorStore((state) => state.viewMode);
  const renderUrl = useEditorStore((state) => state.renderUrl);
  const setRenderUrl = useEditorStore((state) => state.setRenderUrl);
  const placeAsset = useEditorStore((state) => state.placeAsset);
  const [rightTab, setRightTab] = useState<"layers" | "properties" | "room" | "furniture" | "agent">("agent");

  useEffect(() => {
    init(project);
  }, [init, project]);

  useShortcuts();

  const hasImage = Boolean(scene?.source?.imageUrl);
  const ready = Boolean(scene?.sceneId);

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <Ribbon />

      <div className="flex min-h-0 flex-1">
        {/* 좌측: 에셋/재질/스타일/조명/AI */}
        <aside className="hidden w-[260px] shrink-0 flex-col border-r border-line bg-surface lg:flex">
          <div className="min-h-0 flex-1">
            <AssetsPanel />
          </div>

          {/* 가구 목록 — 카탈로그 바로 아래에 두어 고른 것이 쌓이는 게 보이게 한다 */}
          <div className="h-[38%] min-h-[150px] shrink-0 overflow-auto border-t border-line">
            <FurnitureTable />
          </div>
        </aside>

        {/* 중앙 캔버스 */}
        <main
          className="relative min-w-0 flex-1"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("text/asset-id")) event.preventDefault();
          }}
          onDrop={(event) => {
            const assetId = event.dataTransfer.getData("text/asset-id");
            if (!assetId) return;
            event.preventDefault();
            void placeAsset(assetId, event.clientX, event.clientY);
          }}
        >
          {!ready ? null : viewMode === "3d" ? (
            <Canvas3D />
          ) : viewMode === "split" ? (
            /*
             * 평면 + 3D 동시 보기.
             * 도면을 고치면서 입체를 바로 확인하는 게 이 편집기의 기본 작업 방식이라
             * 화면을 위아래로 나눠 둘 다 띄운다.
             */
            <div className="flex h-full flex-col">
              <LevelTabs />
              <div className="min-h-0 flex-1 border-b border-line">
                <PlanEditor />
              </div>
              <div className="min-h-0 flex-1">
                <Canvas3D />
              </div>
            </div>
          ) : viewMode === "plan" ? (
            <div className="flex h-full flex-col">
              <LevelTabs />
              <div className="min-h-0 flex-1">
                <PlanEditor />
              </div>
            </div>
          ) : viewMode === "elevation" ? (
            <DrawingView mode="elevation" />
          ) : (
            <Canvas2D />
          )}

          {ready && hasImage && <CanvasControls />}

          <VariantCompare />

          {!hasImage && ready && <OnboardingOverlay />}

          {renderUrl && (
            <div
              className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 p-6"
              onClick={() => setRenderUrl(null)}
            >
              <div className="max-h-full w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
                <div className="mb-2 flex items-center justify-between text-white">
                  <p className="text-[13px]">렌더 결과</p>
                  <div className="flex gap-2">
                    <a
                      href={renderUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md bg-white/10 px-2.5 py-1 text-[12px] hover:bg-white/20"
                    >
                      새 탭에서 열기
                    </a>
                    <button
                      type="button"
                      onClick={() => setRenderUrl(null)}
                      className="rounded-md bg-white px-2.5 py-1 text-[12px] text-ink"
                    >
                      닫기
                    </button>
                  </div>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={renderUrl} alt="렌더 결과" className="w-full rounded-lg" />
              </div>
            </div>
          )}
        </main>

        {/* 우측: 레이어/속성 */}
        {/* AI 도우미는 대화가 들어가므로 조금 더 넓게 쓴다 */}
        <aside
          className={[
            "hidden shrink-0 flex-col border-l border-line bg-surface md:flex",
            rightTab === "agent" ? "w-[330px]" : "w-[260px]",
          ].join(" ")}
        >
          <div className="flex shrink-0 gap-0.5 border-b border-line px-2 py-1.5">
            {(
              [
                { id: "agent", label: "AI 도우미" },
                { id: "properties", label: "속성" },
                { id: "room", label: "공간·치수" },
                { id: "layers", label: "레이어" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setRightTab(tab.id)}
                className={[
                  "rounded-md px-2 py-1 text-[11.5px] transition-colors",
                  rightTab === tab.id
                    ? "bg-sunken font-medium text-ink"
                    : "text-muted hover:text-ink",
                ].join(" ")}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {/* AI 도우미는 자체 스크롤을 쓰므로 바깥 스크롤을 걸지 않는다 */}
          <div
            className={[
              "min-h-0 flex-1",
              rightTab === "agent" ? "flex flex-col" : "scrollbar-slim overflow-y-auto",
            ].join(" ")}
          >
            {rightTab === "agent" ? (
              <AgentPanel />
            ) : rightTab === "layers" ? (
              <LayersPanel />
            ) : rightTab === "room" ? (
              <RoomPanel />
            ) : (
              <PropertiesPanel />
            )}
          </div>
        </aside>
      </div>

      <AICommandBar />
    </div>
  );
}

/** 새 프로젝트 흐름: 업로드 → 분석 → 스타일 → 생성 */
function OnboardingOverlay() {
  const projectId = useEditorStore((state) => state.projectId);
  const startJob = useEditorStore((state) => state.startJob);
  const reload = useEditorStore((state) => state.reload);
  const setBusy = useEditorStore((state) => state.setBusy);
  const setMessage = useEditorStore((state) => state.setMessage);
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"upload" | "style">("upload");
  const [uploading, setUploading] = useState(false);
  /*
   * 사진인지 도면인지 먼저 고른다.
   * 분석 프롬프트가 완전히 다르다 — 사진은 원근에서 치수를 역산해야 하고,
   * 도면은 벽 선과 치수가 이미 그려져 있어 그대로 읽으면 된다.
   */
  const [kind, setKind] = useState<"photo" | "floorplan">("photo");

  const upload = async (file: File) => {
    setUploading(true);
    setBusy(kind === "floorplan" ? "도면을 올리고 있습니다..." : "사진을 올리고 있습니다...");
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("kind", kind);

      const response = await fetch(`/api/projects/${projectId}/images`, {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "업로드에 실패했습니다.");

      await reload();
      setStep("style");
      setBusy(null);

      // 업로드 직후 자동으로 공간 분석을 시작한다.
      await startJob("/analyze");
    } catch (error) {
      setBusy(null);
      setMessage(error instanceof Error ? error.message : "업로드에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0a0a0a]/92 p-6">
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-line bg-surface p-6 text-center">
        {step === "upload" ? (
          <>
            <h2 className="text-[17px] font-semibold">
              {kind === "floorplan" ? "평면도를 올려 주세요" : "방 사진을 올려 주세요"}
            </h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              {kind === "floorplan"
                ? "도면에서 벽·개구부·치수를 읽어 평면도와 3D를 세웁니다. 치수가 적혀 있으면 그 값을 그대로 씁니다."
                : "AI가 공간을 분석해 벽·가구·조명을 객체로 분리합니다. 그다음 스타일을 고르면 시안이 만들어지고, 각 객체를 직접 편집할 수 있습니다."}
            </p>

            <div className="mt-4 flex gap-1">
              {(
                [
                  ["photo", "사진"],
                  ["floorplan", "평면도"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setKind(id)}
                  className={[
                    "flex-1 rounded-md px-2 py-1.5 text-[12px] transition-colors",
                    kind === id ? "bg-ink text-white" : "bg-sunken text-muted hover:text-ink",
                  ].join(" ")}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="mt-5 h-11 w-full rounded-lg bg-accent text-[14px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {uploading ? "업로드 중…" : "사진 선택"}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </>
        ) : (
          <>
            <h2 className="text-[17px] font-semibold">스타일을 고르세요</h2>
            <p className="mt-1.5 text-[13px] text-muted">선택하면 바로 생성이 시작됩니다.</p>
            <div className="mt-4 grid grid-cols-3 gap-1.5">
              {STYLE_PRESETS.slice(0, 9).map((style) => (
                <button
                  key={style.id}
                  type="button"
                  onClick={() => void startJob("/generate", { styleId: style.id })}
                  className="rounded-md border border-line p-1.5 text-[11px] hover:bg-sunken"
                >
                  <span className="mb-1 flex overflow-hidden rounded">
                    {style.palette.map((color) => (
                      <span key={color} className="h-5 flex-1" style={{ backgroundColor: color }} />
                    ))}
                  </span>
                  {style.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
