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
import { CanvasTopBar } from "./CanvasTopBar";
import { FurnitureTable } from "./Furniture/FurnitureTable";
import { LayersPanel } from "./Layers/LayersPanel";
import { PropertiesPanel } from "./Properties/PropertiesPanel";
import { RoomPanel } from "./Room/RoomPanel";
import { AssetsPanel } from "./Assets/AssetsPanel";
import { AICommandBar } from "./AICommand/AICommandBar";
import { ConfirmCharge } from "./ConfirmCharge";
import { PlanImport } from "./PlanImport";
import { AgentPanel } from "./AICommand/AgentPanel";
import { useShortcuts } from "./useShortcuts";

export function EditorShell({ project }: { project: DesignProject }) {
  const init = useEditorStore((state) => state.init);
  const scene = useEditorStore((state) => state.scene);
  const viewMode = useEditorStore((state) => state.viewMode);
  const renderUrl = useEditorStore((state) => state.renderUrl);
  const setRenderUrl = useEditorStore((state) => state.setRenderUrl);
  const placeAsset = useEditorStore((state) => state.placeAsset);
  const importOpen = useEditorStore((state) => state.importOpen);
  const setImportOpen = useEditorStore((state) => state.setImportOpen);
  const [rightTab, setRightTab] = useState<"layers" | "properties" | "room" | "furniture" | "agent">("agent");

  useEffect(() => {
    init(project);
  }, [init, project]);

  useShortcuts();

  const hasImage = Boolean(scene?.source?.imageUrl);
  const ready = Boolean(scene?.sceneId);
  /*
   * 도면이 들어와 있는가.
   *
   * 예전에는 "사진이 올라왔는가"(hasImage)만 보고 시작 화면을 띄웠다. 그런데 도면
   * 경로(DXF·DWG)로 들어온 프로젝트에는 사진이 없다 — 검수를 마치고 편집기로 돌아와도
   * 평면이 뒤에 깔린 채 시작 화면이 다시 덮어 버렸다. 벽이 서 있으면 시작은 끝난 것이다.
   */
  const hasPlan = (scene?.room?.walls?.length ?? 0) > 0 || (scene?.room?.areas?.length ?? 0) > 0;

  return (
    <div className="flex h-dvh flex-col bg-canvas">
      <Ribbon />
      <UnsavedBanner />
      <CreditBanner />
      <BusyBanner />

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

            /*
             * 패널이 실어 보낸 정보(모델 URL·치수·저작자 표시)를 그대로 넘긴다.
             * Poly Pizza 모델은 서버 카탈로그에만 있어 id 만으로는 찾지 못한다.
             */
            let args: Record<string, unknown> = { assetId };
            try {
              const payload = event.dataTransfer.getData("application/asset");
              if (payload) args = JSON.parse(payload) as Record<string, unknown>;
            } catch {
              /* 실어 보낸 게 깨졌으면 id 만으로 간다 */
            }

            void placeAsset(args, event.clientX, event.clientY);
          }}
        >
          {!ready ? null : (
            <div className="flex h-full flex-col">
              {/*
                층 탭 + 보기 전환.

                걷기에서는 띄우지 않는다 — 눈높이에서 둘러보는 화면에 편집 UI 가 겹치면
                몰입이 깨지고, 클릭이 마우스 잠금 대신 UI 로 간다. 나가는 길은 화면 안의
                "나가기" 버튼이다.
              */}
              {viewMode !== "walk" && <CanvasTopBar />}

              {/*
                3D 캔버스는 걷기와 3D 에서 **같은 자리**에 있어야 한다.

                한때 걷기만 이 껍데기 밖에 두었더니, 걷기↔3D 를 오갈 때마다 React 가
                Canvas 를 헐고 다시 지었다. 그때마다 WebGL 컨텍스트가 새로 생기는데
                브라우저가 살려 두는 컨텍스트 수에는 한계가 있어서, 몇 번 오가면
                가장 오래된 것부터 강제로 죽는다 — 화면이 까맣게 멈추고 콘솔에
                "THREE.WebGLRenderer: Context Lost." 만 남았다.

                같은 자리에 두면 React 가 같은 컴포넌트로 보고 인스턴스를 이어 쓴다.
              */}
              <div className="min-h-0 flex-1">
                {viewMode === "walk" ? (
                  <Canvas3D mode="walk" />
                ) : viewMode === "3d" ? (
                  <Canvas3D />
                ) : viewMode === "split" ? (
                  /*
                   * 평면 + 3D 동시 보기.
                   * 도면을 고치면서 입체를 바로 확인하는 게 이 편집기의 기본 작업 방식이라
                   * 화면을 위아래로 나눠 둘 다 띄운다.
                   */
                  <div className="flex h-full flex-col">
                    <div className="min-h-0 flex-1 border-b border-line">
                      <PlanEditor />
                    </div>
                    <div className="min-h-0 flex-1">
                      <Canvas3D />
                    </div>
                  </div>
                ) : viewMode === "plan" ? (
                  <PlanEditor />
                ) : viewMode === "elevation" ? (
                  <DrawingView mode="elevation" />
                ) : (
                  <Canvas2D />
                )}
              </div>
            </div>
          )}

          {ready && (hasImage || hasPlan) && <CanvasControls />}

          <VariantCompare />

          {ready && (importOpen || (!hasImage && !hasPlan)) && (
            <OnboardingOverlay
              /* 리본에서 연 창은 닫을 수 있어야 한다. 시작 화면으로 뜬 것은 닫을 곳이 없다 */
              onClose={importOpen ? () => setImportOpen(false) : undefined}
            />
          )}

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

      {/*
        걷기에서는 AI 명령을 받지 않는다.

        걷는 중에 장면이 바뀌면 발밑의 벽이 사라지거나 서 있던 자리에 가구가 생긴다.
        게다가 입력창에 포커스가 가면 WASD 가 글자로 들어가 걷지도 못한다.
        보는 모드에서는 보기만 한다.
      */}
      {viewMode !== "walk" && <AICommandBar />}

      {/* 크레딧이 나가기 전에 묻는다 — 걷기 중에도 떠야 한다(렌더 캡처가 있다) */}
      <ConfirmCharge />
    </div>
  );
}

