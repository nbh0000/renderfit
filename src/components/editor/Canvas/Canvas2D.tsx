"use client";

import { useCallback, useRef, useState } from "react";
import { useEditorStore } from "@/lib/editor/store";
import type { SceneObject } from "@/scene/types";
import { PlanMinimap } from "./PlanMinimap";

/**
 * 2.5D 캔버스.
 *
 * 배경 이미지 위에 Scene 객체를 레이어로 얹고, 선택·이동·회전·크기 조절을 지원한다.
 * 드래그 중에는 로컬 draft로 즉시 반응하고, 놓는 순간 Scene Engine에 operation 하나로 커밋한다.
 */

type DragMode = "move" | "scale" | "rotate";

interface DragState {
  id: string;
  mode: DragMode;
  startX: number;
  startY: number;
  origin: SceneObject["screen"];
}

export function Canvas2D() {
  const scene = useEditorStore((state) => state.scene);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const select = useEditorStore((state) => state.select);
  const toggleSelect = useEditorStore((state) => state.toggleSelect);
  const runTool = useEditorStore((state) => state.runTool);
  const showGrid = useEditorStore((state) => state.showGrid);
  const viewMode = useEditorStore((state) => state.viewMode);
  const zoom = useEditorStore((state) => state.zoom);
  const setZoom = useEditorStore((state) => state.setZoom);

  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [draft, setDraft] = useState<{ id: string; screen: SceneObject["screen"] } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);

  const background =
    scene?.source?.generatedImageUrl ?? scene?.source?.imageUrl ?? null;

  const objects = (scene?.objects ?? [])
    .filter((object) => object.visibility)
    .sort((a, b) => b.depth - a.depth || a.order - b.order);

  const screenOf = (object: SceneObject) =>
    draft && draft.id === object.id ? draft.screen : object.screen;

  const materialColor = useCallback(
    (object: SceneObject) => {
      if (!object.materialId) return "#8b857d";
      return scene.materials.find((m) => m.id === object.materialId)?.baseColor ?? "#8b857d";
    },
    [scene]
  );

  const onPointerDownObject = (event: React.PointerEvent, object: SceneObject, mode: DragMode) => {
    if (object.locked && mode !== "move") return;
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

    if (event.shiftKey) toggleSelect(object.id);
    else select([object.id]);

    if (object.locked) return;

    dragRef.current = {
      id: object.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...object.screen },
    };
    setDraft({ id: object.id, screen: { ...object.screen } });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (panRef.current) {
      setPan({
        x: panRef.current.x + (event.clientX - panRef.current.startX),
        y: panRef.current.y + (event.clientY - panRef.current.startY),
      });
      return;
    }

    const drag = dragRef.current;
    const frame = frameRef.current;
    if (!drag || !frame) return;

    const rect = frame.getBoundingClientRect();
    const dx = (event.clientX - drag.startX) / rect.width;
    const dy = (event.clientY - drag.startY) / rect.height;

    if (drag.mode === "move") {
      setDraft({
        id: drag.id,
        screen: {
          ...drag.origin,
          x: clamp01(drag.origin.x + dx),
          y: clamp01(drag.origin.y + dy),
        },
      });
    } else if (drag.mode === "scale") {
      const factor = Math.max(0.2, 1 + (dx + dy));
      setDraft({
        id: drag.id,
        screen: {
          ...drag.origin,
          width: Math.max(0.02, drag.origin.width * factor),
          height: Math.max(0.02, drag.origin.height * factor),
        },
      });
    } else {
      const centerX = rect.left + (drag.origin.x + drag.origin.width / 2) * rect.width;
      const centerY = rect.top + (drag.origin.y + drag.origin.height / 2) * rect.height;
      const angle =
        (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) / Math.PI + 90;
      setDraft({ id: drag.id, screen: { ...drag.origin, rotation: angle } });
    }
  };

  const onPointerUp = async () => {
    panRef.current = null;

    const drag = dragRef.current;
    const current = draft;
    dragRef.current = null;

    if (!drag || !current) {
      setDraft(null);
      return;
    }

    // 변화가 거의 없으면 operation을 만들지 않는다 (히스토리 오염 방지).
    const moved =
      Math.abs(current.screen.x - drag.origin.x) > 0.001 ||
      Math.abs(current.screen.y - drag.origin.y) > 0.001;
    const scaled = Math.abs(current.screen.width - drag.origin.width) > 0.001;
    const rotated = Math.abs(current.screen.rotation - drag.origin.rotation) > 0.5;

    if (drag.mode === "move" && moved) {
      await runTool("move_object", {
        objectId: drag.id,
        dx: current.screen.x - drag.origin.x,
        dy: current.screen.y - drag.origin.y,
      });
    } else if (drag.mode === "scale" && scaled) {
      await runTool("scale_object", {
        objectId: drag.id,
        factor: current.screen.width / drag.origin.width,
      });
    } else if (drag.mode === "rotate" && rotated) {
      await runTool("rotate_object", {
        objectId: drag.id,
        degrees: current.screen.rotation - drag.origin.rotation,
      });
    }

    setDraft(null);
  };

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[#0a0a0a]"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      onWheel={(event) => {
        if (!event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        setZoom(zoom - event.deltaY * 0.001);
      }}
      onPointerDown={(event) => {
        // 빈 곳을 누르면 선택 해제 + 공간 이동 시작
        if (event.target === event.currentTarget || (event.target as HTMLElement).dataset.canvasBg) {
          select([]);
          panRef.current = { x: pan.x, y: pan.y, startX: event.clientX, startY: event.clientY };
        }
      }}
    >
      <div
        data-canvas-bg
        className="absolute inset-0 flex items-center justify-center p-6"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        <div
          ref={frameRef}
          className="relative w-full max-w-[1100px] overflow-hidden rounded-lg bg-[#141414] shadow-[0_20px_60px_rgba(0,0,0,0.45)]"
          style={{ aspectRatio: `${scene?.source?.width ?? 4} / ${scene?.source?.height ?? 3}` }}
        >
          {background ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={background}
              alt="장면 배경"
              className="absolute inset-0 h-full w-full object-cover"
              draggable={false}
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center text-[13px] text-white/50">
              방 사진을 업로드하면 여기에 표시됩니다
            </div>
          )}

          {showGrid && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.18]"
              style={{
                backgroundImage:
                  "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
                backgroundSize: "10% 10%",
              }}
            />
          )}

          {/* 객체 레이어 — image 모드에서는 오버레이를 숨긴다 */}
          {viewMode !== "image" &&
            objects.map((object) => {
              const screen = screenOf(object);
              const selected = selectedIds.includes(object.id);
              const color = materialColor(object);

              return (
                <div
                  key={object.id}
                  onPointerDown={(event) => onPointerDownObject(event, object, "move")}
                  className={[
                    "absolute touch-none transition-shadow",
                    object.locked ? "cursor-not-allowed" : "cursor-move",
                    selected ? "z-20" : "z-10",
                  ].join(" ")}
                  style={{
                    left: `${screen.x * 100}%`,
                    top: `${screen.y * 100}%`,
                    width: `${screen.width * 100}%`,
                    height: `${screen.height * 100}%`,
                    transform: `rotate(${screen.rotation}deg)`,
                  }}
                >
                  <div
                    className={[
                      "h-full w-full rounded-[4px] border-2",
                      selected
                        ? "border-[#000000] bg-[#000000]/25"
                        : "border-white/30 bg-white/5 hover:border-white/60",
                    ].join(" ")}
                    style={selected ? undefined : { backgroundColor: `${color}33` }}
                  />

                  <span
                    className={[
                      "pointer-events-none absolute -top-5 left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px]",
                      selected ? "bg-[#000000] text-white" : "bg-black/50 text-white/80",
                    ].join(" ")}
                  >
                    {object.name}
                    {object.locked ? " 🔒" : ""}
                  </span>

                  {selected && !object.locked && (
                    <>
                      {/* 크기 조절 핸들 */}
                      <span
                        onPointerDown={(event) => onPointerDownObject(event, object, "scale")}
                        className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border border-white bg-[#000000]"
                      />
                      {/* 회전 핸들 */}
                      <span
                        onPointerDown={(event) => onPointerDownObject(event, object, "rotate")}
                        className="absolute -top-6 left-1/2 h-3.5 w-3.5 -translate-x-1/2 cursor-grab rounded-full border border-white bg-white"
                      />
                    </>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 flex gap-2 text-[11px] text-white/60">
        <span className="rounded bg-black/40 px-2 py-1">{Math.round(zoom * 100)}%</span>
        <span className="rounded bg-black/40 px-2 py-1">
          {viewMode === "image" ? "이미지" : "도면"} · 객체 {objects.length}
        </span>
        <span className="rounded bg-black/40 px-2 py-1">Ctrl+휠 확대 · 빈 곳 드래그로 이동</span>
      </div>

      {/* 사진 위에서는 벽·개구부가 보이지 않으므로 평면 미니맵으로 함께 보여 준다 */}
      {viewMode !== "image" && <PlanMinimap />}
    </div>
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
