"use client";

import { useState } from "react";
import { useEditorStore } from "@/lib/editor/store";
import { ensureRoom, pointAlongWall } from "@/scene/geometry";

/**
 * 2.5D 뷰의 평면 미니맵.
 *
 * 사진 위 편집만으로는 벽·문·창이 어디 있는지 알 수 없어서,
 * 도면(DXF·평면도)과 같은 좌표계로 벽·개구부·가구 배치를 위에서 내려다본 형태로 함께 보여 준다.
 */
export function PlanMinimap() {
  const scene = useEditorStore((state) => state.scene);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const select = useEditorStore((state) => state.select);
  const [open, setOpen] = useState(true);

  if (!scene?.room) return null;

  const room = ensureRoom(scene.room);
  const { width: W, length: L } = room.dimensions;
  const padding = 400;

  // 평면 좌표(y 위쪽이 안쪽)를 화면 좌표로 뒤집는다.
  const fy = (y: number) => L - y;

  const objects = scene.objects.filter(
    (object) =>
      object.visibility &&
      object.type !== "wall" &&
      object.type !== "ceiling" &&
      object.type !== "floor"
  );

  return (
    <div className="absolute bottom-3 right-3 z-30 w-[190px] rounded-lg border border-white/15 bg-[#1b1a18]/85 p-2 backdrop-blur">
      <div className="mb-1 flex items-center justify-between text-[10.5px] text-white/70">
        <span>
          평면 {Math.round(W)}×{Math.round(L)}
          {room.measured ? " · 실측" : " · 추정"}
        </span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded px-1 hover:bg-white/10"
        >
          {open ? "숨기기" : "보기"}
        </button>
      </div>

      {open && (
        <svg
          viewBox={`${-padding} ${-padding} ${W + padding * 2} ${L + padding * 2}`}
          className="w-full"
          style={{ aspectRatio: `${W + padding * 2} / ${L + padding * 2}` }}
        >
          <rect x={0} y={0} width={W} height={L} fill="#efe9e0" opacity={0.12} />

          {(room.walls ?? []).map((wall) => {
            const openings = [...(wall.openings ?? [])].sort((a, b) => a.offset - b.offset);
            const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);

            // 개구부를 제외한 실제 벽체 구간
            const spans: [number, number][] = [];
            let cursor = 0;
            for (const opening of openings) {
              const start = Math.max(0, Math.min(length, opening.offset));
              if (start > cursor) spans.push([cursor, start]);
              cursor = Math.max(cursor, Math.min(length, opening.offset + opening.width));
            }
            if (cursor < length) spans.push([cursor, length]);

            return (
              <g key={wall.id}>
                {spans.map(([from, to], index) => {
                  const [x1, y1] = pointAlongWall(wall, from);
                  const [x2, y2] = pointAlongWall(wall, to);
                  return (
                    <line
                      key={`${wall.id}_${index}`}
                      x1={x1}
                      y1={fy(y1)}
                      x2={x2}
                      y2={fy(y2)}
                      stroke="#f4f1ec"
                      strokeWidth={wall.thickness}
                      strokeLinecap="butt"
                    />
                  );
                })}

                {openings.map((opening) => {
                  const [x1, y1] = pointAlongWall(wall, opening.offset);
                  const [x2, y2] = pointAlongWall(wall, opening.offset + opening.width);
                  return (
                    <line
                      key={opening.id}
                      x1={x1}
                      y1={fy(y1)}
                      x2={x2}
                      y2={fy(y2)}
                      stroke={opening.type === "door" ? "#e08b60" : "#7cb3e0"}
                      strokeWidth={Math.max(80, wall.thickness * 0.7)}
                    >
                      <title>
                        {opening.name} {Math.round(opening.width)}×{Math.round(opening.height)}
                      </title>
                    </line>
                  );
                })}
              </g>
            );
          })}

          {objects.map((object) => {
            const width = object.dimensions.width * object.transform.scale[0];
            const depth = object.dimensions.depth * object.transform.scale[2];
            const cx = (object.screen.x + object.screen.width / 2) * W;
            const cy = object.depth * L;
            const selected = selectedIds.includes(object.id);

            return (
              <rect
                key={object.id}
                x={cx - width / 2}
                y={fy(cy) - depth / 2}
                width={width}
                height={depth}
                fill={selected ? "#bf6242" : "#ffffff"}
                fillOpacity={selected ? 0.75 : 0.35}
                stroke={selected ? "#ffffff" : "#ffffff"}
                strokeOpacity={selected ? 0.9 : 0.35}
                strokeWidth={30}
                className="cursor-pointer"
                onClick={() => select([object.id])}
              >
                <title>{object.name}</title>
              </rect>
            );
          })}
        </svg>
      )}
    </div>
  );
}