/**
 * 새 프로젝트 흐름: 업로드 → 스타일 → 생성.
 *
 * 리본의 "가져오기" 로도 열린다 — 그때는 onClose 가 들어와 닫기 버튼이 붙는다.
 */
function OnboardingOverlay({ onClose }: { onClose?: () => void }) {
  const projectId = useEditorStore((state) => state.projectId);
  const startJob = useEditorStore((state) => state.startJob);
  const reload = useEditorStore((state) => state.reload);
  const setBusy = useEditorStore((state) => state.setBusy);
  const setMessage = useEditorStore((state) => state.setMessage);
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"upload" | "style">("upload");
  const [uploading, setUploading] = useState(false);
  /*
   * 도면 파일(DXF·DWG·이미지·PDF)로 시작하는 길.
   *
   * 사진 경로와 섞지 않는다. 도면 파일은 좌표가 파일 안에 그대로 있고, 사진은 그렇지
   * 않다 — 둘을 한 버튼에 묶으면 어느 쪽으로 읽혔는지 알 수 없다.
   */
  const [importing, setImporting] = useState(false);

  const upload = async (file: File) => {
    setUploading(true);
    setBusy("사진을 올리고 있습니다...");
    try {
      const form = new FormData();
      form.append("image", file);
      form.append("kind", "photo");

      const response = await fetch(`/api/projects/${projectId}/images`, {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "업로드에 실패했습니다.");

      /*
       * 여기서 사진을 분석하지 않는다.
       *
       * 예전에는 올리자마자 비전 모델에 넣어 방·벽·가구 좌표를 받아 왔다. 그 구조를
       * 폐기했다 — 비전 LLM 은 기하를 측정하지 못하고 추측한다. 사진은 시안을 만드는
       * 바탕으로만 쓰고, 도면은 "도면 파일 들여오기" 로 들어온다.
       */
      await reload();
      setStep("style");
      setBusy(null);
    } catch (error) {
      setBusy(null);
      setMessage(error instanceof Error ? error.message : "업로드에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  };

  if (importing) return <PlanImport onClose={() => setImporting(false)} />;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0a0a0a]/92 p-6">
      <div className="relative w-full max-w-md rounded-[var(--radius-card)] border border-line bg-surface p-6 text-center">
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="absolute right-3 top-3 h-7 w-7 rounded-md text-[15px] leading-none text-muted hover:bg-sunken hover:text-ink"
          >
            ×
          </button>
        )}
        {step === "upload" ? (
          <>
            <h2 className="text-[17px] font-semibold">도면을 올려 주세요</h2>

            {/*
              어느 파일이 왜 나은지 먼저 말한다.

              DXF·DWG 는 벽 좌표가 파일 안에 그대로 적혀 있어 우리가 읽기만 하면 된다.
              이미지·PDF 는 그 좌표를 그림에서 되짚어야 해서 틀릴 수 있고, 그래서 사람이
              한 번 보는 검수 단계를 지난다. 이 사실을 올리기 전에 알려 줘야 사용자가
              가진 파일 중 나은 쪽을 고른다.
            */}
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
              DXF/DWG 원본을 올리면 가장 정확합니다. 이미지·PDF는 검수 단계가 필요합니다.
            </p>

            <button
              type="button"
              onClick={() => setImporting(true)}
              className="mt-5 h-11 w-full rounded-lg bg-accent text-[14px] font-medium text-white hover:bg-accent-hover"
            >
              도면 파일 선택
            </button>

            <p className="mt-4 border-t border-line pt-3 text-[12px] leading-relaxed text-muted">
              도면이 없고 방 사진만 있다면, 사진으로 시안을 먼저 만들 수 있습니다.
            </p>
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="mt-2 h-10 w-full rounded-lg border border-line text-[13px] hover:bg-sunken disabled:opacity-50"
            >
              {uploading ? "업로드 중…" : "방 사진 올리기"}
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
                  onClick={() => {
                    void startJob("/generate", { styleId: style.id });
                    onClose?.();
                  }}
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

/**
 * 저장하지 못한 편집이 있다는 띠.
 *
 * 저장 실패는 조용히 지나가면 안 되는 종류의 일이다 — 사용자는 저장된 줄 알고 창을
 * 닫고, 작업이 사라진 뒤에야 알게 된다. 그래서 화면 맨 위에 붙여 두고, 다음 편집이
 * 성공해 서버에 기록될 때까지 내리지 않는다.
 */
function UnsavedBanner() {
  const unsaved = useEditorStore((state) => state.unsaved);
  const reload = useEditorStore((state) => state.reload);

  /*
   * 띠를 못 보고 창을 닫는 경우까지 막는다.
   * 브라우저가 문구를 무시하고 자기 문구를 쓰지만, 확인 창은 뜬다.
   */
  useEffect(() => {
    if (!unsaved) return;

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  if (!unsaved) return null;

  return (
    <div
      role="alert"
      className="flex shrink-0 items-center justify-between gap-3 border-b border-[#d9a441] bg-[#fdf6e6] px-4 py-2"
    >
      <span className="text-[12.5px] text-[#7a5a12]">
        저장하지 못한 편집이 있습니다. 화면의 내용은 그대로이니 다시 시도해 주세요 —
        창을 닫으면 사라집니다.
      </span>
      <button
        type="button"
        onClick={() => void reload()}
        className="shrink-0 rounded-[var(--radius-control)] border border-[#d9a441] px-2.5 py-1 text-[11.5px] text-[#7a5a12] hover:bg-[#f7ecd2]"
      >
        서버 내용으로 되돌리기
      </button>
    </div>
  );
}

/**
 * 오래 걸리는 일이 도는 중이라는 띠.
 *
 * 도면 분석·이미지 생성은 20~40초씩 걸리는데, 진행 상황이 오른쪽 AI 패널 안에만
 * 작게 떠서 보고 있지 않으면 멈춘 줄 안다. 화면 맨 위에 붙여 눈에 걸리게 한다.
 */
function BusyBanner() {
  const busy = useEditorStore((state) => state.busy);
  if (!busy) return null;

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line bg-sunken px-4 py-2">
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line-strong border-t-transparent" />
      <span className="text-[12.5px] text-ink-soft">{busy}</span>
    </div>
  );
}

/**
 * 크레딧이 모자라 막혔다는 띠.
 *
 * AI 작업은 크레딧을 쓰는데 편집기에는 잔액이 보이지 않는다. 막혔을 때 "실패했습니다"만
 * 뜨면 고장으로 오해하므로, 왜 막혔고 어디로 가면 되는지 그 자리에서 알려 준다.
 */
function CreditBanner() {
  const outOfCredits = useEditorStore((state) => state.outOfCredits);
  if (!outOfCredits) return null;

  return (
    <div
      role="alert"
      className="flex shrink-0 items-center justify-between gap-3 border-b border-line-strong bg-sunken px-4 py-2"
    >
      <span className="text-[12.5px] text-ink-soft">
        크레딧을 다 썼습니다. AI 분석·렌더·가구 만들기는 크레딧이 있어야 돌아갑니다.
      </span>
      <a
        href="/pricing"
        className="shrink-0 rounded-[var(--radius-control)] bg-ink px-2.5 py-1 text-[11.5px] text-surface hover:opacity-90"
      >
        요금제 보기
      </a>
    </div>
  );
}
