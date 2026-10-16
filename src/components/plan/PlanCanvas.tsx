"use client";

import { useEffect, useRef, useState } from "react";
import type { FloorPlanDoc, Point } from "@renderfit/plan-schema";
import { centroid } from "@/scene/planPolygonize";
import { squareMetres, toPlan, toScreen, zoomAt, type View } from "./planView";

/**
 * 검수용 도면 화면.
 *
 * ── 왜 SVG 인가 ──
 *
 * 여기서 하는 일은 그리기보다 **집기**다. 벽 끝점 하나, 문 손잡이 하나를 정확히
 * 집어야 한다. SVG 는 그 일을 브라우저가 해 준다 — 캔버스로 그리면 무엇을 집었는지
 * 우리가 매번 다시 계산해야 하고, 그 계산이 그리기와 어긋나면 보이는 것과 집히는
 * 것이 달라진다.
 *
 * ── 좌표는 전부 toScreen 을 지난다 ──
 *
 * SVG 변환(transform)으로 y 를 뒤집지 않는다. 뒤집으면 글자까지 뒤집혀 다시 뒤집어야
 * 하고, 그 순간부터 어느 좌표계인지 헷갈린다.
 */

/** 무엇을 집었나 */
export type Selection =
  | { kind: "wall"; id: string }
  | { kind: "room"; id: string }
  | { kind: "opening"; id: string }
  | { kind: "fixture"; id: string };

export type Tool = "select" | "wall" | "split" | "scale";

interface Props {
  doc: FloorPlanDoc;
  /** 처음 읽어 낸 문서. "원본" 토글이 이것을 회색으로 겹쳐 보여 준다 */
  original: FloorPlanDoc;
  imageUrl: string | null;
  showOriginal: boolean;
  /** 겹쳐 놓은 원본의 진하기 (0~1) */
  opacity: number;
  view: View;
  onView: (view: View) => void;
  tool: Tool;
  selection: Selection | null;
  /** 방 병합을 기다리는 중에 골라 둔 방들 */
  markedRooms: string[];
  onSelect: (selection: Selection | null) => void;
  /** 도구가 쓰는 점 찍기 — 벽 그리기·방 나누기·축척 재기 */
  onToolPoint: (point: Point, roomId: string | null) => void;
  /** 끌기 (phase "move" 동안에는 기록을 남기지 않는다) */
  onDrag: (drag: DragIntent, point: Point, phase: "move" | "end") => void;
  /** 도구가 찍어 둔 점 — 미리 보기 선을 그린다 */
  pending: Point[];
}

export type DragIntent =
  | { type: "wall-end"; id: string; end: "a" | "b" }
  | { type: "opening-move"; id: string }
  | { type: "opening-width"; id: string; side: "start" | "end" }
  | { type: "fixture"; id: string };

/** 신뢰도가 이 아래면 색으로 표시한다 — 검수에서 가장 먼저 볼 것들이다 */
const LOW = 0.6;

