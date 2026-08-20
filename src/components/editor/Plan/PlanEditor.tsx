"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "@/lib/editor/store";
import { electricalSpec } from "@/config/electrical";
import {
  ensureRoom,
  pointAlongWall,
  polygonArea,
  polygonCentroid,
  toSquareMeters,
} from "@/scene/geometry";
import type { Annotation, RoomArea, SceneObject, WallSegment } from "@/scene/types";
import { orthogonalize, snapPoint, usePlanViewport } from "./usePlanViewport";
import { PlanRulers } from "./PlanRulers";

/**
 * 평면도 편집 캔버스.
 *
 * 도면을 보기만 하던 화면을 직접 그리는 화면으로 바꾼다.
 * 벽을 긋고, 가구를 끌어 옮기고, 치수선과 텍스트를 얹는 일이 전부 여기서 일어난다.
 *
 * 좌표는 항상 mm(방 좌측 하단 원점)로만 다루고, 화면 픽셀 변환은 usePlanViewport에 맡긴다.
 * 모든 편집은 Scene operation 하나로 커밋되므로 실행 취소가 그대로 동작한다.
 */

/** 그리기 중인 상태 — 아직 커밋되지 않은 점들 */
interface Draft {
  points: [number, number][];
  cursor: [number, number] | null;
}

interface DragState {
  kind: "object" | "annotation" | "area";
  id: string;
  /** 잡은 지점과 대상 기준점의 차이 (mm) */
  grabDx: number;
  grabDy: number;
}

