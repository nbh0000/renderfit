"use client";

import { create } from "zustand";
import type { DesignProject, Scene, SceneObject } from "@/scene/types";
import type { Job } from "@/lib/queue";
import { SceneEngine } from "@/scene/engine/SceneEngine";
import { executeCommand } from "@/ai/tools";

/**
 * Editor 상태.
 *
 * 서버의 Scene Engine이 여전히 유일한 진실이다. 다만 편집 한 번에 왕복 한 번을
 * 기다리게 하면 지우기·놓기가 눈에 띄게 굼떠서, 같은 엔진을 브라우저에서도 한 번
 * 돌려 화면을 먼저 바꾸고 서버 응답이 오면 그 값으로 맞춘다(낙관적 편집).
 * Scene 조작 로직 자체는 여기에 두지 않는다 — 양쪽이 같은 모듈을 부른다.
 */

/**
 * 편집기 보기 모드.
 *
 * 2.5D(화면 좌표 기반 반입체 뷰)는 실제 치수를 담지 못해 도면으로 쓸 수 없어 걷어냈다.
 * 대신 실측 좌표를 그대로 쓰는 평면도·입면도를 두고, 입체는 3D에서만 본다.
 */
export type ViewMode = "image" | "plan" | "elevation" | "3d" | "split";
export type EditorTool = "select" | "move" | "rotate" | "scale";

/**
 * 평면도에서 쓰는 그리기 도구.
 *
 * 3D 객체 조작 도구(EditorTool)와 분리해 둔다 — 평면도에서는 벽을 긋고 치수를 재는
 * 일이 주가 되고, 3D에서는 가구를 옮기는 일이 주가 되어 필요한 도구가 다르다.
 */
export type PlanTool = "select" | "wall" | "room" | "dimension" | "text" | "polyline";

export interface ToolCallResult {
  ok: boolean;
  message: string;
  selectObjectId?: string;
}

interface EditorState {
  projectId: string;
  projectName: string;
  scene: Scene;
  selectedIds: string[];
  viewMode: ViewMode;
  tool: EditorTool;
  canUndo: boolean;
  canRedo: boolean;
  /** 진행 중 작업 메시지 (null이면 대기) */
  busy: string | null;
  jobs: Job[];
  lastMessage: string | null;
  /**
   * 서버에 기록되지 못한 편집이 화면에 남아 있는가.
   *
   * 저장이 거절되면 화면은 그대로 두고 이 값을 세운다. 편집기가 이 값을 보고
   * 사용자에게 알리므로, 저장된 줄 알고 창을 닫는 일이 없어진다.
   */
  unsaved: boolean;
  /**
   * 크레딧이 모자라 마지막 작업이 막혔는가.
   *
   * 편집기는 크레딧을 눈에 띄게 보여 주지 않으므로, 막혔을 때만이라도 왜 막혔고
   * 어디로 가면 되는지 알려야 한다.
   */
  outOfCredits: boolean;
  clipboard: SceneObject | null;
  showGrid: boolean;
  /** 평면도 그리기 도구 */
  planTool: PlanTool;
  /** 격자 스냅 간격 (mm). 0이면 스냅하지 않는다 */
  snapMm: number;
  /**
   * 지금 편집 중인 층.
   * null이면 Scene의 첫 번째(기준) 층을 쓴다 — 층을 나누지 않은 프로젝트를 위한 기본값이다.
   */
  activeLevelId: string | null;
  /** 렌더 결과 미리보기 URL */
  renderUrl: string | null;
  /** 3D 캔버스 캡처 함수 (Canvas3D가 등록) */
  viewportCapture: (() => string) | null;
  /** 3D 씬을 GLB로 내보내는 함수 (Canvas3D가 등록) */
  viewportExport: (() => Promise<Blob>) | null;
  /** 화면 좌표 → 바닥 위 Scene 좌표 (드래그 배치용) */
  viewportRaycast: ((clientX: number, clientY: number) => { x: number; depth: number } | null) | null;
  /** 3D 뷰에 생성 이미지를 배경으로 띄울지 */
  showBackdrop: boolean;
  /** 평면도·입면도 확대 배율 (하단 바에서 조작) */
  zoom: number;
  /** 2안 비교 결과 — 고르기 전까지 장면에는 반영하지 않는다 */
  variants: { label: string; imageUrl: string }[] | null;