export function PlanCanvas({
  doc,
  original,
  imageUrl,
  showOriginal,
  opacity,
  view,
  onView,
  tool,
  selection,
  markedRooms,
  onSelect,
  onToolPoint,
  onDrag,
  pending,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<DragIntent | null>(null);
  const [pan, setPan] = useState<{ x: number; y: number; view: View } | null>(null);
  const [image, setImage] = useState<{ width: number; height: number } | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);

  /*
   * 그림 크기를 미리 잰다.
   *
   * <image> 의 onLoad 로는 원본 픽셀 크기를 알 수 없다 — 그 값이 있어야 mm 로 옮겨
   * 도면과 겹칠 수 있으므로 따로 한 장 읽어 크기만 본다.
   */
  useEffect(() => {
    if (!imageUrl) return;

    let alive = true;
    const probe = new window.Image();
    probe.onload = () => {
      if (alive) setImage({ width: probe.naturalWidth, height: probe.naturalHeight });
    };
    probe.src = imageUrl;

    return () => {
      alive = false;
    };
  }, [imageUrl]);

  const at = (event: { clientX: number; clientY: number }): Point => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return [0, 0];
    return toPlan(view, event.clientX - box.left, event.clientY - box.top);
  };

  const screen = (point: Point) => toScreen(view, point);

  /* ── 원본 그림 자리 ──
     그림 픽셀 (px, py) → mm: x = (px - originPx.x) × mmPerPixel, y 는 위로 뒤집는다 */
  const underlay = (() => {
    if (!imageUrl || !doc.underlay || !image) return null;

    const { mmPerPixel, originPx } = doc.underlay;
    const topLeft = screen([-originPx[0] * mmPerPixel, originPx[1] * mmPerPixel]);

    return {
      x: topLeft[0],
      y: topLeft[1],
      width: image.width * mmPerPixel * view.scale,
      height: image.height * mmPerPixel * view.scale,
    };
  })();

  return (
    <svg
      ref={svgRef}
      className="h-full w-full touch-none bg-[#101215]"
      onWheel={(event) => {
        const box = svgRef.current?.getBoundingClientRect();
        if (!box) return;
        onView(
          zoomAt(
            view,
            event.deltaY < 0 ? 1.12 : 1 / 1.12,
            event.clientX - box.left,
            event.clientY - box.top
          )
        );
      }}
      onPointerDown={(event) => {
        if (drag) return;
        /* 빈 곳을 누르면 화면을 민다. 도구를 쓰는 중이면 점을 찍는다 */
        if (tool === "select") {
          setPan({ x: event.clientX, y: event.clientY, view });
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      }}
      onPointerMove={(event) => {
        const point = at(event);
        setCursor(point);

        if (drag) {
          onDrag(drag, point, "move");
          return;
        }

        if (pan) {
          onView({
            ...pan.view,
            originX: pan.view.originX - (event.clientX - pan.x) / view.scale,
            originY: pan.view.originY + (event.clientY - pan.y) / view.scale,
          });
        }
      }}
      onPointerUp={(event) => {
        if (drag) {
          onDrag(drag, at(event), "end");
          setDrag(null);
        }
        setPan(null);
      }}
      onPointerLeave={() => {
        setPan(null);
        setCursor(null);
      }}
      onClick={(event) => {
        if (tool === "select") return;
        onToolPoint(at(event), roomAt(doc, at(event)));
      }}
    >
      {/* ── 원본 그림 ── */}
      {imageUrl && underlay && (
        <image
          href={imageUrl}
          x={underlay.x}
          y={underlay.y}
          width={underlay.width}
          height={underlay.height}
          opacity={opacity}
          preserveAspectRatio="none"
          className="pointer-events-none"
        />
      )}

      {/* ── 방 ── */}
      {doc.rooms.map((room) => {
        const points = room.polygon.map(screen);
        const marked = markedRooms.includes(room.id);
        const chosen = selection?.kind === "room" && selection.id === room.id;

        return (
          <g key={room.id}>
            <polygon
              points={points.map(([x, y]) => `${x},${y}`).join(" ")}
              fill={marked ? "#38bdf833" : chosen ? "#ffffff1f" : "#ffffff10"}
              stroke={marked ? "#38bdf8" : "transparent"}
              strokeWidth={1.5}
              onPointerDown={(event) => {
                if (tool !== "select") return;
                event.stopPropagation();
                onSelect({ kind: "room", id: room.id });
              }}
            />
          </g>
        );
      })}

      {/* ── 벽 ── */}
      {doc.walls.map((wall) => {
        const a = screen(wall.a);
        const b = screen(wall.b);
        const chosen = selection?.kind === "wall" && selection.id === wall.id;

        return (
          <g key={wall.id}>
            <line
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              stroke={chosen ? "#38bdf8" : wall.confidence < LOW ? "#f59e0b" : "#e5e7eb"}
              strokeWidth={Math.max(2, wall.thickness * view.scale)}
              strokeLinecap="butt"
              className="cursor-pointer"
              onPointerDown={(event) => {
                if (tool !== "select") return;
                event.stopPropagation();
                onSelect({ kind: "wall", id: wall.id });
              }}
            />

            {/* 끝점 손잡이 — 여기를 끌어 벽을 옮긴다 */}
            {tool === "select" &&
              (["a", "b"] as const).map((end) => {
                const point = end === "a" ? a : b;
                return (
                  <circle
                    key={end}
                    cx={point[0]}
                    cy={point[1]}
                    r={5}
                    fill="#0b0d10"
                    stroke="#38bdf8"
                    strokeWidth={1.5}
                    className="cursor-grab"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
                      onSelect({ kind: "wall", id: wall.id });
                      setDrag({ type: "wall-end", id: wall.id, end });
                    }}
                  />
                );
              })}
          </g>
        );
      })}

      {/* ── 문·창 ── */}
      {doc.openings.map((opening) => {
        const wall = doc.walls.find((item) => item.id === opening.wallId);
        if (!wall) return null;

        const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
        if (length < 1) return null;

        const unit: Point = [(wall.b[0] - wall.a[0]) / length, (wall.b[1] - wall.a[1]) / length];
        const start: Point = [
          wall.a[0] + unit[0] * opening.offset,
          wall.a[1] + unit[1] * opening.offset,
        ];
        const end: Point = [
          start[0] + unit[0] * opening.width,
          start[1] + unit[1] * opening.width,
        ];

        const s = screen(start);
        const e = screen(end);
        const chosen = selection?.kind === "opening" && selection.id === opening.id;

        return (
          <g key={opening.id}>
            <line
              x1={s[0]}
              y1={s[1]}
              x2={e[0]}
              y2={e[1]}
              stroke={chosen ? "#38bdf8" : opening.kind === "window" ? "#7dd3fc" : "#a3e635"}
              strokeWidth={Math.max(3, wall.thickness * view.scale + 2)}
              className="cursor-move"
              onPointerDown={(event) => {
                if (tool !== "select") return;
                event.stopPropagation();
                event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
                onSelect({ kind: "opening", id: opening.id });
                setDrag({ type: "opening-move", id: opening.id });
              }}
            />

            {/* 양 끝 손잡이 — 폭을 끈다 */}
            {tool === "select" &&
              ([
                ["start", s],
                ["end", e],
              ] as const).map(([side, point]) => (
                <rect
                  key={side}
                  x={point[0] - 3}
                  y={point[1] - 3}
                  width={6}
                  height={6}
                  fill="#0b0d10"
                  stroke="#a3e635"
                  strokeWidth={1.2}
                  className="cursor-ew-resize"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
                    onSelect({ kind: "opening", id: opening.id });
                    setDrag({ type: "opening-width", id: opening.id, side });
                  }}
                />
              ))}
          </g>
        );
      })}

      {/* ── 설비 ── */}
      {doc.fixtures.map((fixture) => {
        const [x, y, w, h] = fixture.bbox;
        const corner = screen([x, y + h]);
        const chosen = selection?.kind === "fixture" && selection.id === fixture.id;
        const middle = screen([x + w / 2, y + h / 2]);

        return (
          <g
            key={fixture.id}
            transform={`rotate(${-fixture.rotation} ${middle[0]} ${middle[1]})`}
          >
            <rect
              x={corner[0]}
              y={corner[1]}
              width={w * view.scale}
              height={h * view.scale}
              fill={chosen ? "#38bdf833" : "#f472b622"}
              stroke={chosen ? "#38bdf8" : "#f472b6"}
              strokeWidth={1.2}
              strokeDasharray={fixture.source === "user" ? undefined : "4 3"}
              className="cursor-move"
              onPointerDown={(event) => {
                if (tool !== "select") return;
                event.stopPropagation();
                event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
                onSelect({ kind: "fixture", id: fixture.id });
                setDrag({ type: "fixture", id: fixture.id });
              }}
            />
            {view.scale > 0.02 && (
              <text
                x={middle[0]}
                y={middle[1] + 3}
                textAnchor="middle"
                className="pointer-events-none select-none fill-[#f9a8d4] text-[9px]"
              >
                {fixture.label ?? fixture.kind}
              </text>
            )}
          </g>
        );
      })}

      {/* ── 방 이름·면적 ── */}
      {doc.rooms.map((room) => {
        if (room.polygon.length < 3) return null;
        const middle = screen(centroid(room.polygon));

        return (
          <g key={`${room.id}-label`} className="pointer-events-none select-none">
            <text x={middle[0]} y={middle[1]} textAnchor="middle" className="fill-white text-[12px]">
              {room.name ?? "이름 없음"}
            </text>
            <text
              x={middle[0]}
              y={middle[1] + 14}
              textAnchor="middle"
              className="fill-[#9ca3af] text-[10px]"
            >
              {squareMetres(room.areaMm2)}
            </text>
          </g>
        );
      })}

      {/* ── 처음 읽어 낸 도면 (원본 토글) ── */}
      {showOriginal &&
        original.walls.map((wall) => {
          const a = screen(wall.a);
          const b = screen(wall.b);
          return (
            <line
              key={`origin-${wall.id}`}
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              stroke="#64748b"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              className="pointer-events-none"
            />
          );
        })}

      {/* ── 도구가 찍어 둔 점과 미리 보기 선 ── */}
      {pending.map((point, index) => {
        const at2 = screen(point);
        return <circle key={index} cx={at2[0]} cy={at2[1]} r={4} fill="#38bdf8" />;
      })}

      {pending.length === 1 && cursor && (
        <line
          x1={screen(pending[0])[0]}
          y1={screen(pending[0])[1]}
          x2={screen(cursor)[0]}
          y2={screen(cursor)[1]}
          stroke="#38bdf8"
          strokeWidth={1.5}
          strokeDasharray="5 4"
          className="pointer-events-none"
        />
      )}
    </svg>
  );
}

/** 이 자리가 어느 방 안인가 — 방을 나눌 때 어느 방을 나누는지 알아야 한다 */
function roomAt(doc: FloorPlanDoc, point: Point): string | null {
  for (const room of doc.rooms) {
    if (room.polygon.length < 3) continue;

    let inside = false;
    for (let index = 0; index < room.polygon.length; index += 1) {
      const [x1, y1] = room.polygon[index];
      const [x2, y2] = room.polygon[(index + 1) % room.polygon.length];

      if (y1 > point[1] !== y2 > point[1]) {
        const cross = x1 + ((point[1] - y1) / (y2 - y1)) * (x2 - x1);
        if (cross > point[0]) inside = !inside;
      }
    }

    if (inside) return room.id;
  }

  return null;
}
