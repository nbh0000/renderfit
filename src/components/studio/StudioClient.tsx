"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MODES, MODE_MAP, type ModeId } from "@/config/modes";
import { ROOMS, type RoomId } from "@/config/rooms";
import { STYLES, type StyleId } from "@/config/styles";
import {
  FLOORPLAN_CREDITS,
  IMAGES_PER_JOB,
  PLANS,
  RESOLUTION_MAP,
  affordableImageCount,
  creditCost,
  getPlan,
  planAllows,
  type PlanId,
  type ResolutionId,
  IMAGE_COUNT_OPTIONS,
} from "@/config/plans";
import {
  EMPTY_MATERIALS,
  type AccountState,
  type GenerationJob,
  type GenerationSettings,
  type MaterialSpec,
  type SpaceSize,
} from "@/lib/types";
import { useAccount } from "@/lib/use-account";
import { AppShell } from "@/components/AppShell";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Uploader, type UploadValue } from "./Uploader";
import { ModeSelector } from "./ModeSelector";
import { RoomStyleSelector } from "./RoomStyleSelector";
import { ProControls } from "./ProControls";
import { ResolutionSelector } from "./ResolutionSelector";
import { ProjectPicker } from "./ProjectPicker";
import { SpaceSizeInput } from "./SpaceSizeInput";
import { ResultsPanel } from "./ResultsPanel";
import { FloorplanModal } from "./FloorplanModal";
import type { GenerationResultImage } from "@/lib/types";

const POLL_INTERVAL = 1200;

export interface StudioClientProps {
  /** Supabase 미설정 로컬 mock 모드 여부 */
  local: boolean;
  initialAccount: AccountState;
  user: { name: string; avatarUrl: string | null } | null;
  /** 메인 시작 모달에서 고른 모드 (?mode=) */
  initialModeId?: ModeId;
}