  init: (project: DesignProject) => void;
  setScene: (scene: Scene) => void;
  select: (ids: string[]) => void;
  toggleSelect: (id: string) => void;
  setViewMode: (mode: ViewMode) => void;
  setTool: (tool: EditorTool) => void;
  setBusy: (message: string | null) => void;
  setMessage: (message: string | null) => void;
  toggleGrid: () => void;
  setRenderUrl: (url: string | null) => void;
  setViewportCapture: (capture: (() => string) | null) => void;
  setViewportExport: (exporter: (() => Promise<Blob>) | null) => void;
  setViewportRaycast: (
    raycast: ((clientX: number, clientY: number) => { x: number; depth: number } | null) | null
  ) => void;
  toggleBackdrop: () => void;
  setZoom: (zoom: number) => void;
  setPlanTool: (tool: PlanTool) => void;
  setSnapMm: (snap: number) => void;
  setActiveLevel: (levelId: string | null) => void;
  setVariants: (variants: { label: string; imageUrl: string }[] | null) => void;
  applyVariant: (variant: { label: string; imageUrl: string }) => Promise<void>;
  placeAsset: (assetId: string, clientX: number, clientY: number) => Promise<void>;
  /** 설명으로 가구를 만들어 씬에 넣는다 (이미지 생성 → 3D 배치) */
  generateAsset: (description: string) => Promise<{ ok: boolean; message: string }>;

  /**
   * Scene operation 하나를 실행한다.
   *
   * 드래그처럼 손이 움직이는 내내 값이 바뀌는 조작은 두 단계로 나눠 쓴다 —
   * 끄는 동안에는 send:false로 화면만 바꾸고, 손을 뗄 때 preview:false로 서버에 한 번
   * 보낸다. 이렇게 해야 드래그 한 번이 되돌리기 한 번이 되고, 요청도 한 번만 나간다.
   */
  runTool: (
    tool: string,
    args?: Record<string, unknown>,
    options?: { preview?: boolean; send?: boolean }
  ) => Promise<ToolCallResult>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  runCommand: (
    instruction: string
  ) => Promise<{ ok: boolean; message: string; intent?: string; toolCount?: number }>;
  startJob: (path: string, body?: unknown) => Promise<Job | null>;
  saveVersion: (label: string) => Promise<void>;
  reload: () => Promise<void>;
}

/**
 * operation 요청은 한 번에 하나씩만 보낸다.
 *
 * 서버는 요청마다 프로젝트를 새로 읽어 연산을 얹고 저장한다. 그래서 빠르게 연달아
 * 지우면 두 요청이 같은 이전 상태를 읽고 마지막 것만 남아 — 지운 것이 되살아난다.
 * 화면은 낙관적 편집으로 이미 즉시 반응하므로, 전송만 줄 세워도 체감은 그대로다.
 */
let queue: Promise<unknown> = Promise.resolve();

/** 아직 응답을 기다리는 요청 수. 0이 될 때만 서버 Scene으로 화면을 맞춘다. */
let inFlight = 0;

/**
 * 같은 연산을 브라우저에서 미리 돌려 본다.
 *
 * 서버와 완전히 같은 모듈(executeCommand)을 쓰므로 결과가 어긋나지 않는다.
 * 실패하거나 지원하지 않는 연산이면 null을 돌려주고 조용히 서버만 기다린다.
 */
function previewTool(
  scene: Scene,
  tool: string,
  args: Record<string, unknown>
): { scene: Scene; selectObjectId?: string } | null {
  try {
    const engine = new SceneEngine(scene);
    const result = executeCommand(engine, {
      tool,
      arguments: args,
      explanation: "",
      confidence: 1,
    });
    if (!result.ok) return null;
    return { scene: engine.getScene(), selectObjectId: result.selectObjectId };
  } catch {
    return null;
  }
}

