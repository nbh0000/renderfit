"use client";

import { create } from "zustand";
import type { DesignProject, Scene, SceneObject } from "@/scene/types";
import type { Job } from "@/lib/queue";

/**
 * Editor 상태.
 *
 * Scene 조작 로직은 절대 여기에 두지 않는다 — 서버의 Scene Engine이 유일한 진실이고,
 * 이 스토어는 "무엇을 보여줄지"와 "무엇을 호출할지"만 관리한다.
 */

export type ViewMode = "image" | "2.5d" | "3d";
export type EditorTool = "select" | "move" | "rotate" | "scale";

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
  clipboard: SceneObject | null;
  showGrid: boolean;
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
  placeAsset: (assetId: string, clientX: number, clientY: number) => Promise<void>;

  runTool: (tool: string, args?: Record<string, unknown>) => Promise<ToolCallResult>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  runCommand: (instruction: string) => Promise<{ ok: boolean; message: string }>;
  startJob: (path: string, body?: unknown) => Promise<Job | null>;
  saveVersion: (label: string) => Promise<void>;
  reload: () => Promise<void>;
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
  viewMode: "2.5d",
  tool: "select",
  canUndo: false,
  canRedo: false,
  busy: null,
  jobs: [],
  lastMessage: null,
  clipboard: null,
  showGrid: true,
  renderUrl: null,
  viewportCapture: null,
  viewportExport: null,
  viewportRaycast: null,
  showBackdrop: true,

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
    });
  },

  /** Scene operation 실행 — 모든 편집은 이 경로를 지난다 */
  runTool: async (tool, args = {}) => {
    const { projectId } = get();
    const { ok, data } = await postJSON(`/api/projects/${projectId}/operations`, {
      tool,
      arguments: args,
    });

    if (!ok) {
      const message = (data.error as string) ?? "실행에 실패했습니다.";
      set({ lastMessage: message });
      return { ok: false, message };
    }

    const result = data.result as { message?: string; selectObjectId?: string } | undefined;
    set({
      scene: data.scene as Scene,
      canUndo: Boolean(data.canUndo),
      canRedo: Boolean(data.canRedo),
      lastMessage: result?.message ?? null,
      ...(result?.selectObjectId ? { selectedIds: [result.selectObjectId] } : {}),
    });

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
      set({ busy: null, lastMessage: message });
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

    return { ok: true, message: data.message as string };
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
      set({ lastMessage: (data.error as string) ?? "작업을 시작하지 못했습니다.", busy: null });
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
    const result = current.result as { imageUrl?: string; quality?: string } | null;
    if (result?.imageUrl && (current.type === "RENDER_PREVIEW" || current.type === "RENDER_FINAL")) {
      set({ renderUrl: result.imageUrl });
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