export function StudioClient({ local, initialAccount, user, initialModeId }: StudioClientProps) {
  const { toast } = useToast();
  const { account, loaded, spend, refund, switchPlan, refresh } = useAccount({
    local,
    initial: initialAccount,
  });

  const [source, setSource] = useState<UploadValue | null>(null);
  const [reference, setReference] = useState<UploadValue | null>(null);
  const [modeId, setModeId] = useState<ModeId>(initialModeId ?? MODES[0].id);
  const [roomId, setRoomId] = useState<RoomId>(ROOMS[0].id);
  const [styleId, setStyleId] = useState<StyleId>(STYLES[0].id);
  const [materials, setMaterials] = useState<MaterialSpec>(EMPTY_MATERIALS);
  const [resolution, setResolution] = useState<ResolutionId>("standard");
  // 사용자가 고른 장수. 크레딧이 모자라면 아래에서 만들 수 있는 만큼으로 줄인다.
  const [wantedCount, setWantedCount] = useState<number>(IMAGES_PER_JOB);
  const [mask, setMask] = useState<File | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [size, setSize] = useState<SpaceSize | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [simulateFailure, setSimulateFailure] = useState(false);

  const [job, setJob] = useState<GenerationJob | null>(null);
  const [running, setRunning] = useState(false);
  const [openingEditor, setOpeningEditor] = useState(false);
  const router = useRouter();
  /**
   * 올린 도면을 편집기로 보낸다.
   *
   * 스튜디오 결과는 AI가 도면을 보고 그린 그림이라 치수가 보장되지 않는다.
   * 편집기는 도면에서 벽·개구부를 읽어 Scene을 세우므로 실제 치수를 지킨다 —
   * 같은 원본을 새 프로젝트로 올려 주고 넘긴다. 분석은 편집기가 알아서 시작한다.
   */
  const openInEditor = useCallback(async () => {
    if (!source) return;
    setOpeningEditor(true);

    try {
      const created = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: source.file.name || "도면 프로젝트" }),
      });
      const project = await created.json();
      if (!created.ok) throw new Error(project.error ?? "프로젝트를 만들지 못했습니다.");

      const form = new FormData();
      form.append("image", source.file);
      form.append("kind", "floorplan");

      const uploaded = await fetch(`/api/projects/${project.project.id}/images`, {
        method: "POST",
        body: form,
      });
      if (!uploaded.ok) {
        const data = await uploaded.json().catch(() => ({}));
        throw new Error(data.error ?? "도면을 올리지 못했습니다.");
      }

      router.push(`/editor/${project.project.id}`);
    } catch (err) {
      setOpeningEditor(false);
      toast(err instanceof Error ? err.message : "편집기로 보내지 못했습니다.", "error");
    }
  }, [router, source, toast]);

  const [floorplan, setFloorplan] = useState<{ open: boolean; url: string | null; loading: boolean }>(
    { open: false, url: null, loading: false }
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mode = MODE_MAP[modeId];
  // 커스텀 스타일처럼 참고 이미지를 전제로 하는 스타일인지
  const needsReference = Boolean(STYLES.find((s) => s.id === styleId)?.requiresReference);
  const plan = getPlan(account.plan);
  // 남은 크레딧이 모자라면 만들 수 있는 장수만큼만 생성한다 (무료 플랜 3크레딧 등)
  const affordable = affordableImageCount(resolution, account.credits);
  const imageCount = Math.min(wantedCount, affordable);
  const cost = creditCost(resolution, Math.max(imageCount, 1));
  const notEnoughCredits = loaded && affordable === 0;

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // 원본이 바뀌거나 지워지면 마스크도 버린다.
  useEffect(() => {
    setMask(null);
  }, [source?.url]);

  // 플랜이 내려가면 사용할 수 없는 옵션을 되돌린다.
  useEffect(() => {
    if (!planAllows(account.plan, "pro")) {
      setResolution("standard");
      setMaterials(EMPTY_MATERIALS);
      setMask(null);
      if (!planAllows(account.plan, MODE_MAP[modeId].requiredPlan)) setModeId(MODES[0].id);
    }
  }, [account.plan, modeId]);

  const startPolling = useCallback(
    (jobId: string, charged: number, requested: number) => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
          if (!res.ok) throw new Error("작업 상태를 불러오지 못했습니다.");
          const next = (await res.json()) as GenerationJob;
          if (next.status === "succeeded" || next.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setRunning(false);
            setJob(next);
            if (next.status === "failed") {
              // 로컬 모드는 클라이언트가, Supabase 모드는 서버가 환불한다.
              if (local) refund(charged);
              // 사유를 알려 줘야 사용자가 다음에 무엇을 바꿔야 할지 안다.
              toast(next.error ?? "생성에 실패했습니다. 크레딧이 환불되었습니다", "error");
            } else if (next.results.length < requested) {
              toast(
                next.error ?? `${next.results.length}장만 생성되었습니다. 나머지는 환불되었습니다`,
                "error"
              );
            } else {
              toast(`시안 ${next.results.length}장이 완성되었습니다`, "success");
            }
            void refresh();
          }
        } catch {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setRunning(false);
          if (local) refund(charged);
          toast("실패했습니다. 크레딧이 환불되었습니다", "error");
          void refresh();
        }
      }, POLL_INTERVAL);
    },
    [local, refresh, refund, toast]
  );

  /** overrides를 주면 그 설정 그대로 재실행한다 ("이 결과로 다시 생성"). */
  const generate = useCallback(
    async (overrides?: Partial<GenerationSettings>) => {
    if (!source) {
      toast("먼저 이미지를 올려 주세요.", "error");
      return;
    }
    if (notEnoughCredits) {
      toast("크레딧이 부족합니다. 요금제를 확인해 주세요.", "error");
      return;
    }
    if (needsReference && !reference) {
      toast("참고 이미지를 올려 주세요.", "error");
      return;
    }

    const settings: GenerationSettings = {
      modeId,
      roomId,
      styleId,
      resolution,
      materials,
      customPrompt: customPrompt.trim() || undefined,
      size,
      projectId,
      ...overrides,
      // 마스크는 파일이 함께 전송되므로 현재 캔버스 상태를 따른다.
      useMask: Boolean(mask),
    };

    const form = new FormData();
    form.append("image", source.file);
    form.append("settings", JSON.stringify(settings));
    form.append("count", String(imageCount));
    if (mask) form.append("mask", mask);
    if (reference) form.append("reference", reference.file);
    if (simulateFailure) form.append("simulateFailure", "true");

    setRunning(true);
    setJob(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        body: form,
        // 로컬 mock 모드에서만 의미가 있는 헤더다. Supabase 모드에서는 서버가 무시한다.
        headers: local ? { "x-mock-plan": account.plan } : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "생성 요청에 실패했습니다.");

      spend(data.creditsCharged as number);
      startPolling(data.jobId as string, data.creditsCharged as number, imageCount);
    } catch (err) {
      setRunning(false);
      toast(err instanceof Error ? err.message : "생성 요청에 실패했습니다.", "error");
    }
  },
  [
    account.plan,
    customPrompt,
    needsReference,
    imageCount,
    size,
    local,
    mask,
    materials,
    modeId,
    notEnoughCredits,
    projectId,
    reference,
    resolution,
    roomId,
    simulateFailure,
    source,
    spend,
    startPolling,
    styleId,
    toast,
  ]
  );

  /** 결과 시안 1장을 입력으로 참고용 배치도를 만든다. 1크레딧이 차감된다. */
  const requestFloorplan = useCallback(
    async (result: GenerationResultImage) => {
      if (account.credits < FLOORPLAN_CREDITS) {
        toast("크레딧이 부족합니다.", "error");
        return;
      }

      setFloorplan({ open: true, url: null, loading: true });

      try {
        const res = await fetch("/api/floorplan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(local ? { imageUrl: result.url } : { resultId: result.id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "배치도 생성에 실패했습니다.");

        if (local) spend(FLOORPLAN_CREDITS);
        else void refresh();

        setFloorplan({ open: true, url: data.url as string, loading: false });
      } catch (err) {
        setFloorplan({ open: false, url: null, loading: false });
        toast(err instanceof Error ? err.message : "배치도 생성에 실패했습니다.", "error");
      }
    },
    [account.credits, local, refresh, spend, toast]
  );

  return (
    <AppShell
      active="studio"
      authed
      right={
          <>
            <span className="rounded-full border border-line bg-surface px-2.5 py-1">
              {plan.label} · 크레딧 {loaded ? account.credits : "—"}
            </span>
            {user && (
              <>
                {user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.avatarUrl}
                    alt=""
                    className="h-7 w-7 rounded-full border border-line object-cover"
                  />
                ) : (
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-sunken text-[12px]">
                    {user.name.slice(0, 1)}
                  </span>
                )}
                <form action="/auth/signout" method="post">
                  <button type="submit" className="text-[12.5px] text-muted hover:text-ink">
                    로그아웃
                  </button>
                </form>
              </>
            )}
          </>
        }
    >
      <main className="mx-auto grid max-w-[1400px] gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-8">
        {/* 좌측 패널 (모바일에서는 상단) */}
        <div className="space-y-4">
          <Panel title="이미지">
            <Uploader
              value={source}
              onChange={setSource}
              inputType={mode.inputType}
              onError={(m) => toast(m, "error")}
            />
          </Panel>

          <Panel title="공간 크기">
            <SpaceSizeInput value={size} onChange={setSize} />
          </Panel>

          <Panel title="모드">
            <ModeSelector
              value={modeId}
              onChange={setModeId}
              plan={account.plan}
              onLocked={(m) => toast(m, "error")}
            />
          </Panel>

          <Panel title="정리">
            <ProjectPicker
              value={projectId}
              onChange={setProjectId}
              onError={(m) => toast(m, "error")}
            />
          </Panel>

          <Panel title="공간과 스타일">
            <RoomStyleSelector
              roomId={roomId}
              onRoomChange={setRoomId}
              styleId={styleId}
              onStyleChange={setStyleId}
              reference={reference}
              onReferenceChange={setReference}
              onError={(m) => toast(m, "error")}
              usesStyle={mode.usesStyle}
            />
          </Panel>

          <Panel title="직접 지시 (선택)">
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value.slice(0, 500))}
              rows={3}
              placeholder="예: 소파는 3인용 라운드 형태로, 러그는 깔지 말고, 창가에 큰 화분 하나"
              className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed placeholder:text-muted/70"
            />
            <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
              <span>스타일·모드 지시에 이어서 반영됩니다.</span>
              <span>{customPrompt.length}/500</span>
            </div>
          </Panel>

          <Panel title="해상도">
            <ResolutionSelector
              value={resolution}
              credits={account.credits}
              onChange={setResolution}
            />
          </Panel>

          <ProControls
            plan={account.plan}
            materials={materials}
            onMaterialsChange={setMaterials}
            onLocked={(m) => toast(m, "error")}
            sourceUrl={source?.url ?? null}
            onMaskChange={setMask}
          />

          <div className="sticky bottom-0 -mx-4 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur-sm sm:mx-0 sm:rounded-[var(--radius-card)] sm:border sm:px-4">
            <div className="mb-2 flex items-center gap-1.5">
              <span className="mr-1 text-[12px] text-muted">장수</span>
              {IMAGE_COUNT_OPTIONS.map((option) => {
                const affordableHere = option <= affordable;
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={!affordableHere}
                    onClick={() => setWantedCount(option)}
                    aria-pressed={wantedCount === option}
                    className={[
                      "h-8 flex-1 rounded-md border text-[12.5px] transition-colors",
                      wantedCount === option
                        ? "border-accent bg-accent-soft font-medium text-accent"
                        : "border-line text-muted hover:text-ink",
                      affordableHere ? "" : "cursor-not-allowed opacity-40",
                    ].join(" ")}
                  >
                    {option}장
                  </button>
                );
              })}
            </div>

            <div className="mb-2 flex items-center justify-between text-[12.5px]">
              {notEnoughCredits ? (
                <span className="text-danger">크레딧이 모두 소진되었습니다</span>
              ) : (
                <span className="text-muted">
                  이번 생성: <strong className="font-semibold text-ink">{cost}크레딧</strong>
                  <span className="text-muted"> · {imageCount}장</span>
                  {mask && <span className="text-accent"> · 마스킹 적용</span>}
                </span>
              )}
              {/* TODO(Phase 4): 요금제 페이지 링크 연결 */}
            </div>
            <Button
              size="lg"
              className="w-full"
              onClick={() => void generate()}
              disabled={running || !source || notEnoughCredits}
            >
              {running ? "생성 중…" : "시안 생성하기"}
            </Button>
          </div>

          {local && (
            <DevTools
              plan={account.plan}
              onPlanChange={switchPlan}
              simulateFailure={simulateFailure}
              onSimulateFailureChange={setSimulateFailure}
            />
          )}
        </div>

        {/*
          우측 결과 영역.
          왼쪽 설정 패널이 길어서 아래로 내리면 결과가 화면 밖으로 사라졌다.
          넓은 화면에서는 결과를 화면에 붙여 두고 그 안에서만 스크롤하게 한다.
        */}
        <section className="lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:pr-1">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">결과</h2>
            {job?.status === "succeeded" && (
              <span className="text-[12px] text-muted">
                {MODE_MAP[job.settings.modeId].label} · {job.results.length}장
              </span>
            )}
          </div>
          <ResultsPanel
            job={job}
            originalUrl={source?.url ?? null}
            running={running}
            expectedCount={Math.max(imageCount, 1)}
            estimatedSeconds={RESOLUTION_MAP[resolution].estimatedSeconds}
            // "이 결과로 다시 생성" — 그 결과를 만든 설정 그대로 재실행한다.
            onRegenerate={() => void generate(job?.settings)}
            onFloorplan={requestFloorplan}
            // 도면을 올렸을 때만 — 사진은 이미 편집기 쪽 흐름이 따로 있다.
            onOpenInEditor={mode.inputType === "floorplan" ? openInEditor : undefined}
            openingEditor={openingEditor}
          />
        </section>
      </main>

      {floorplan.open && (
        <FloorplanModal
          url={floorplan.url}
          loading={floorplan.loading}
          onClose={() => setFloorplan({ open: false, url: null, loading: false })}
        />
      )}
    </AppShell>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4">
      <h2 className="mb-3 text-[13px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Phase 1 개발용 도구. TODO(Phase 2): 실제 인증/플랜이 붙으면 제거한다. */
function DevTools({
  plan,
  onPlanChange,
  simulateFailure,
  onSimulateFailureChange,
}: {
  plan: PlanId;
  onPlanChange: (plan: PlanId) => void;
  simulateFailure: boolean;
  onSimulateFailureChange: (value: boolean) => void;
}) {
  return (
    <details className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface/60 px-4 py-3 text-[12px] text-muted">
      <summary className="cursor-pointer select-none">개발용 미리보기 설정</summary>
      <div className="mt-3 space-y-3">
        <div>
          <span className="mb-1.5 block">플랜 전환 (mock)</span>
          <div className="flex gap-1.5">
            {PLANS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPlanChange(p.id)}
                className={[
                  "rounded-md border px-2.5 py-1 transition-colors",
                  plan === p.id ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-sunken",
                ].join(" ")}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={simulateFailure}
            onChange={(e) => onSimulateFailureChange(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          생성 실패 시뮬레이션 (크레딧 환불 확인용)
        </label>
      </div>
    </details>
  );
}
