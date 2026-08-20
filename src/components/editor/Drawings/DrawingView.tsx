"use client";

import { useMemo, useState } from "react";
import { useEditorStore } from "@/lib/editor/store";
import { ensureRoom, wallLength } from "@/scene/geometry";
import { buildPlanSvg, toPlanData } from "@/services/cadExport";
import { buildElevationSvg } from "@/services/elevationExport";

/**
 * 평면도 · 입면도 뷰.
 *
 * 두 도면 모두 Scene의 실측 좌표(mm)를 그대로 써서 SVG로 그린다.
 * 화면용과 내보내기용이 같은 생성기를 쓰므로, 보이는 그림과 DXF·SVG 산출물이 어긋나지 않는다.
 */
export function DrawingView({ mode }: { mode: "plan" | "elevation" }) {
  const scene = useEditorStore((state) => state.scene);
  const projectName = useEditorStore((state) => state.projectName);
  const zoom = useEditorStore((state) => state.zoom);

  const plan = useMemo(() => toPlanData(scene, projectName), [scene, projectName]);
  const walls = useMemo(() => ensureRoom(scene.room).walls ?? [], [scene.room]);

  const [wallId, setWallId] = useState<string | null>(null);
  const activeWall = walls.find((wall) => wall.id === wallId) ?? walls[0] ?? null;

  const svg = useMemo(() => {
    if (mode === "plan") return buildPlanSvg(plan);
    if (!activeWall) return null;
    return buildElevationSvg({ plan, wall: activeWall });
  }, [mode, plan, activeWall]);

  return (
    <div className="relative h-full w-full overflow-auto bg-[#111]">
      {mode === "elevation" && walls.length > 0 && (
        <div className="sticky top-0 z-10 flex flex-wrap gap-1 border-b border-white/10 bg-[#0a0a0a]/90 px-3 py-2 backdrop-blur">
          <span className="mr-1 self-center text-[11.5px] text-white/50">벽 선택</span>
          {walls.map((wall) => (
            <button
              key={wall.id}
              type="button"
              onClick={() => setWallId(wall.id)}
              aria-pressed={activeWall?.id === wall.id}
              className={[
                "rounded-md px-2.5 py-1 text-[11.5px] transition-colors",
                activeWall?.id === wall.id
                  ? "bg-white text-ink"
                  : "text-white/70 hover:bg-white/10 hover:text-white",
              ].join(" ")}
            >
              {wall.name || "벽"}
              <span className="ml-1 text-[10.5px] opacity-60">
                {Math.round(wallLength(wall))}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="flex min-h-full items-start justify-center p-6">
        {svg ? (
          <div
            // SVG에 박힌 width 대신 컨테이너 폭에 맞춘다 — 처음에 도면 전체가 보여야 한다.
            className="w-full max-w-[1100px] origin-top transition-transform [&>svg]:h-auto [&>svg]:w-full"
            style={{ transform: `scale(${zoom})` }}
            // 도면은 우리가 만든 문자열이라 외부 입력이 섞이지 않는다.
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <p className="mt-20 text-[13px] text-white/50">
            벽 정보가 없어 도면을 그릴 수 없습니다. 방 패널에서 벽을 먼저 만들어 주세요.
          </p>
        )}
      </div>
    </div>
  );
}