async function postJSON(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, data } as { ok: boolean; data: Record<string, unknown> };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  projectId: "",
  projectName: "",
  scene: {} as Scene,
  selectedIds: [],
  viewMode: "plan",
  tool: "select",
  canUndo: false,
  canRedo: false,
  busy: null,
  jobs: [],
  lastMessage: null,
  unsaved: false,
  outOfCredits: false,
  clipboard: null,
  showGrid: true,
  planTool: "select",
  snapMm: 100,
  activeLevelId: null,
  renderUrl: null,
  viewportCapture: null,
  viewportExport: null,
  viewportRaycast: null,
  showBackdrop: true,
  zoom: 1,
  variants: null,

  init: (project) =>
    set({
      projectId: project.id,
      projectName: project.name,
      scene: project.scene,
      canUndo: project.operations.length > 0,
      canRedo: project.redoStack.length > 0,
      selectedIds: [],
      renderUrl: null,
    }),

  setScene: (scene) => set({ scene }),
  select: (ids) => set({ selectedIds: ids }),
  toggleSelect: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((value) => value !== id)
        : [...state.selectedIds, id],
    })),
  setViewMode: (viewMode) => set({ viewMode }),
  setTool: (tool) => set({ tool }),
  setBusy: (busy) => set({ busy }),
  setMessage: (lastMessage) => set({ lastMessage }),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  setRenderUrl: (renderUrl) => set({ renderUrl }),
  setViewportCapture: (viewportCapture) => set({ viewportCapture }),
  setViewportExport: (viewportExport) => set({ viewportExport }),
  setViewportRaycast: (viewportRaycast) => set({ viewportRaycast }),
  toggleBackdrop: () => set((state) => ({ showBackdrop: !state.showBackdrop })),
  setZoom: (zoom) => set({ zoom: Math.min(3, Math.max(0.4, zoom)) }),
  setPlanTool: (planTool) => set({ planTool }),
  setSnapMm: (snapMm) => set({ snapMm: Math.max(0, snapMm) }),
  // 층을 바꾸면 이전 층의 선택은 의미가 없다.
  setActiveLevel: (activeLevelId) => set({ activeLevelId, selectedIds: [] }),
  setVariants: (variants) => set({ variants }),

  /** 고른 시안을 장면에 반영한다 */
  applyVariant: async (variant) => {
    const { projectId } = get();
    set({ busy: "고른 시안을 반영하고 있습니다..." });

    const { ok, data } = await postJSON(`/api/projects/${projectId}/apply-generation`, {
      imageUrl: variant.imageUrl,
      label: `${variant.label} 적용`,
    });

    if (!ok) {
      set({ busy: null, lastMessage: (data.error as string) ?? "반영하지 못했습니다." });
      return;
    }

    set({
      scene: data.scene as Scene,
      canUndo: Boolean(data.canUndo),
      canRedo: Boolean(data.canRedo),
      variants: null,
      busy: null,
      lastMessage: `${variant.label} 시안을 반영했습니다.`,
    });
  },

  /** 좌측 패널에서 3D 뷰로 끌어다 놓은 위치에 에셋을 추가한다 */
  placeAsset: async (assetId, clientX, clientY) => {
    const { viewportRaycast, runTool } = get();
    const hit = viewportRaycast?.(clientX, clientY) ?? null;

    const result = await runTool("add_object", { assetId });
    if (!result.ok || !hit || !result.selectObjectId) return;

    await runTool("move_object", {
      objectId: result.selectObjectId,
      x: hit.x,
      depth: hit.depth,
      snap: true,
    });
  },

  /**
   * 설명 → 가구.
   *
   * 이미지 생성이 몇 초 걸려서 낙관적으로 미리 넣을 수가 없다 —
   * 무엇을 넣을지(크기·모양)를 응답 전에는 알 수 없기 때문이다. 대신 진행 중임을 알린다.
   */
  generateAsset: async (description) => {
    const { projectId } = get();
    set({ busy: "가구를 만들고 있습니다..." });

    const { ok, data } = await postJSON(
      `/api/projects/${projectId}/generate-asset`,
      { description }
    );

    if (!ok) {
      const message = (data.error as string) ?? "가구를 만들지 못했습니다.";
      set({ busy: null, lastMessage: message, outOfCredits: data.insufficient === true });
      return { ok: false, message };
    }

    const message = `${data.name as string}을(를) 만들었습니다.`;
    set({
      scene: data.scene as Scene,
      canUndo: Boolean(data.canUndo),
      canRedo: Boolean(data.canRedo),
      busy: null,
      lastMessage: message,
      ...(data.objectId ? { selectedIds: [data.objectId as string] } : {}),
    });

    return { ok: true, message };
  },

  /** Scene operation 실행 — 모든 편집은 이 경로를 지난다 */
  runTool: async (tool, args = {}, options = {}) => {
    const { projectId, scene } = get();
    const { preview: wantPreview = true, send = true } = options;

    // 1) 브라우저에서 먼저 돌려 화면을 즉시 바꾼다.
    const preview = wantPreview ? previewTool(scene, tool, args) : null;
    if (preview) {
      set({
        scene: preview.scene,
        ...(preview.selectObjectId ? { selectedIds: [preview.selectObjectId] } : {}),
      });
    }

    /*
     * 끄는 중에는 여기서 멈춘다.
     *
     * 예전에는 pointermove마다 서버로 보냈다. 물건 하나를 위에서 아래로 옮기면 요청이
     * 스무 번 나가고 되돌리기도 스무 번 눌러야 했다 — 게다가 요청을 줄 세워 보내므로
     * 손이 멈춘 뒤에도 한참 따라왔다.
     */
    if (!send) return { ok: true, message: "" };

    // 2) 서버에는 줄을 세워 하나씩 보낸다.
    inFlight += 1;
    const request = queue.then(() =>
      postJSON(`/api/projects/${projectId}/operations`, { tool, arguments: args })
    );
    queue = request.catch(() => undefined);

    let ok = false;
    let data: Record<string, unknown> = {};
    try {
      ({ ok, data } = await request);
    } catch {
      ok = false;
      data = {};
    } finally {
      inFlight -= 1;
    }

    if (!ok) {
      const message = (data.error as string) ?? "실행에 실패했습니다.";

      /*
       * 저장에 실패한 것과 편집이 거절된 것은 다르게 다뤄야 한다.
       *
       * 거절(400)이면 서버에는 그 편집이 없으므로 화면을 서버 상태로 되돌리는 게 맞다.
       * 하지만 저장 실패(503)는 편집 자체는 옳았고 기록만 못 한 것이다. 이때 되읽으면
       * 사용자가 방금 한 작업이 눈앞에서 사라진다 — 30분치 작업이 그렇게 날아갈 수 있다.
       * 그래서 화면은 그대로 두고 저장되지 않았다는 사실만 알린다.
       */
      if (data.persisted === false) {
        set({ lastMessage: message, unsaved: true });
        return { ok: false, message };
      }

      set({ lastMessage: message });
      // 낙관적으로 바꿔 둔 화면이 서버와 어긋났다 — 서버 상태로 되돌린다.
      await get().reload();
      return { ok: false, message };
    }

    const result = data.result as { message?: string; selectObjectId?: string } | undefined;

    /*
     * 아직 보낼 것이 남아 있으면 서버 Scene을 덮어쓰지 않는다.
     * 덮어쓰면 뒤이어 낙관적으로 반영해 둔 편집이 잠깐 되살아났다가 다시 사라진다.
     */
    set(
      inFlight > 0
        ? { canUndo: Boolean(data.canUndo), canRedo: Boolean(data.canRedo), unsaved: false }
        : {
            unsaved: false,
            scene: data.scene as Scene,
            canUndo: Boolean(data.canUndo),
            canRedo: Boolean(data.canRedo),
            lastMessage: result?.message ?? null,
            ...(result?.selectObjectId ? { selectedIds: [result.selectObjectId] } : {}),
          }
    );

    return { ok: true, message: result?.message ?? "", selectObjectId: result?.selectObjectId };
  },

  undo: async () => {
    const { projectId } = get();
    const { ok, data } = await postJSON(`/api/projects/${projectId}/undo`);
    if (!ok) return;
    set({
      scene: data.scene as Scene,
      canUndo: Boolean(data.canUndo),
      canRedo: Boolean(data.canRedo),
      lastMessage: "되돌렸습니다.",
    });
  },

  redo: async () => {
    const { projectId } = get();
    const { ok, data } = await postJSON(`/api/projects/${projectId}/redo`);
    if (!ok) return;
    set({
      scene: data.scene as Scene,
      canUndo: Boolean(data.canUndo),
      canRedo: Boolean(data.canRedo),
      lastMessage: "다시 실행했습니다.",
    });
  },

  /** AI Command Bar */
  runCommand: async (instruction) => {
    const { projectId, selectedIds } = get();
    set({ busy: "명령을 해석하고 있습니다..." });

    const { ok, data } = await postJSON(`/api/projects/${projectId}/ai-command`, {
      instruction,
      selectedObjectId: selectedIds[0] ?? null,
    });

    if (!ok) {
      const message = (data.error as string) ?? "명령을 실행하지 못했습니다.";
      set({ busy: null, lastMessage: message, outOfCredits: data.insufficient === true });
      return { ok: false, message };
    }

    set({
      scene: data.scene as Scene,
      canUndo: Boolean(data.canUndo),
      canRedo: Boolean(data.canRedo),
      lastMessage: data.message as string,
      busy: null,
    });

    // 명령이 비동기 작업(생성/렌더)을 만들었으면 상태를 이어서 추적한다.
    const jobs = (data.jobs as Job[] | undefined) ?? [];
    for (const job of jobs) void trackJob(job, set, get);

    return {
      ok: true,
      message: data.message as string,
      intent: data.intent as string | undefined,
      toolCount: Array.isArray(data.results) ? data.results.length : 0,
    };
  },

  /** analyze / generate / render 처럼 background job을 만드는 호출 */
  startJob: async (path, body) => {
    const { projectId, viewMode, viewportCapture } = get();

    // 렌더는 지금 보고 있는 3D 화면을 캡처해 실사 변환의 기준으로 넘긴다.
    let payload = body;
    if (path.startsWith("/render") && viewMode === "3d" && viewportCapture) {
      try {
        payload = { ...(body as object), viewport: viewportCapture() };
      } catch {
        // 캡처가 실패해도 렌더 자체는 진행한다.
      }
    }

    const { ok, data } = await postJSON(`/api/projects/${projectId}${path}`, payload);

    if (!ok) {
      /*
       * 크레딧이 모자란 것은 고장이 아니라 안내할 일이다.
       * 요금제 쪽으로 보내는 표시를 따로 세워 둔다.
       */
      set({
        lastMessage: (data.error as string) ?? "작업을 시작하지 못했습니다.",
        busy: null,
        outOfCredits: data.insufficient === true,
      });
      return null;
    }

    const job = data.job as Job;
    set({ busy: job.message, jobs: [job, ...get().jobs].slice(0, 10) });
    void trackJob(job, set, get);
    return job;
  },

  saveVersion: async (label) => {
    const { projectId } = get();
    await postJSON(`/api/projects/${projectId}/versions`, { action: "save", label });
    set({ lastMessage: "버전을 저장했습니다." });
  },

  reload: async () => {
    const { projectId } = get();
    const response = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (!response.ok) return;
    const project = (await response.json()) as DesignProject;
    set({
      scene: project.scene,
      canUndo: project.operations.length > 0,
      canRedo: project.redoStack.length > 0,
      projectName: project.name,
    });
  },
}));