export function PlanEditor() {
  const scene = useEditorStore((state) => state.scene);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const select = useEditorStore((state) => state.select);
  const runTool = useEditorStore((state) => state.runTool);
  const planTool = useEditorStore((state) => state.planTool);
  const setPlanTool = useEditorStore((state) => state.setPlanTool);
  const showGrid = useEditorStore((state) => state.showGrid);
  const snapMm = useEditorStore((state) => state.snapMm);

  const view = usePlanViewport();
  const { toScreen, toPlan, containerRef } = view;

  const [draft, setDraft] = useState<Draft | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);

  const sceneRoom = scene?.room;
  const room = useMemo(() => (sceneRoom ? ensureRoom(sceneRoom) : null), [sceneRoom]);

  // 매 렌더마다 새 배열이 되면 아래 훅들의 의존성이 계속 바뀐다.
  const walls = useMemo(() => room?.walls ?? [], [room]);
  const annotations = useMemo(() => room?.annotations ?? [], [room]);
  const fixtures = useMemo(() => room?.electrical ?? [], [room]);
  const areas = useMemo(() => room?.areas ?? [], [room]);

  const objects = useMemo(
    () =>
      (scene?.objects ?? []).filter(
        (object) =>
          object.visibility &&
          object.type !== "wall" &&
          object.type !== "floor" &&
          object.type !== "ceiling"
      ),
    [scene?.objects]
  );

  /*
   * 방 전체가 보이도록 맞춘다.
   *
   * 처음 한 번뿐 아니라 캔버스 크기가 바뀔 때도 다시 맞춘다 — 평면+3D 분할로 바꾸면
   * 높이가 절반이 되는데, 그때 배율을 그대로 두면 방이 화면 밖으로 나간다.
   */
  const fitted = useRef(false);
  const roomWidthMm = room?.dimensions.width;
  const roomLengthMm = room?.dimensions.length;

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !roomWidthMm || !roomLengthMm) return;

    if (!fitted.current) {
      fitted.current = true;
      view.fit(roomWidthMm, roomLengthMm);
    }

    let frame = 0;
    const observer = new ResizeObserver(() => {
      // 크기 변경이 연달아 오므로 다음 프레임에 한 번만 반영한다.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => view.fit(roomWidthMm, roomLengthMm));
    });

    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // view.fit은 참조가 고정돼 있어 의존성에 넣어도 반복 실행되지 않는다.
  }, [containerRef, roomWidthMm, roomLengthMm, view]);

  /** 가구의 평면 좌표 — 도면 생성기(toPlanData)와 같은 규칙을 쓴다 */
  const objectCenter = useCallback(
    (object: SceneObject): [number, number] => {
      if (!room) return [0, 0];
      return [
        (object.screen.x + object.screen.width / 2) * room.dimensions.width,
        object.depth * room.dimensions.length,
      ];
    },
    [room]
  );

  const pointerPlan = useCallback(
    (event: React.PointerEvent | PointerEvent): [number, number] => {
      const raw = toPlan(event.clientX, event.clientY);
      const snapped = snapPoint(raw, snapMm);
      return [Math.round(snapped[0]), Math.round(snapped[1])];
    },
    [toPlan, snapMm]
  );

  /* ───────────────────────── 그리기 커밋 ───────────────────────── */

  const commitWall = useCallback(
    async (from: [number, number], to: [number, number]) => {
      const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      if (length < 100) return;

      const result = await runTool("add_wall", {
        x1: Math.round(from[0]),
        y1: Math.round(from[1]),
        x2: Math.round(to[0]),
        y2: Math.round(to[1]),
      });
      setHint(result.ok ? `벽 ${Math.round(length)}mm 추가` : result.message);
    },
    [runTool]
  );

  const commitArea = useCallback(
    async (points: [number, number][]) => {
      if (polygonArea(points) < 100_000) {
        setHint("실이 너무 작습니다");
        return;
      }

      const name = window.prompt("실 이름", "거실")?.trim();
      if (!name) return;

      const result = await runTool("add_room_area", { name, points });
      setHint(result.message);
    },
    [runTool]
  );

  const commitAnnotation = useCallback(
    async (type: Annotation["type"], points: [number, number][], text?: string) => {
      const result = await runTool("add_annotation", {
        type,
        points,
        ...(text ? { text } : {}),
      });
      setHint(result.ok ? result.message : result.message);
    },
    [runTool]
  );

  /* ───────────────────────── 포인터 처리 ───────────────────────── */

  const onPointerDown = (event: React.PointerEvent) => {
    // 가운데 버튼이나 스페이스 없이도 빈 곳 우클릭으로 화면을 옮길 수 있게 한다.
    if (event.button === 1 || event.button === 2) {
      panRef.current = { x: event.clientX, y: event.clientY };
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;

    const point = pointerPlan(event);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

    if (planTool === "select") {
      panRef.current = { x: event.clientX, y: event.clientY };
      return;
    }

    if (planTool === "text") {
      const text = window.prompt("도면에 넣을 문구");
      if (text?.trim()) void commitAnnotation("text", [point], text.trim());
      return;
    }

    setDraft((current) => {
      const points = current ? [...current.points, point] : [point];

      // 벽·치수선은 두 점이면 바로 확정한다. 실·폴리라인은 더블클릭으로 닫는다.
      if (points.length === 2 && planTool !== "polyline" && planTool !== "room") {
        const end = orthogonalize(points[0], points[1]);
        const length = Math.hypot(end[0] - points[0][0], end[1] - points[0][1]);

        // 같은 자리를 두 번 찍으면 0mm짜리가 생긴다. 무시하고 처음부터 다시 받는다.
        if (length < 100) {
          setHint("두 점이 너무 가깝습니다");
          return null;
        }

        if (planTool === "wall") void commitWall(points[0], end);
        else void commitAnnotation("dimension", [points[0], end]);
        return null;
      }

      return { points, cursor: point };
    });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (panRef.current) {
      const dx = event.clientX - panRef.current.x;
      const dy = event.clientY - panRef.current.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        view.panBy(dx, dy);
        panRef.current = { x: event.clientX, y: event.clientY };
      }
      return;
    }

    if (drag) {
      const [x, y] = pointerPlan(event);
      void moveDragged(drag, [x - drag.grabDx, y - drag.grabDy]);
      return;
    }

    if (draft) setDraft({ ...draft, cursor: pointerPlan(event) });
  };

  const onPointerUp = (event: React.PointerEvent) => {
    panRef.current = null;
    if (drag) setDrag(null);
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
  };

  /** 드래그 중인 대상을 새 위치로 옮긴다 (놓는 순간이 아니라 이동 중에도 반영) */
  const moveDragged = useCallback(
    async (state: DragState, to: [number, number]) => {
      if (!room) return;

      if (state.kind === "object") {
        const object = scene?.objects.find((item) => item.id === state.id);
        if (!object) return;

        /*
         * move_object의 x는 화면 기준 좌측 끝이고 여기서 다루는 좌표는 중심이다.
         * 폭의 절반만큼 빼서 넘기지 않으면 가구가 잡은 위치에서 미끄러진다.
         */
        await runTool("move_object", {
          objectId: state.id,
          x: Math.min(
            1,
            Math.max(0, to[0] / room.dimensions.width - object.screen.width / 2)
          ),
          depth: Math.min(1, Math.max(0, to[1] / room.dimensions.length)),
        });
        return;
      }

      if (state.kind === "area") {
        const area = areas.find((item) => item.id === state.id);
        if (!area) return;

        const [ax, ay] = area.points[0];
        await runTool("update_room_area", {
          areaId: state.id,
          points: area.points.map(([x, y]) => [
            Math.round(x + (to[0] - ax)),
            Math.round(y + (to[1] - ay)),
          ]),
        });
        return;
      }

      const annotation = annotations.find((item) => item.id === state.id);
      if (!annotation) return;

      const [ax, ay] = annotation.points[0];
      const dx = to[0] - ax;
      const dy = to[1] - ay;
      await runTool("update_annotation", {
        annotationId: state.id,
        points: annotation.points.map(([x, y]) => [Math.round(x + dx), Math.round(y + dy)]),
      });
    },
    [annotations, areas, room, runTool, scene?.objects]
  );

  /* 더블클릭으로 폴리라인 마무리 */
  const onDoubleClick = () => {
    if (draft && draft.points.length >= 2 && planTool === "polyline") {
      void commitAnnotation("polyline", draft.points);
    }
    if (draft && draft.points.length >= 3 && planTool === "room") {
      void commitArea(draft.points);
    }
    setDraft(null);
  };

  /* Esc로 그리기 취소, Delete로 선택 삭제 */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDraft(null);
        setPlanTool("select");
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length === 1) {
        const target = document.activeElement?.tagName;
        if (target === "INPUT" || target === "TEXTAREA") return;
        const id = selectedIds[0];
        if (areas.some((item) => item.id === id)) {
          void runTool("delete_room_area", { areaId: id });
        } else if (annotations.some((item) => item.id === id)) {
          void runTool("delete_annotation", { annotationId: id });
        } else if (walls.some((wall) => wall.id === id)) {
          void runTool("delete_wall", { wallId: id });
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [annotations, areas, runTool, selectedIds, setPlanTool, walls]);

  if (!room) return null;

  const { width: roomWidth, length: roomLength } = room.dimensions;

  /*
   * 선택 도구일 때만 도면 요소가 포인터를 받는다.
   * 벽이나 치수를 그리는 중에 가구가 클릭을 먹으면, 그으려던 자리에서 가구가 끌려간다.
   */
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
        onWheel={(event) => view.zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 0.89)}
        style={{ cursor: planTool === "select" ? "default" : "crosshair" }}
      >
        <svg className="h-full w-full">
          {showGrid && <Grid view={view} />}

          {/* 방 외곽 */}
          <PlanPolygon
            points={[
              [0, 0],
              [roomWidth, 0],
              [roomWidth, roomLength],
              [0, roomLength],
            ]}
            toScreen={toScreen}
            fill="#ffffff"
            stroke="#e2e0dc"
          />

          <g pointerEvents={picking ? "auto" : "none"}>
          {/* 실 — 가장 아래에 깔아 벽과 가구가 위로 올라오게 한다 */}
          {areas.map((area) => (
            <AreaShape
              key={area.id}
              area={area}
              toScreen={toScreen}
              selected={selectedIds.includes(area.id)}
              onGrab={(point) => {
                select([area.id]);
                setDrag({
                  kind: "area",
                  id: area.id,
                  grabDx: point[0] - area.points[0][0],
                  grabDy: point[1] - area.points[0][1],
                });
              }}
            />
          ))}

          {/* 가구 */}
          {objects.map((object) => (
            <ObjectShape
              key={object.id}
              object={object}
              center={objectCenter(object)}
              toScreen={toScreen}
              scale={view.viewport.scale}
              selected={selectedIds.includes(object.id)}
              onGrab={(point) => {
                const [cx, cy] = objectCenter(object);
                select([object.id]);
                setDrag({
                  kind: "object",
                  id: object.id,
                  grabDx: point[0] - cx,
                  grabDy: point[1] - cy,
                });
              }}
              toPlan={pointerPlan}
            />
          ))}

          {/* 벽 · 개구부 */}
          {walls.map((wall) => (
            <WallShape
              key={wall.id}
              wall={wall}
              toScreen={toScreen}
              scale={view.viewport.scale}
              selected={selectedIds.includes(wall.id)}
              onSelect={() => select([wall.id])}
            />
          ))}

          {/* 전기 설비 */}
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

          {/* 주석 */}
          {annotations.map((annotation) => (
            <AnnotationShape
              key={annotation.id}
              annotation={annotation}
              toScreen={toScreen}
              selected={selectedIds.includes(annotation.id)}
              onGrab={(point) => {
                select([annotation.id]);
                setDrag({
                  kind: "annotation",
                  id: annotation.id,
                  grabDx: point[0] - annotation.points[0][0],
                  grabDy: point[1] - annotation.points[0][1],
                });
              }}
            />
          ))}

          </g>

          {/* 그리는 중 미리보기 */}
          {draft && <DraftShape draft={draft} tool={planTool} toScreen={toScreen} />}
        </svg>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-2">
        <span className="rounded bg-ink/75 px-2 py-1 text-[11px] text-white">
          {TOOL_HINT[planTool]}
        </span>
        {hint && (
          <span className="rounded bg-surface px-2 py-1 text-[11px] text-ink shadow-sm">{hint}</span>
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
  select: "끌어서 이동 · 휠로 확대 · 우클릭 드래그로 화면 이동",
  wall: "두 점을 찍어 벽을 긋습니다 (Esc 취소)",
  room: "모서리를 차례로 찍고 더블클릭으로 실을 닫습니다",
  dimension: "두 점을 찍어 치수를 답니다",
  text: "클릭한 자리에 문구를 넣습니다",
  polyline: "여러 점을 찍고 더블클릭으로 끝냅니다",
};

/* ───────────────────────────── 조각들 ───────────────────────────── */

function Grid({ view }: { view: ReturnType<typeof usePlanViewport> }) {
  const { scale } = view.viewport;

  // 화면에서 눈에 보일 만한 간격을 고른다 (100mm → 1m → 5m)
  const step = scale > 0.09 ? 100 : scale > 0.03 ? 1000 : 5000;
  const major = step * 10;

  const rect = view.containerRef.current?.getBoundingClientRect();
  if (!rect) return null;

  const [left, top] = view.toPlan(rect.left, rect.top);
  const [right, bottom] = view.toPlan(rect.right, rect.bottom);

  const lines: React.ReactElement[] = [];
  const startX = Math.floor(left / step) * step;
  const startY = Math.floor(bottom / step) * step;

  for (let x = startX; x < right; x += step) {
    const [sx] = view.toScreen(x, 0);
    lines.push(
      <line
        key={`x${x}`}
        x1={sx}
        y1={0}
        x2={sx}
        y2={rect.height}
        stroke={x % major === 0 ? "#dcdad5" : "#ecebe7"}
        strokeWidth={1}
      />
    );
  }
  for (let y = startY; y < top; y += step) {
    const [, sy] = view.toScreen(0, y);
    lines.push(
      <line
        key={`y${y}`}
        x1={0}
        y1={sy}
        x2={rect.width}
        y2={sy}
        stroke={y % major === 0 ? "#dcdad5" : "#ecebe7"}
        strokeWidth={1}
      />
    );
  }

  return <g pointerEvents="none">{lines}</g>;
}

function PlanPolygon({
  points,
  toScreen,
  fill,
  stroke,
}: {
  points: [number, number][];
  toScreen: (x: number, y: number) => [number, number];
  fill: string;
  stroke: string;
}) {
  const path = points.map(([x, y]) => toScreen(x, y).join(",")).join(" ");
  return <polygon points={path} fill={fill} stroke={stroke} strokeWidth={1} pointerEvents="none" />;
}

function AreaShape({
  area,
  toScreen,
  selected,
  onGrab,
}: {
  area: RoomArea;
  toScreen: (x: number, y: number) => [number, number];
  selected: boolean;
  onGrab: (point: [number, number]) => void;
}) {
  const screen = area.points.map(([x, y]) => toScreen(x, y));
  const [cx, cy] = toScreen(...polygonCentroid(area.points));
  const squareMeters = toSquareMeters(polygonArea(area.points));

  return (
    <g
      onPointerDown={(event) => {
        event.stopPropagation();
        onGrab(area.points[0]);
      }}
      style={{ cursor: "move" }}
    >
      <polygon
        points={screen.map((point) => point.join(",")).join(" ")}
        fill={area.color ?? "#f1efea"}
        fillOpacity={selected ? 0.9 : 0.6}
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
        pointerEvents="none"
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
          pointerEvents="none"
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
  onSelect,
}: {
  wall: WallSegment;
  toScreen: (x: number, y: number) => [number, number];
  scale: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const [x1, y1] = toScreen(wall.start[0], wall.start[1]);
  const [x2, y2] = toScreen(wall.end[0], wall.end[1]);
  const thickness = Math.max(2, wall.thickness * scale);

  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={selected ? "#2f5d4e" : "#26231f"}
        strokeWidth={thickness}
        strokeLinecap="butt"
        onPointerDown={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        style={{ cursor: "pointer" }}
      />

      {/* 개구부 자리는 벽을 끊어 비운다 */}
      {(wall.openings ?? []).map((opening) => {
        const [ox1, oy1] = toScreen(...pointAlongWall(wall, opening.offset));
        const [ox2, oy2] = toScreen(...pointAlongWall(wall, opening.offset + opening.width));
        return (
          <g key={opening.id} pointerEvents="none">
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
  onGrab,
  toPlan,
}: {
  object: SceneObject;
  center: [number, number];
  toScreen: (x: number, y: number) => [number, number];
  scale: number;
  selected: boolean;
  onGrab: (point: [number, number]) => void;
  toPlan: (event: React.PointerEvent) => [number, number];
}) {
  const width = object.dimensions.width * object.transform.scale[0] * scale;
  const depth = object.dimensions.depth * object.transform.scale[2] * scale;
  const [cx, cy] = toScreen(center[0], center[1]);

  return (
    <g
      transform={`translate(${cx} ${cy}) rotate(${object.screen.rotation})`}
      onPointerDown={(event) => {
        event.stopPropagation();
        onGrab(toPlan(event));
      }}
      style={{ cursor: "move" }}
    >
      <rect
        x={-width / 2}
        y={-depth / 2}
        width={Math.max(4, width)}
        height={Math.max(4, depth)}
        fill={selected ? "#e9f0ec" : "#f4f3f0"}
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
          pointerEvents="none"
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
  onGrab,
}: {
  annotation: Annotation;
  toScreen: (x: number, y: number) => [number, number];
  selected: boolean;
  onGrab: (point: [number, number]) => void;
}) {
  const color = selected ? "#2f5d4e" : "#45474a";
  const screen = annotation.points.map(([x, y]) => toScreen(x, y));

  const grab = (event: React.PointerEvent) => {
    event.stopPropagation();
    onGrab(annotation.points[0]);
  };

  if (annotation.type === "text") {
    const [x, y] = screen[0];
    return (
      <text
        x={x}
        y={y}
        fontSize={12}
        fill={color}
        fontFamily="Pretendard, sans-serif"
        onPointerDown={grab}
        style={{ cursor: "move" }}
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
        onPointerDown={grab}
        style={{ cursor: "move" }}
      />
    );
  }

  // 치수선 — 선 + 양 끝 틱 + 길이 라벨
  const [[x1, y1], [x2, y2]] = screen;
  const length = Math.round(
    Math.hypot(
      annotation.points[1][0] - annotation.points[0][0],
      annotation.points[1][1] - annotation.points[0][1]
    )
  );

  return (
    <g onPointerDown={grab} style={{ cursor: "move" }}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={selected ? 2 : 1.2} />
      <circle cx={x1} cy={y1} r={2.5} fill={color} />
      <circle cx={x2} cy={y2} r={2.5} fill={color} />
      <text
        x={(x1 + x2) / 2}
        y={(y1 + y2) / 2 - 6}
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

function DraftShape({
  draft,
  tool,
  toScreen,
}: {
  draft: Draft;
  tool: string;
  toScreen: (x: number, y: number) => [number, number];
}) {
  const points = draft.cursor ? [...draft.points, draft.cursor] : draft.points;
  if (points.length < 2) {
    const [x, y] = toScreen(points[0][0], points[0][1]);
    return <circle cx={x} cy={y} r={3} fill="#2f5d4e" pointerEvents="none" />;
  }

  const guided =
    tool === "polyline" || tool === "room"
      ? points
      : [points[0], orthogonalize(points[0], points[points.length - 1])];
  const screen = guided.map(([x, y]) => toScreen(x, y));
  const last = guided[guided.length - 1];
  const first = guided[0];
  const length = Math.round(Math.hypot(last[0] - first[0], last[1] - first[1]));

  return (
    <g pointerEvents="none">
      {tool === "room" && guided.length >= 3 && (
        <polygon
          points={screen.map((point) => point.join(",")).join(" ")}
          fill="#2f5d4e"
          fillOpacity={0.12}
          stroke="none"
        />
      )}
      <polyline
        points={screen.map((point) => point.join(",")).join(" ")}
        fill="none"
        stroke="#2f5d4e"
        strokeWidth={tool === "wall" ? 3 : 1.6}
        strokeDasharray="6 4"
      />
      <text
        x={(screen[0][0] + screen[screen.length - 1][0]) / 2}
        y={(screen[0][1] + screen[screen.length - 1][1]) / 2 - 8}
        fontSize={11}
        textAnchor="middle"
        fill="#2f5d4e"
        fontFamily="Pretendard, sans-serif"
        paintOrder="stroke"
        stroke="#f6f6f4"
        strokeWidth={3}
      >
        {length}mm
      </text>
    </g>
  );
}
