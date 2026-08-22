"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "@/lib/editor/store";
import { electricalSpec } from "@/config/electrical";
import {
  ensureRoom,
  levelBelow,
  levelsOf,
  onLevel,
  pointAlongWall,
  polygonArea,
  polygonCentroid,
  toSquareMeters,
} from "@/scene/geometry";
import type { Annotation, RoomArea, SceneObject, WallSegment } from "@/scene/types";
import { orthogonalize, snapPoint, usePlanViewport } from "./usePlanViewport";
import { PlanRulers } from "./PlanRulers";
import {
  findEnclosingLoop,
  hitTest,
  itemsInMarquee,
  magnetToEndpoints,
  ROTATE_OFFSET_PX,
  type HitContext,
  type HitTarget,
} from "./hitTest";

/**
 * 평면도 편집 캔버스.
 *
 * "기능이 있다"가 아니라 "도면을 실제로 그려 낼 수 있다"를 기준으로 만든다.
 *  - 벽: 이어서 계속 긋고, 기존 끝점에 자석처럼 붙고, 길이·각도가 커서 옆에 따라온다
 *  - 선택: 여러 개 고르고(Shift·박스 드래그), 회전·크기 손잡이로 조작하고, 방향키로 미세 이동
 *  - 실: 모서리를 찍어 그리거나, 벽으로 둘러싸인 안쪽을 더블클릭하면 자동으로 잡힌다
 *  - 치수: 시작 → 끝 → 띄울 위치 세 단계로 건축 도면 관행대로 놓는다
 *
 * 좌표는 항상 mm(방 좌측 하단 원점)로 다루고 픽셀 변환은 usePlanViewport가 맡는다.
 * 모든 편집은 Scene operation 하나로 커밋되므로 실행 취소가 그대로 동작한다.
 */

interface Draft {
  points: [number, number][];
  cursor: [number, number] | null;
  /** 치수선 3단계: 두 점을 찍은 뒤 띄울 위치를 고르는 중 */
  awaitingOffset?: boolean;
}

/** 이동을 시작한 시점의 좌표 — 델타를 원본 기준으로 계산해야 커서와 어긋나지 않는다 */
interface Snapshot {
  objectX?: number;
  objectDepth?: number;
  points?: [number, number][];
  wall?: { start: [number, number]; end: [number, number] };
}

type DragMode =
  | { kind: "move"; target: HitTarget; grab: [number, number]; origin: Snapshot }
  | { kind: "rotate"; id: string; center: [number, number]; startAngle: number; origin: number }
  | { kind: "resize"; id: string; center: [number, number]; startDistance: number; origin: number }
  | { kind: "vertex"; target: HitTarget }
  | { kind: "endpoint"; id: string; part: "start" | "end" }
  | { kind: "marquee"; from: [number, number]; to: [number, number] }
  /*
   * 화면 이동.
   * 오른쪽 버튼으로 시작한 이동은 "제자리에서 놓으면 그리기 취소"를 겸하므로
   * 시작 지점을 들고 있다가 놓을 때 움직인 거리를 본다.
   */
  | { kind: "pan"; last: [number, number]; from: [number, number]; rightButton: boolean };

const NUDGE_MM = 50;

/** 이만큼도 안 움직였으면 끈 것이 아니라 누른 것으로 본다 (px) */
const CLICK_SLOP_PX = 4;

