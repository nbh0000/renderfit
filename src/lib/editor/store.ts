"use client";

import { create } from "zustand";
import { COMMAND_CHARGE, chargeForJob } from "@/config/editorCosts";
import type { DesignProject, ElectricalKind, Scene, SceneObject } from "@/scene/types";
import type { Job } from "@/lib/queue";
import { SceneEngine } from "@/scene/engine/SceneEngine";
import { executeCommand } from "@/ai/tools";
import { underlayFitToRoom } from "@/scene/underlay";

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
export type ViewMode = "image" | "plan" | "elevation" | "3d" | "split" | "walk";
export type EditorTool = "select" | "move" | "rotate" | "scale";

/**
 * 평면도에서 쓰는 그리기 도구.
 *
 * 3D 객체 조작 도구(EditorTool)와 분리해 둔다 — 평면도에서는 벽을 긋고 치수를 재는
 * 일이 주가 되고, 3D에서는 가구를 옮기는 일이 주가 되어 필요한 도구가 다르다.
 */
export type PlanTool =
  | "select"
  | "wall"
  | "room"
  | "dimension"
  | "text"
  | "polyline"
  /** 콘센트·스위치·조명을 찍어 놓는다 */
  | "electrical"
  /** 스위치와 조명을 이어 배선을 그린다 */
  | "circuit";

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
  /**
   * 크레딧이 나가는 일을 하기 전에 물어볼 내용.
   *
   * 편집기의 AI 기능은 누르면 곧바로 크레딧이 빠졌다. 렌더 한 번에 2개가 나가는데도
   * 누르기 전에는 얼마가 드는지 알 수 없었고, 잘못 눌러도 되돌릴 방법이 없었다.
   * 남의 돈이 걸린 일은 묻고 나서 한다.
   */
  pendingCharge: PendingCharge | null;
  clipboard: SceneObject | null;
  showGrid: boolean;
  /** 평면도 그리기 도구 */
  planTool: PlanTool;
  /** 전기 도구로 찍을 때 놓을 설비 종류 */
  electricalKind: ElectricalKind;
  /** 격자 스냅 간격 (mm). 0이면 스냅하지 않는다 */
  snapMm: number;
  /**
   * 밑그림 축척을 두 점으로 맞추는 중인가.
   *
   * 리본에서 시작하고 평면 편집기가 점을 받는다 — 두 곳이 같은 값을 봐야 해서
   * 편집기의 지역 상태로 둘 수 없다.
   */
  underlayCalibrating: boolean;
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
  /** 평면도·입면도 확대 배율 (하단 바에서 조작) */
  zoom: number;
  /**
   * 이미지 보기를 화면에 맞추는 함수 (Canvas2D가 등록).
   *
   * 열 때는 언제나 100% 로 연다 — 자동으로 줄여 놓으면 사용자가 지금 보는 것이
   * 원본 크기인지 우리가 줄인 것인지 알 수 없다. 대신 큰 도면을 한눈에 보고 싶을 때
   * 한 번 누르면 맞춰 준다.
   */
  fitView: (() => void) | null;
  /**
   * 들여오기 창이 열려 있는가.
   *
   * 도면·사진을 넣는 길은 새 프로젝트를 열었을 때만 나오면 안 된다. 빈 프로젝트에도
   * 기본 벽 넉 장이 서 있어서 시작 화면이 뜨지 않았고, 그래서 사진을 올릴 방법이
   * 화면 어디에도 없었다. 리본의 "가져오기" 로 언제든 다시 연다.
   */
  importOpen: boolean;
  /** 2안 비교 결과 — 고르기 전까지 장면에는 반영하지 않는다 */
  variants: { label: string; imageUrl: string }[] | null;
  /**
   * 도면 비교 보정 결과.
   *
   * 무엇을 고쳤고 무엇을 왜 안 고쳤는지 보여 준다. 토스트 한 줄로는 "거부 1건"의
   * 이유를 담을 수 없는데, 사용자가 가장 궁금해하는 것이 그 이유다.
   */

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
  setZoom: (zoom: number) => void;
  setFitView: (fit: (() => void) | null) => void;
  setImportOpen: (open: boolean) => void;
  setPlanTool: (tool: PlanTool) => void;
  setElectricalKind: (kind: ElectricalKind) => void;
  setSnapMm: (snap: number) => void;
  setUnderlayCalibrating: (value: boolean) => void;
  /** 밑그림을 켜고 끈다. 아직 깔려 있지 않으면 이미지를 방 크기에 맞춰 깔면서 켠다 */
  toggleUnderlay: () => Promise<void>;
  setActiveLevel: (levelId: string | null) => void;
  setVariants: (variants: { label: string; imageUrl: string }[] | null) => void;
  applyVariant: (variant: { label: string; imageUrl: string }) => Promise<void>;
  placeAsset: (args: Record<string, unknown>, clientX: number, clientY: number) => Promise<void>;
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
  /** 확인 창에서 "진행"을 눌렀을 때 */
  confirmCharge: () => Promise<void>;
  /** 확인 창을 닫는다 — 아무 일도 일어나지 않는다 */
  cancelCharge: () => void;
  saveVersion: (label: string) => Promise<void>;
  reload: () => Promise<void>;
}