/** job 완료까지 폴링하며 상태 메시지를 갱신한다 */
async function trackJob(
  job: Job,
  set: (partial: Partial<EditorState>) => void,
  get: () => EditorState
): Promise<void> {
  let current = job;

  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 700));

    const response = await fetch(`/api/jobs/status/${job.id}`, { cache: "no-store" });
    if (!response.ok) break;

    current = (await response.json()) as Job;
    set({ busy: current.state === "completed" ? null : current.message });

    if (current.state === "completed" || current.state === "failed") break;
  }

  if (current.state === "completed") {
    const result = current.result as {
      imageUrl?: string;
      quality?: string;
      variants?: { label: string; imageUrl: string }[];
    } | null;

    if (result?.imageUrl && (current.type === "RENDER_PREVIEW" || current.type === "RENDER_FINAL")) {
      set({ renderUrl: result.imageUrl });
    }

    // 2안 생성은 고르기 전까지 장면을 바꾸지 않는다.
    if (result?.variants?.length) {
      set({ variants: result.variants, busy: null, lastMessage: "시안 두 개가 준비됐습니다." });
      return;
    }

    await get().reload();
    set({ busy: null, lastMessage: "완료되었습니다." });
  } else if (current.state === "failed") {
    set({ busy: null, lastMessage: current.error ?? "작업이 실패했습니다." });
  }
}

/** 선택된 객체 (단일) */
export function useSelectedObject(): SceneObject | null {
  return useEditorStore((state) => {
    const id = state.selectedIds[0];
    if (!id) return null;
    return state.scene?.objects?.find((object) => object.id === id) ?? null;
  });
}