export function PlanEditor() {
  const scene = useEditorStore((state) => state.scene);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const select = useEditorStore((state) => state.select);
  const runTool = useEditorStore((state) => state.runTool);
  const planTool = useEditorStore((state) => state.planTool);
  const setPlanTool = useEditorStore((state) => state.setPlanTool);
  const showGrid = useEditorStore((state) => state.showGrid);
  const snapMm = useEditorStore((state) => state.snapMm);
  const activeLevelId = useEditorStore((state) => state.activeLevelId);

  const view = usePlanViewport();
  const { toScreen, toPlan, containerRef, viewport } = view;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [drag, setDrag] = useState<DragMode | null>(null);
  const [hover, setHover] = useState<HitTarget | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  /** 커서 옆에 붙는 실시간 수치 (길이·각도·크기) */
  const [tip, setTip] = useState<{ x: number; y: number; lines: string[] } | null>(null);

  const sceneRoom = scene?.room;
  const room = useMemo(() => (sceneRoom ? ensureRoom(sceneRoom) : null), [sceneRoom]);

  /*
   * 층 필터.
   * 지금 층의 것만 편집 대상으로 두고, 바로 아래 층은 참조용으로 옅게 깐다.
   * 복층에서 위층 벽을 아래층 벽에 맞춰 세울 때 이 밑그림이 없으면 감으로 그리게 된다.
   */
  const levels = useMemo(() => (room ? levelsOf(room) : []), [room]);
  const currentLevelId = activeLevelId ?? levels[0]?.id ?? null;
  const below = useMemo(
    () => (currentLevelId ? levelBelow(levels, currentLevelId) : null),
    [levels, currentLevelId]
  );

  const walls = useMemo(
    () => (currentLevelId ? onLevel(room?.walls ?? [], currentLevelId, levels) : []),
    [room, currentLevelId, levels]
  );
  const areas = useMemo(
    () => (currentLevelId ? onLevel(room?.areas ?? [], currentLevelId, levels) : []),
    [room, currentLevelId, levels]
  );
  const annotations = useMemo(
    () => (currentLevelId ? onLevel(room?.annotations ?? [], currentLevelId, levels) : []),
    [room, currentLevelId, levels]
  );
  const fixtures = useMemo(
    () => (currentLevelId ? onLevel(room?.electrical ?? [], currentLevelId, levels) : []),
    [room, currentLevelId, levels]
  );

  /** 아래층 벽 — 밑그림으로만 쓴다 (선택도 편집도 되지 않는다) */
  const ghostWalls = useMemo(
    () => (below ? onLevel(room?.walls ?? [], below.id, levels) : []),
    [below, room, levels]
  );

  /** 벽 개구부로 옮겨진 창·문은 가구로 또 그리지 않는다 */
  const convertedIds = useMemo(
    () =>
      new Set(
        (room?.walls ?? [])
          .flatMap((wall) => wall.openings ?? [])
          .map((opening) => opening.id)
          .filter((id) => id.startsWith("op_auto_"))
          .map((id) => id.replace("op_auto_", ""))
      ),
    [room]
  );

  const objects = useMemo(() => {
    const visible = (scene?.objects ?? []).filter(
      (object) =>
        object.visibility &&
        object.type !== "wall" &&
        object.type !== "floor" &&
        object.type !== "ceiling" &&
        !convertedIds.has(object.id)
    );
    return currentLevelId ? onLevel(visible, currentLevelId, levels) : visible;
  }, [scene?.objects, currentLevelId, levels, convertedIds]);

  const roomWidthMm = room?.dimensions.width;
  const roomLengthMm = room?.dimensions.length;

  const objectCenter = useCallback(
    (object: SceneObject): [number, number] => [
      (object.screen.x + object.screen.width / 2) * (roomWidthMm ?? 0),
      object.depth * (roomLengthMm ?? 0),
    ],
    [roomWidthMm, roomLengthMm]
  );

  const hitContext = useMemo<HitContext>(
    () => ({
      walls,
      objects,
      areas,
      annotations,
      objectCenter,
      mmPerPixel: 1 / viewport.scale,
      selectedIds,
    }),
    [walls, objects, areas, annotations, objectCenter, viewport.scale, selectedIds]
  );

  /* 캔버스 크기가 바뀌면 방 전체가 보이도록 다시 맞춘다 */
  const fitted = useRef(false);
  useEffect(() => {
    const element = containerRef.current;
    if (!element || !roomWidthMm || !roomLengthMm) return;

    if (!fitted.current) {
      fitted.current = true;
      view.fit(roomWidthMm, roomLengthMm);
    }

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => view.fit(roomWidthMm, roomLengthMm));
    });
    observer.observe(element);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [containerRef, roomWidthMm, roomLengthMm, view]);

  /**
   * 커서 → 도면 좌표.
   * 벽 끝점 자석을 격자 스냅보다 먼저 건다 — 도면이 닫히는 게 격자보다 중요하다.
   */
  const pointerPlan = useCallback(
    (event: { clientX: number; clientY: number }, magnet = true): [number, number] => {
      const raw = toPlan(event.clientX, event.clientY);

      if (magnet) {
        const stuck = magnetToEndpoints(raw, walls, 12 / viewport.scale);
        if (stuck) return stuck;
      }

      const snapped = snapPoint(raw, snapMm);
      return [Math.round(snapped[0]), Math.round(snapped[1])];
    },
    [toPlan, snapMm, walls, viewport.scale]
  );

  const showTip = (event: { clientX: number; clientY: number }, lines: string[]) => {
    const rect = containerRef.current?.getBoundingClientRect();
    setTip({
      x: event.clientX - (rect?.left ?? 0) + 16,
      y: event.clientY - (rect?.top ?? 0) + 16,
      lines,
    });
  };

  /* ────────────────────────── 커밋 ────────────────────────── */

  const commitWall = useCallback(
    async (from: [number, number], to: [number, number]) => {
      if (Math.hypot(to[0] - from[0], to[1] - from[1]) < 100) return false;
      const result = await runTool("add_wall", {
        x1: Math.round(from[0]),
        y1: Math.round(from[1]),
        x2: Math.round(to[0]),
        y2: Math.round(to[1]),
        ...(currentLevelId ? { levelId: currentLevelId } : {}),
      });
      if (!result.ok) setHint(result.message);
      return result.ok;
    },
    [runTool, currentLevelId]
  );

  const commitArea = useCallback(
    async (points: [number, number][], suggested?: string) => {
      if (polygonArea(points) < 100_000) {
        setHint("실이 너무 작습니다");
        return;
      }
      const name = window.prompt("실 이름", suggested ?? "거실")?.trim();
      if (!name) return;
      setHint(
        (
          await runTool("add_room_area", {
            name,
            points,
            ...(currentLevelId ? { levelId: currentLevelId } : {}),
          })
        ).message
      );
    },
    [runTool, currentLevelId]
  );

  const commitAnnotation = useCallback(
    async (
      type: Annotation["type"],
      points: [number, number][],
      extra?: Record<string, unknown>
    ) => {
      setHint(
        (
          await runTool("add_annotation", {
            type,
            points,
            ...(currentLevelId ? { levelId: currentLevelId } : {}),
            ...extra,
          })
        ).message
      );
    },
    [runTool, currentLevelId]
  );

  /* ────────────────────────── 드래그 시작 ────────────────────────── */

  const beginDragFor = useCallback(
    (target: HitTarget, point: [number, number]): DragMode | null => {
      if (target.kind === "object") {
        const object = objects.find((item) => item.id === target.id);
        if (!object) return null;
        const center = objectCenter(object);

        if (target.part === "rotate") {
          return {
            kind: "rotate",
            id: target.id,
            center,
            startAngle: Math.atan2(point[1] - center[1], point[0] - center[0]),
            origin: object.screen.rotation,
          };
        }
        if (target.part === "resize") {
          return {
            kind: "resize",
            id: target.id,
            center,
            startDistance: Math.hypot(point[0] - center[0], point[1] - center[1]) || 1,
            origin: object.transform.scale[0],
          };
        }
        return {
          kind: "move",
          target,
          grab: point,
          origin: { objectX: object.screen.x, objectDepth: object.depth },
        };
      }

      if (target.kind === "wall") {
        const wall = walls.find((item) => item.id === target.id);
        if (!wall) return null;
        if (target.part === "start" || target.part === "end") {
          return { kind: "endpoint", id: target.id, part: target.part };
        }
        return {
          kind: "move",
          target,
          grab: point,
          origin: { wall: { start: wall.start, end: wall.end } },
        };
      }

      if (target.kind === "area") {
        const area = areas.find((item) => item.id === target.id);
        if (!area) return null;
        if (target.part === "vertex") return { kind: "vertex", target };
        return { kind: "move", target, grab: point, origin: { points: area.points } };
      }

      const annotation = annotations.find((item) => item.id === target.id);
      if (!annotation) return null;
      if (target.part === "vertex") return { kind: "vertex", target };
      return { kind: "move", target, grab: point, origin: { points: annotation.points } };
    },
    [annotations, areas, objectCenter, objects, walls]
  );

  /* ────────────────────────── 포인터 ────────────────────────── */

  const onPointerDown = (event: React.PointerEvent) => {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

    if (event.button === 1 || event.button === 2) {
      setDrag({
        kind: "pan",
        last: [event.clientX, event.clientY],
        from: [event.clientX, event.clientY],
        rightButton: event.button === 2,
      });
      return;
    }
    if (event.button !== 0) return;

    const point = pointerPlan(event);

    if (planTool === "select") {
      const target = hitTest(pointerPlan(event, false), hitContext);

      if (!target) {
        if (!event.shiftKey) select([]);
        setDrag({ kind: "marquee", from: point, to: point });
        return;
      }

      if (event.shiftKey) {
        select(
          selectedIds.includes(target.id)
            ? selectedIds.filter((id) => id !== target.id)
            : [...selectedIds, target.id]
        );
        return;
      }

      if (!selectedIds.includes(target.id)) select([target.id]);
      const mode = beginDragFor(target, point);
      if (mode) setDrag(mode);
      return;
    }

    if (planTool === "text") {
      const text = window.prompt("도면에 넣을 문구");
      if (text?.trim()) void commitAnnotation("text", [point], { text: text.trim() });
      return;
    }

    if (planTool === "dimension") {
      setDraft((current) => {
        if (!current) return { points: [point], cursor: point };

        if (!current.awaitingOffset) {
          const end = event.shiftKey ? point : orthogonalize(current.points[0], point);
          if (Math.hypot(end[0] - current.points[0][0], end[1] - current.points[0][1]) < 100) {
            setHint("두 점이 너무 가깝습니다");
            return null;
          }
          return { points: [current.points[0], end], cursor: point, awaitingOffset: true };
        }

        const offset = offsetFromLine(current.points[0], current.points[1], point);
        void commitAnnotation("dimension", current.points, { offset: Math.round(offset) });
        return null;
      });
      return;
    }

    /* 벽·실·폴리라인 — 점을 이어 찍는다 */
    setDraft((current) => {
      if (!current) return { points: [point], cursor: point };

      const last = current.points[current.points.length - 1];
      const next = event.shiftKey || planTool !== "wall" ? point : orthogonalize(last, point);

      // 벽은 찍는 즉시 하나씩 완성되고, 그 끝점이 다음 벽의 시작점이 된다.
      if (planTool === "wall") void commitWall(last, next);

      return { points: [...current.points, next], cursor: next };
    });
  };

  const applyDrag = useCallback(
    async (mode: DragMode, point: [number, number]): Promise<string[] | null> => {
      if (mode.kind === "rotate") {
        const object = objects.find((item) => item.id === mode.id);
        if (!object) return null;

        const angle = Math.atan2(point[1] - mode.center[1], point[0] - mode.center[0]);
        const delta = ((angle - mode.startAngle) * 180) / Math.PI;
        // 15도 단위로 떨어뜨리면 손으로도 반듯하게 맞출 수 있다.
        const target = Math.round((mode.origin + delta) / 15) * 15;
        const diff = target - object.screen.rotation;

        if (Math.abs(diff) >= 1) {
          await runTool("rotate_object", { objectId: mode.id, degrees: diff });
        }
        return [`각도 ${(((target % 360) + 360) % 360).toFixed(0)}°`];
      }

      if (mode.kind === "resize") {
        const object = objects.find((item) => item.id === mode.id);
        if (!object) return null;

        const distance = Math.hypot(point[0] - mode.center[0], point[1] - mode.center[1]);
        const wanted = Math.min(4, Math.max(0.3, (mode.origin * distance) / mode.startDistance));
        const factor = wanted / object.transform.scale[0];

        if (Math.abs(factor - 1) >= 0.02) {
          await runTool("scale_object", { objectId: mode.id, factor });
        }
        return [
          `폭 ${Math.round(object.dimensions.width * wanted)}mm`,
          `깊이 ${Math.round(object.dimensions.depth * wanted)}mm`,
        ];
      }

      if (mode.kind === "endpoint") {
        const wall = walls.find((item) => item.id === mode.id);
        if (!wall) return null;

        const start = mode.part === "start" ? point : wall.start;
        const end = mode.part === "end" ? point : wall.end;
        await runTool("update_wall", { wallId: mode.id, start, end });
        return [describeSegment(start, end)];
      }

      if (mode.kind === "vertex") {
        const { target } = mode;
        // 꼭짓점 드래그는 실·주석에만 있다 (벽은 끝점 모드로 따로 처리한다)
        if (target.kind !== "area" && target.kind !== "annotation") return null;
        if (target.vertex === undefined) return null;

        if (target.kind === "area") {
          const area = areas.find((item) => item.id === target.id);
          if (!area) return null;
          const points = area.points.map((v, i) => (i === target.vertex ? point : v));
          await runTool("update_room_area", { areaId: target.id, points });
          return [`${toSquareMeters(polygonArea(points)).toFixed(1)}㎡`];
        }

        if (target.kind === "annotation") {
          const annotation = annotations.find((item) => item.id === target.id);
          if (!annotation) return null;
          const points = annotation.points.map((v, i) => (i === target.vertex ? point : v));
          await runTool("update_annotation", { annotationId: target.id, points });
        }
        return null;
      }

      if (mode.kind !== "move") return null;

      const dx = point[0] - mode.grab[0];
      const dy = point[1] - mode.grab[1];
      const { target, origin } = mode;

      if (target.kind === "object" && roomWidthMm && roomLengthMm) {
        await runTool("move_object", {
          objectId: target.id,
          x: Math.min(1, Math.max(0, (origin.objectX ?? 0) + dx / roomWidthMm)),
          depth: Math.min(1, Math.max(0, (origin.objectDepth ?? 0) + dy / roomLengthMm)),
        });
        return [`이동 ${Math.round(dx)} · ${Math.round(dy)}mm`];
      }

      if (target.kind === "wall" && origin.wall) {
        await runTool("update_wall", {
          wallId: target.id,
          start: [Math.round(origin.wall.start[0] + dx), Math.round(origin.wall.start[1] + dy)],
          end: [Math.round(origin.wall.end[0] + dx), Math.round(origin.wall.end[1] + dy)],
        });
        return [`이동 ${Math.round(dx)} · ${Math.round(dy)}mm`];
      }

      if (!origin.points) return null;
      const moved = origin.points.map(
        ([x, y]) => [Math.round(x + dx), Math.round(y + dy)] as [number, number]
      );

      if (target.kind === "area") {
        await runTool("update_room_area", { areaId: target.id, points: moved });
      } else if (target.kind === "annotation") {
        await runTool("update_annotation", { annotationId: target.id, points: moved });
      }
      return [`이동 ${Math.round(dx)} · ${Math.round(dy)}mm`];
    },
    [annotations, areas, objects, roomLengthMm, roomWidthMm, runTool, walls]
  );

  /**
   * 그리던 것을 물린다.
   *
   * 그리는 중이면 그 도형만 버리고 도구는 남긴다 — 이어서 새로 그릴 수 있다.
   * 그리는 중이 아니면 도구 자체를 놓는다 (Esc와 같은 자리).
   */
  const cancelDrawing = useCallback(() => {
    if (draft) {
      setDraft(null);
      setTip(null);
      setHint("그리기를 취소했습니다");
      return;
    }
    if (planTool !== "select") setPlanTool("select");
  }, [draft, planTool, setPlanTool]);

  const onPointerMove = (event: React.PointerEvent) => {
    if (drag?.kind === "pan") {
      view.panBy(event.clientX - drag.last[0], event.clientY - drag.last[1]);
      setDrag({ ...drag, last: [event.clientX, event.clientY] });
      return;
    }

    if (drag?.kind === "marquee") {
      setDrag({ ...drag, to: pointerPlan(event, false) });
      return;
    }

    if (drag) {
      void applyDrag(drag, pointerPlan(event)).then((lines) => {
        if (lines) showTip(event, lines);
      });
      return;
    }

    if (draft) {
      const cursor = pointerPlan(event);
      setDraft({ ...draft, cursor });

      if (draft.awaitingOffset) {
        showTip(event, [`띄울 거리 ${Math.abs(Math.round(offsetFromLine(draft.points[0], draft.points[1], cursor)))}mm`]);
      } else {
        const from = draft.points[draft.points.length - 1];
        const target = event.shiftKey || planTool !== "wall" ? cursor : orthogonalize(from, cursor);
        showTip(event, describeSegment(target, from).split(" · "));
      }
      return;
    }

    setTip(null);
    if (planTool === "select") setHover(hitTest(pointerPlan(event, false), hitContext));
  };

  const onPointerUp = (event: React.PointerEvent) => {
    if (drag?.kind === "marquee") {
      const ids = itemsInMarquee(drag.from, drag.to, hitContext);
      if (ids.length > 0) select(ids);
    }

    /*
     * 우클릭으로 그리기를 빠져나간다.
     *
     * 벽·실·폴리라인은 더블클릭해야 끝나서, 한 번 시작하면 그 전까지 다른 일을 할 수 없었다.
     * 끌지 않고 제자리에서 뗀 우클릭만 취소로 본다 — 우클릭 드래그는 그대로 화면 이동이다.
     */
    if (drag?.kind === "pan" && drag.rightButton) {
      const moved = Math.hypot(event.clientX - drag.from[0], event.clientY - drag.from[1]);
      if (moved <= CLICK_SLOP_PX) cancelDrawing();
    }

    setDrag(null);
    setTip(null);
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  };

  /** 더블클릭 — 그리기 마무리, 또는 벽 안쪽에서 실 자동 인식 */
  const onDoubleClick = (event: React.MouseEvent) => {
    if (draft) {
      if (planTool === "polyline" && draft.points.length >= 2) {
        void commitAnnotation("polyline", draft.points);
      }
      if (planTool === "room" && draft.points.length >= 3) {
        void commitArea(draft.points);
      }
      setDraft(null);
      return;
    }

    if (planTool === "room" || planTool === "select") {
      const loop = findEnclosingLoop(pointerPlan(event, false), walls);
      if (loop) {
        void commitArea(loop);
        return;
      }
      if (planTool === "room") setHint("둘러싸인 벽을 찾지 못했습니다. 모서리를 직접 찍어 주세요.");
    }
  };

  /* ────────────────────────── 키보드 ────────────────────────── */

  const nudge = useCallback(
    async (dx: number, dy: number) => {
      for (const id of selectedIds) {
        const object = objects.find((item) => item.id === id);
        if (object && roomWidthMm && roomLengthMm) {
          await runTool("move_object", {
            objectId: id,
            x: Math.min(1, Math.max(0, object.screen.x + dx / roomWidthMm)),
            depth: Math.min(1, Math.max(0, object.depth + dy / roomLengthMm)),
          });
          continue;
        }

        const wall = walls.find((item) => item.id === id);
        if (wall) {
          await runTool("update_wall", {
            wallId: id,
            start: [wall.start[0] + dx, wall.start[1] + dy],
            end: [wall.end[0] + dx, wall.end[1] + dy],
          });
          continue;
        }

        const area = areas.find((item) => item.id === id);
        if (area) {
          await runTool("update_room_area", {
            areaId: id,
            points: area.points.map(([x, y]) => [x + dx, y + dy]),
          });
          continue;
        }

        const annotation = annotations.find((item) => item.id === id);
        if (annotation) {
          await runTool("update_annotation", {
            annotationId: id,
            points: annotation.points.map(([x, y]) => [x + dx, y + dy]),
          });
        }
      }
    },
    [annotations, areas, objects, roomLengthMm, roomWidthMm, runTool, selectedIds, walls]
  );

  const removeSelected = useCallback(async () => {
    for (const id of selectedIds) {
      if (areas.some((item) => item.id === id)) {
        await runTool("delete_room_area", { areaId: id });
      } else if (annotations.some((item) => item.id === id)) {
        await runTool("delete_annotation", { annotationId: id });
      } else if (walls.some((item) => item.id === id)) {
        await runTool("delete_wall", { wallId: id });
      } else {
        await runTool("delete_object", { objectId: id });
      }
    }
    select([]);
  }, [annotations, areas, runTool, select, selectedIds, walls]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (event.key === "Escape") {
        setDraft(null);
        setDrag(null);
        setPlanTool("select");
        return;
      }

      // 그리는 중 Backspace는 마지막 점만 되돌린다.
      if (event.key === "Backspace" && draft) {
        event.preventDefault();
        setDraft((current) => {
          if (!current) return null;
          const points = current.points.slice(0, -1);
          return points.length ? { ...current, points, awaitingOffset: false } : null;
        });
        return;
      }

      const step = event.shiftKey ? NUDGE_MM * 10 : NUDGE_MM;
      const arrows: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, step],
        ArrowDown: [0, -step],
      };
      if (arrows[event.key] && selectedIds.length > 0) {
        event.preventDefault();
        void nudge(arrows[event.key][0], arrows[event.key][1]);
        return;
      }

      if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length > 0) {
        event.preventDefault();
        void removeSelected();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draft, nudge, removeSelected, selectedIds, setPlanTool]);

  if (!room) return null;

  const { width: roomWidth, length: roomLength } = room.dimensions;
  const picking = planTool === "select";

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#f6f6f4]">
      <PlanRulers view={view} width={roomWidth} length={roomLength} />

      <div
        ref={containerRef}
        className="absolute inset-0 touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(event) => event.preventDefault()}
        onWheel={(event) =>
          view.zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 0.89)
        }
        style={{ cursor: cursorFor(planTool, hover, drag) }}
      >
        <svg className="h-full w-full">
          <defs>
            {/* 벽 해치 — 건축 도면에서 절단면을 표시하는 관행 */}
            <pattern id="wall-hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <rect width="6" height="6" fill="#ffffff" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#26231f" strokeWidth="1.6" />
            </pattern>
          </defs>

          {showGrid && <Grid view={view} />}
          <RoomOutline width={roomWidth} length={roomLength} toScreen={toScreen} />

          {/* 아래층 밑그림 */}
          {ghostWalls.map((wall) => {
            const [x1, y1] = toScreen(wall.start[0], wall.start[1]);
            const [x2, y2] = toScreen(wall.end[0], wall.end[1]);
            return (
              <line
                key={`ghost-${wall.id}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#26231f"
                strokeOpacity={0.14}
                strokeWidth={Math.max(2, wall.thickness * viewport.scale)}
                pointerEvents="none"
              />
            );
          })}

          {areas.map((area) => (
            <AreaShape
              key={area.id}
              area={area}
              toScreen={toScreen}
              selected={selectedIds.includes(area.id)}
              hovered={hover?.id === area.id}
            />
          ))}

          {objects.map((object) => (
            <ObjectShape
              key={object.id}
              object={object}
              center={objectCenter(object)}
              toScreen={toScreen}
              scale={viewport.scale}
              selected={selectedIds.includes(object.id)}
              hovered={hover?.id === object.id}
            />
          ))}

          {walls.map((wall) => (
            <WallShape
              key={wall.id}
              wall={wall}
              toScreen={toScreen}
              scale={viewport.scale}
              selected={selectedIds.includes(wall.id)}
              hovered={hover?.id === wall.id}
            />
          ))}

          {fixtures.map((fixture) => {
            const wall = walls.find((item) => item.id === fixture.wallId);
            const [x, y] = wall
              ? pointAlongWall(wall, fixture.offset)
              : (fixture.point ?? [roomWidth / 2, roomLength / 2]);
            const [sx, sy] = toScreen(x, y);
            return (
              <g key={fixture.id} pointerEvents="none">
                <circle cx={sx} cy={sy} r={9} fill="#ffffff" stroke="#1f5f9c" strokeWidth={1.5} />
                <text
                  x={sx}
                  y={sy + 3}
                  fontSize={8}
                  textAnchor="middle"
                  fill="#1f5f9c"
                  fontFamily="Pretendard, sans-serif"
                >
                  {electricalSpec(fixture.kind).symbol}
                </text>
              </g>
            );
          })}

          {annotations.map((annotation) => (
            <AnnotationShape
              key={annotation.id}
              annotation={annotation}
              toScreen={toScreen}
              selected={selectedIds.includes(annotation.id)}
            />
          ))}

          {picking &&
            selectedIds.map((id) => (
              <Handles
                key={id}
                id={id}
                objects={objects}
                walls={walls}
                areas={areas}
                annotations={annotations}
                objectCenter={objectCenter}
                toScreen={toScreen}
                scale={viewport.scale}
              />
            ))}

          {draft && <DraftShape draft={draft} tool={planTool} toScreen={toScreen} />}
          {drag?.kind === "marquee" && <Marquee from={drag.from} to={drag.to} toScreen={toScreen} />}
        </svg>
      </div>

      {/* 커서를 따라다니는 수치 — 값을 보면서 그릴 수 있어야 도면이 나온다 */}
      {tip && (
        <div
          className="pointer-events-none absolute z-20 rounded border border-line bg-surface px-2 py-1 text-[11px] leading-snug tabular-nums text-ink shadow-md"
          style={{ left: tip.x, top: tip.y }}
        >
          {tip.lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[70%] flex-wrap items-center gap-2">
        <span className="rounded bg-ink/75 px-2 py-1 text-[11px] text-white">
          {TOOL_HINT[planTool]}
        </span>
        {hint && (
          <span className="rounded bg-surface px-2 py-1 text-[11px] text-ink shadow-sm">{hint}</span>
        )}
        {selectedIds.length > 1 && (
          <span className="rounded bg-accent px-2 py-1 text-[11px] text-white">
            {selectedIds.length}개 선택
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => view.fit(roomWidth, roomLength)}
        className="absolute bottom-3 right-3 rounded border border-line bg-surface px-2 py-1 text-[11px] text-muted hover:text-ink"
      >
        화면에 맞추기
      </button>
    </div>
  );
}

const TOOL_HINT: Record<string, string> = {
  select:
    "클릭 선택 · Shift 추가 · 빈 곳 드래그로 여러 개 · 방향키 이동 · Delete 삭제 · 벽 안쪽 더블클릭으로 실 만들기",
  wall: "이어서 클릭하면 계속 그립니다 · Shift 각도 자유 · Backspace 한 점 취소 · 우클릭/Esc 취소",
  room: "모서리를 찍고 더블클릭으로 닫기 · 벽 안쪽 더블클릭이면 자동 · 우클릭 취소",
  dimension: "시작 → 끝 → 띄울 위치 순서로 세 번 클릭합니다 · 우클릭 취소",
  text: "클릭한 자리에 문구를 넣습니다 · 우클릭 취소",
  polyline: "여러 점을 찍고 더블클릭으로 끝냅니다 · 우클릭 취소",
};

function cursorFor(tool: string, hover: HitTarget | null, drag: DragMode | null): string {
  if (drag?.kind === "pan") return "grabbing";
  if (tool !== "select") return "crosshair";
  if (drag) return "grabbing";
  if (hover?.kind === "object" && hover.part === "rotate") return "grab";
  if (hover?.kind === "object" && hover.part === "resize") return "nwse-resize";
  if (hover?.part === "start" || hover?.part === "end" || hover?.part === "vertex") return "move";
  return hover ? "pointer" : "default";
}

/** 길이와 각도 — Sweet Home 3D가 커서 옆에 띄우는 두 값 */
function describeSegment(to: [number, number], from: [number, number]): string {
  const length = Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]));
  const angle = Math.round((Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI);
  return `길이 ${length}mm · 각도 ${((angle % 360) + 360) % 360}°`;
}

/** 선분에서 점까지의 부호 있는 거리 — 치수선을 어느 쪽으로 띄울지 정한다 */
function offsetFromLine(a: [number, number], b: [number, number], point: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  return ((point[0] - a[0]) * -dy + (point[1] - a[1]) * dx) / length;
}

/* ───────────────────────────── 조각들 ───────────────────────────── */

function RoomOutline({
  width,
  length,
  toScreen,
}: {
  width: number;
  length: number;
  toScreen: (x: number, y: number) => [number, number];
}) {
  const points: [number, number][] = [
    [0, 0],
    [width, 0],
    [width, length],
    [0, length],
  ];
  return (
    <polygon
      points={points.map(([x, y]) => toScreen(x, y).join(",")).join(" ")}
      fill="#ffffff"
      stroke="#e2e0dc"
      pointerEvents="none"
    />
  );
}

function Grid({ view }: { view: ReturnType<typeof usePlanViewport> }) {
  const { scale } = view.viewport;
  const step = scale > 0.09 ? 100 : scale > 0.03 ? 1000 : 5000;
  const major = step * 10;

  const rect = view.containerRef.current?.getBoundingClientRect();
  if (!rect) return null;

  const [left, top] = view.toPlan(rect.left, rect.top);
  const [right, bottom] = view.toPlan(rect.right, rect.bottom);

  const lines: React.ReactElement[] = [];
  for (let x = Math.floor(left / step) * step; x < right; x += step) {
    const [sx] = view.toScreen(x, 0);
    lines.push(
      <line
        key={`x${x}`}
        x1={sx}
        y1={0}
        x2={sx}
        y2={rect.height}
        stroke={x % major === 0 ? "#dcdad5" : "#ecebe7"}
      />
    );
  }
  for (let y = Math.floor(bottom / step) * step; y < top; y += step) {
    const [, sy] = view.toScreen(0, y);
    lines.push(
      <line
        key={`y${y}`}
        x1={0}
        y1={sy}
        x2={rect.width}
        y2={sy}
        stroke={y % major === 0 ? "#dcdad5" : "#ecebe7"}
      />
    );
  }

  return <g pointerEvents="none">{lines}</g>;
}

function AreaShape({
  area,
  toScreen,
  selected,
  hovered,
}: {
  area: RoomArea;
  toScreen: (x: number, y: number) => [number, number];
  selected: boolean;
  hovered: boolean;
}) {
  const screen = area.points.map(([x, y]) => toScreen(x, y));
  const [cx, cy] = toScreen(...polygonCentroid(area.points));
  const squareMeters = toSquareMeters(polygonArea(area.points));

  return (
    <g pointerEvents="none">
      <polygon
        points={screen.map((point) => point.join(",")).join(" ")}
        fill={area.color ?? "#f1efea"}
        fillOpacity={selected ? 0.95 : hovered ? 0.8 : 0.6}
        stroke={selected ? "#2f5d4e" : "#d6d3cc"}
        strokeWidth={selected ? 2 : 1}
      />
      <text
        x={cx}
        y={cy}
        fontSize={13}
        textAnchor="middle"
        fill="#45474a"
        fontFamily="Pretendard, sans-serif"
      >
        {area.name}
      </text>
      {area.showArea !== false && (
        <text
          x={cx}
          y={cy + 15}
          fontSize={11}
          textAnchor="middle"
          fill="#7b7d80"
          fontFamily="Pretendard, sans-serif"
        >
          {squareMeters.toFixed(1)}㎡ ({(squareMeters / 3.3058).toFixed(1)}평)
        </text>
      )}
    </g>
  );
}

function WallShape({
  wall,
  toScreen,
  scale,
  selected,
  hovered,
}: {
  wall: WallSegment;
  toScreen: (x: number, y: number) => [number, number];
  scale: number;
  selected: boolean;
  hovered: boolean;
}) {
  const [x1, y1] = toScreen(wall.start[0], wall.start[1]);
  const [x2, y2] = toScreen(wall.end[0], wall.end[1]);
  const thickness = Math.max(2, wall.thickness * scale);

  // 두께가 충분히 보일 때만 해치를 넣는다 (작을 땐 뭉쳐서 지저분해진다)
  const hatched = thickness >= 7;

  return (
    <g pointerEvents="none">
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={hatched ? "url(#wall-hatch)" : selected ? "#2f5d4e" : "#26231f"}
        strokeWidth={thickness}
        strokeLinecap="butt"
      />
      {hatched && (
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke={selected ? "#2f5d4e" : hovered ? "#4a4642" : "#26231f"}
          strokeWidth={thickness}
          strokeLinecap="butt"
          fill="none"
          strokeOpacity={selected ? 0.25 : 0}
        />
      )}

      {(wall.openings ?? []).map((opening) => {
        const [ox1, oy1] = toScreen(...pointAlongWall(wall, opening.offset));
        const [ox2, oy2] = toScreen(...pointAlongWall(wall, opening.offset + opening.width));
        return (
          <g key={opening.id}>
            <line
              x1={ox1}
              y1={oy1}
              x2={ox2}
              y2={oy2}
              stroke="#ffffff"
              strokeWidth={thickness + 1.5}
            />
            <line
              x1={ox1}
              y1={oy1}
              x2={ox2}
              y2={oy2}
              stroke={opening.type === "door" ? "#bf6242" : "#1f5f9c"}
              strokeWidth={Math.max(1.5, thickness * 0.35)}
            />
          </g>
        );
      })}
    </g>
  );
}

function ObjectShape({
  object,
  center,
  toScreen,
  scale,
  selected,
  hovered,
}: {
  object: SceneObject;
  center: [number, number];
  toScreen: (x: number, y: number) => [number, number];
  scale: number;
  selected: boolean;
  hovered: boolean;
}) {
  const width = object.dimensions.width * object.transform.scale[0] * scale;
  const depth = object.dimensions.depth * object.transform.scale[2] * scale;
  const [cx, cy] = toScreen(center[0], center[1]);

  return (
    <g transform={`translate(${cx} ${cy}) rotate(${object.screen.rotation})`} pointerEvents="none">
      <rect
        x={-width / 2}
        y={-depth / 2}
        width={Math.max(4, width)}
        height={Math.max(4, depth)}
        fill={selected ? "#e9f0ec" : hovered ? "#eeece8" : "#f4f3f0"}
        stroke={selected ? "#2f5d4e" : "#8a8a87"}
        strokeWidth={selected ? 1.6 : 1}
        rx={2}
      />
      {width > 40 && (
        <text
          y={3}
          fontSize={Math.min(11, Math.max(8, width / 8))}
          textAnchor="middle"
          fill="#45474a"
          fontFamily="Pretendard, sans-serif"
        >
          {object.name}
        </text>
      )}
    </g>
  );
}

function AnnotationShape({
  annotation,
  toScreen,
  selected,
}: {
  annotation: Annotation;
  toScreen: (x: number, y: number) => [number, number];
  selected: boolean;
}) {
  const color = selected ? "#2f5d4e" : "#45474a";
  const screen = annotation.points.map(([x, y]) => toScreen(x, y));

  if (annotation.type === "text") {
    const [x, y] = screen[0];
    return (
      <text
        x={x}
        y={y}
        fontSize={12}
        fill={color}
        fontFamily="Pretendard, sans-serif"
        pointerEvents="none"
      >
        {annotation.text}
      </text>
    );
  }

  if (annotation.type === "polyline") {
    return (
      <polyline
        points={screen.map((point) => point.join(",")).join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 2.5 : 1.8}
        strokeDasharray={annotation.dashed ? "6 4" : undefined}
        pointerEvents="none"
      />
    );
  }

  /* 치수선 — 오프셋만큼 띄우고 양 끝에 인출선을 내린다 (건축 도면 관행) */
  const [a, b] = annotation.points;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.round(Math.hypot(dx, dy));
  const unit = length || 1;
  const nx = (-dy / unit) * (annotation.offset ?? 0);
  const ny = (dx / unit) * (annotation.offset ?? 0);

  const [sx1, sy1] = toScreen(a[0], a[1]);
  const [sx2, sy2] = toScreen(b[0], b[1]);
  const [ox1, oy1] = toScreen(a[0] + nx, a[1] + ny);
  const [ox2, oy2] = toScreen(b[0] + nx, b[1] + ny);

  return (
    <g pointerEvents="none">
      <line x1={sx1} y1={sy1} x2={ox1} y2={oy1} stroke={color} strokeWidth={0.8} opacity={0.6} />
      <line x1={sx2} y1={sy2} x2={ox2} y2={oy2} stroke={color} strokeWidth={0.8} opacity={0.6} />
      <line x1={ox1} y1={oy1} x2={ox2} y2={oy2} stroke={color} strokeWidth={selected ? 2 : 1.2} />
      <circle cx={ox1} cy={oy1} r={2.5} fill={color} />
      <circle cx={ox2} cy={oy2} r={2.5} fill={color} />
      <text
        x={(ox1 + ox2) / 2}
        y={(oy1 + oy2) / 2 - 6}
        fontSize={11}
        textAnchor="middle"
        fill={color}
        fontFamily="Pretendard, sans-serif"
        paintOrder="stroke"
        stroke="#f6f6f4"
        strokeWidth={3}
      >
        {annotation.text || `${length}`}
      </text>
    </g>
  );
}

/** 선택된 대상 위에 뜨는 조작 손잡이 */
function Handles({
  id,
  objects,
  walls,
  areas,
  annotations,
  objectCenter,
  toScreen,
  scale,
}: {
  id: string;
  objects: SceneObject[];
  walls: WallSegment[];
  areas: RoomArea[];
  annotations: Annotation[];
  objectCenter: (object: SceneObject) => [number, number];
  toScreen: (x: number, y: number) => [number, number];
  scale: number;
}) {
  const dot = (key: string, x: number, y: number, fill = "#ffffff") => (
    <circle key={key} cx={x} cy={y} r={4.5} fill={fill} stroke="#2f5d4e" strokeWidth={1.5} />
  );

  const object = objects.find((item) => item.id === id);
  if (object) {
    const [cx, cy] = toScreen(...objectCenter(object));
    const halfW = (object.dimensions.width * object.transform.scale[0] * scale) / 2;
    const halfD = (object.dimensions.depth * object.transform.scale[2] * scale) / 2;

    return (
      <g transform={`translate(${cx} ${cy}) rotate(${object.screen.rotation})`} pointerEvents="none">
        <line x1={0} y1={-halfD} x2={0} y2={-halfD - ROTATE_OFFSET_PX} stroke="#2f5d4e" />
        {dot("rotate", 0, -halfD - ROTATE_OFFSET_PX, "#2f5d4e")}
        {dot("resize", halfW, halfD)}
      </g>
    );
  }

  const wall = walls.find((item) => item.id === id);
  if (wall) {
    const [sx, sy] = toScreen(wall.start[0], wall.start[1]);
    const [ex, ey] = toScreen(wall.end[0], wall.end[1]);
    return (
      <g pointerEvents="none">
        {dot("s", sx, sy)}
        {dot("e", ex, ey)}
      </g>
    );
  }

  const shape = areas.find((item) => item.id === id) ?? annotations.find((item) => item.id === id);
  if (!shape) return null;

  return (
    <g pointerEvents="none">
      {shape.points.map((point, index) => {
        const [x, y] = toScreen(point[0], point[1]);
        return dot(`v${index}`, x, y);
      })}
    </g>
  );
}

function Marquee({
  from,
  to,
  toScreen,
}: {
  from: [number, number];
  to: [number, number];
  toScreen: (x: number, y: number) => [number, number];
}) {
  const [x1, y1] = toScreen(from[0], from[1]);
  const [x2, y2] = toScreen(to[0], to[1]);

  return (
    <rect
      x={Math.min(x1, x2)}
      y={Math.min(y1, y2)}
      width={Math.abs(x2 - x1)}
      height={Math.abs(y2 - y1)}
      fill="#2f5d4e"
      fillOpacity={0.08}
      stroke="#2f5d4e"
      strokeDasharray="4 3"
      pointerEvents="none"
    />
  );
}

function DraftShape({
  draft,
  tool,
  toScreen,
}: {
  draft: Draft;
  tool: string;
  toScreen: (x: number, y: number) => [number, number];
}) {
  /* 치수선 오프셋을 고르는 중 — 커서 쪽으로 미리보기를 띄운다 */
  if (draft.awaitingOffset && draft.cursor) {
    const [a, b] = draft.points;
    const offset = offsetFromLine(a, b, draft.cursor);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const unit = Math.hypot(dx, dy) || 1;
    const nx = (-dy / unit) * offset;
    const ny = (dx / unit) * offset;

    const [ox1, oy1] = toScreen(a[0] + nx, a[1] + ny);
    const [ox2, oy2] = toScreen(b[0] + nx, b[1] + ny);

    return (
      <g pointerEvents="none">
        <line
          x1={ox1}
          y1={oy1}
          x2={ox2}
          y2={oy2}
          stroke="#2f5d4e"
          strokeWidth={1.6}
          strokeDasharray="6 4"
        />
        <text
          x={(ox1 + ox2) / 2}
          y={(oy1 + oy2) / 2 - 7}
          fontSize={11}
          textAnchor="middle"
          fill="#2f5d4e"
          fontFamily="Pretendard, sans-serif"
        >
          {Math.round(Math.hypot(dx, dy))}
        </text>
      </g>
    );
  }

  const points = draft.cursor ? [...draft.points, draft.cursor] : draft.points;
  const screen = points.map(([x, y]) => toScreen(x, y));

  if (screen.length === 1) {
    return (
      <circle cx={screen[0][0]} cy={screen[0][1]} r={3.5} fill="#2f5d4e" pointerEvents="none" />
    );
  }

  return (
    <g pointerEvents="none">
      {tool === "room" && screen.length >= 3 && (
        <polygon
          points={screen.map((point) => point.join(",")).join(" ")}
          fill="#2f5d4e"
          fillOpacity={0.12}
        />
      )}
      <polyline
        points={screen.map((point) => point.join(",")).join(" ")}
        fill="none"
        stroke="#2f5d4e"
        strokeWidth={tool === "wall" ? 3 : 1.6}
        strokeDasharray="6 4"
      />
      {screen.map((point, index) => (
        <circle key={index} cx={point[0]} cy={point[1]} r={2.5} fill="#2f5d4e" />
      ))}
    </g>
  );
}