/**
 * 물어보고 나서 할 일.
 *
 * 확인 창은 이 값이 있을 때만 뜬다. "진행"을 누르면 proceed 를 부르고 값을 비운다.
 * 잔액은 창을 열 때 서버에서 새로 받아 온다 — 편집기는 잔액을 들고 있지 않고,
 * 들고 있더라도 다른 탭에서 쓴 것까지는 모른다.
 */
export interface PendingCharge {
  /** 이 작업에 드는 크레딧 */
  cost: number;
  /** 무슨 작업인지 (예: 실사 렌더) */
  label: string;
  /** 확인하면 실제로 할 일 */
  proceed: () => Promise<unknown>;
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
  pendingCharge: null,
  clipboard: null,
  showGrid: true,
  planTool: "select",
  electricalKind: "outlet",
  snapMm: 100,
  underlayCalibrating: false,
  activeLevelId: null,
  renderUrl: null,
  viewportCapture: null,
  viewportExport: null,
  viewportRaycast: null,
  zoom: 1,
  fitView: null,
  importOpen: false,
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
      /* 프로젝트를 열 때는 언제나 100% 다 — 앞 프로젝트에서 줄여 놓은 배율을 물려받지 않는다 */
      zoom: 1,
    }),

  setScene: (scene) => set({ scene }),
  select: (ids) => set({ selectedIds: ids }),
  toggleSelect: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((value) => value !== id)
        : [...state.selectedIds, id],
    })),
  /*
   * 걷기로 들어갈 때는 선택을 푼다.
   *
   * 눈높이에서 돌아다니는데 가구 하나에 선택 테두리가 켜져 있으면 그것만 눈에 띈다.
   * 걷기는 보는 모드지 고치는 모드가 아니다.
   */
  setViewMode: (viewMode) =>
    set(viewMode === "walk" ? { viewMode, selectedIds: [] } : { viewMode }),
  setTool: (tool) => set({ tool }),
  setBusy: (busy) => set({ busy }),
  setMessage: (lastMessage) => set({ lastMessage }),
  toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
  setRenderUrl: (renderUrl) => set({ renderUrl }),
  setViewportCapture: (viewportCapture) => set({ viewportCapture }),
  setViewportExport: (viewportExport) => set({ viewportExport }),
  setViewportRaycast: (viewportRaycast) => set({ viewportRaycast }),
  /*
   * 축소 한계를 0.4 에서 0.08 로 내린다.
   *
   * 도면은 사진보다 훨씬 크다. 66.8m 짜리 평면도를 40% 로 봐도 화면에 안 들어와서,
   * 사용자가 더 줄이려 해도 바닥에 걸려 안 줄어들었다 — "너무 크게 확대해서 본다" 는
   * 것이 이 바닥값이었다. 확대 쪽은 그대로 3배까지 둔다.
   */
  setZoom: (zoom) => set({ zoom: Math.min(3, Math.max(0.08, zoom)) }),
  setFitView: (fitView) => set({ fitView }),
  setImportOpen: (importOpen) => set({ importOpen }),
  setPlanTool: (planTool) => set({ planTool }),
  setElectricalKind: (electricalKind) => set({ electricalKind }),
  setSnapMm: (snapMm) => set({ snapMm: Math.max(0, snapMm) }),

  setUnderlayCalibrating: (underlayCalibrating) => set({ underlayCalibrating }),

  toggleUnderlay: async () => {
    const { scene, runTool } = get();
    const underlay = scene?.room?.underlay;

    if (underlay) {
      await runTool("set_underlay", { visible: !underlay.visible });
      return;
    }

    /*
     * 아직 안 깔려 있으면 지금 깐다.
     *
     * 분석 때 초기 정합을 채우지만, 그 전에 올린 프로젝트에는 없다. 그때는 이미지를
     * 방 크기에 대충 맞춰 놓는다 — 맞는 값일 리 없고, 사용자가 두 점을 찍어 맞출
     * 출발점일 뿐이다. 아무 데도 안 보이면 "고장 났다"로 읽힌다.
     */
    const image = { width: scene?.source?.width ?? 0, height: scene?.source?.height ?? 0 };
    const placed = underlayFitToRoom(image, scene.room.dimensions);
    if (!placed) {
      set({ lastMessage: "원본 이미지 크기를 알 수 없어 밑그림을 깔지 못했습니다." });
      return;
    }

    await runTool("set_underlay", {
      originXMm: placed.originMm[0],
      originYMm: placed.originMm[1],
      mmPerPixel: placed.mmPerPixel,
      visible: true,
    });
  },
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
  placeAsset: async (args, clientX, clientY) => {
    const { viewportRaycast, runTool } = get();
    const hit = viewportRaycast?.(clientX, clientY) ?? null;

    const result = await runTool("add_object", args);
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
    if (!get().pendingCharge) {
      // AI 명령도 크레딧을 쓴다 — 텍스트라 싸지만 공짜는 아니다
      return new Promise((resolve) => {
        set({
          pendingCharge: {
            ...COMMAND_CHARGE,
            proceed: async () => resolve(await get().runCommand(instruction)),
          },
        });
      });
    }

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
  confirmCharge: async () => {
    const pending = get().pendingCharge;
    if (!pending) return;

    /*
     * 일이 끝난 뒤에 비운다.
     *
     * proceed 는 startJob·runCommand 를 다시 부르는데, 그 안의 가드가 "물어볼 것이
     * 남아 있으면 그냥 진행"으로 되어 있다. 먼저 비우면 가드가 다시 걸려 확인 창이
     * 한 번 더 뜬다 — 눌러도 안 되는 버튼이 된다.
     */
    try {
      await pending.proceed();
    } finally {
      set({ pendingCharge: null });
    }
  },

  cancelCharge: () => set({ pendingCharge: null }),

  startJob: async (path, body) => {
    /*
     * 크레딧이 드는 일이면 먼저 묻는다.
     *
     * 여기 한 곳에서 막으면 리본·좌측 패널·속성 패널·온보딩이 한꺼번에 덮인다.
     * 버튼마다 확인 창을 달면 새 버튼이 생길 때마다 빠뜨린다.
     */
    const charge = chargeForJob(path);
    if (charge.cost > 0 && !get().pendingCharge) {
      set({
        pendingCharge: {
          ...charge,
          proceed: () => get().startJob(path, body),
        },
      });
      return null;
    }

    const { projectId, viewMode, viewportCapture } = get();

    // 렌더는 지금 보고 있는 3D 화면을 캡처해 실사 변환의 기준으로 넘긴다.
    let payload = body;
    // 걷기 시점을 그대로 렌더로 넘길 수 있어야 한다 — 이 모드의 큰 쓸모다
    if (
      path.startsWith("/render") &&
      (viewMode === "3d" || viewMode === "walk") &&
      viewportCapture
    ) {
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
/**
 * 잡이 끝날 때까지 상태를 물어본다.
 *
 * ── 예전에 이래서 실패했다 ──
 *
 * 끝을 못 보고 반복문을 빠져나오면 `busy` 를 아무도 지우지 않았다. 그러면 화면 위쪽에
 * "원본 도면과 비교하고 있습니다..." 가 영원히 돌아간다. 실제로는 서버에서 이미 끝난
 * 뒤였는데, 사용자에게는 몇 분째 API 를 부르고 있는 것처럼 보인다.
 *
 * 빠져나오는 길이 두 개였다.
 *
 *  1. 잡을 못 찾음(404). 큐가 서버 프로세스 안에 있어서, 서버가 다시 뜨면 돌던 잡이
 *     통째로 사라진다. 배포하거나 개발 중에 서버를 재시작하면 바로 이 상태가 된다.
 *  2. 시간 초과. 84초에 끊었는데, 도면 분석은 이제 치수 체인·배치·비교까지 세 번을
 *     부르므로 그보다 오래 걸린다.
 *
 * 이제 둘 다 busy 를 지우고 무슨 일인지 알려 준다. 화면은 한 번 새로 읽어 온다 —
 * 우리가 못 보는 사이에 서버가 끝내 놓았을 수 있고, 그러면 결과가 이미 저장돼 있다.
 */
async function trackJob(
  job: Job,
  set: (partial: Partial<EditorState>) => void,
  get: () => EditorState
): Promise<void> {
  /** 이만큼까지 기다린다 (ms). 분석은 AI 를 세 번 부르므로 넉넉히 잡는다 */
  const DEADLINE_MS = 5 * 60 * 1000;
  /** 처음에는 자주, 그 뒤에는 뜸하게 — 오래 걸리는 잡에 700ms 폴링은 낭비다 */
  const step = (elapsed: number) => (elapsed < 20_000 ? 700 : 2_000);

  let current = job;
  let ended: "done" | "missing" | "timeout" = "timeout";
  const startedAt = Date.now();

  while (Date.now() - startedAt < DEADLINE_MS) {
    await new Promise((resolve) => setTimeout(resolve, step(Date.now() - startedAt)));

    const response = await fetch(`/api/jobs/status/${job.id}`, { cache: "no-store" });
    if (!response.ok) {
      ended = "missing";
      break;
    }

    current = (await response.json()) as Job;
    set({ busy: current.state === "completed" ? null : current.message });

    if (current.state === "completed" || current.state === "failed") {
      ended = "done";
      break;
    }
  }

  if (ended === "missing") {
    /*
     * 잡이 사라졌다 — 대개 서버가 다시 떴다는 뜻이다. 일이 끝났는지는 알 수 없지만
     * 저장은 서버가 하므로, 화면을 다시 읽어 보면 결과가 들어와 있을 수도 있다.
     */
    await get().reload();
    set({ busy: null, lastMessage: "작업 상태를 잃었습니다 — 서버가 다시 시작된 것 같습니다." });
    return;
  }

  if (ended === "timeout") {
    await get().reload();
    set({ busy: null, lastMessage: "작업이 오래 걸립니다 — 잠시 후 새로고침해 주세요." });
    return;
  }

  if (current.state === "completed") {
    const result = current.result as {
      imageUrl?: string;
      quality?: string;
      variants?: { label: string; imageUrl: string }[];
      summary?: string;
      applied?: number;
      /** 분석이 남긴 안내 (해상도가 모자라 못 읽은 것 등) */
      notice?: string;
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

    /*
     * 안내가 있으면 "완료" 대신 그것을 띄운다.
     *
     * 해상도가 모자라 실이 빠졌는데 "완료되었습니다" 만 뜨면, 사용자는 우리가 못 읽은
     * 것인지 자기 도면이 원래 그런 것인지 알 수 없다.
     */
    set({ busy: null, lastMessage: result?.notice ?? "완료되었습니다." });
  } else {
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
