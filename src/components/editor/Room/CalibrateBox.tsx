"use client";

import { useState } from "react";
import { useEditorStore } from "@/lib/editor/store";
import { ensureRoom, floorArea, wallLength } from "@/scene/geometry";

/**
 * 축척 보정 — 한 변만 재면 도면 전체가 맞는다.
 *
 * 사진에서 읽은 치수는 비례는 꽤 맞는데 절대 크기가 흔들린다. 같은 사진을 두 번
 * 분석했을 때 방 면적이 60㎡와 81㎡로 갈렸다. 모든 치수를 AI가 맞히게 하는 대신,
 * 줄자로 잰 한 변을 받아 나머지를 그 비율로 끌어당기는 것이 훨씬 정확하고 빠르다.
 *
 * 이 값을 넣어야 DXF가 열린다 — 추정 도면이 CAD로 나가면 안 되기 때문이다.
 */
export function CalibrateBox() {
  const scene = useEditorStore((state) => state.scene);
  const runTool = useEditorStore((state) => state.runTool);

  const room = scene?.room ? ensureRoom(scene.room) : null;
  const walls = room?.walls ?? [];

  const [wallId, setWallId] = useState<string>("");
  const [actual, setActual] = useState("");
  const [busy, setBusy] = useState(false);

  if (!room || walls.length === 0) return null;

  const selected = walls.find((wall) => wall.id === wallId) ?? walls[0];
  const current = Math.round(wallLength(selected));
  const target = Number(actual);
  const valid = Number.isFinite(target) && target >= 300 && target <= 100000;
  const factor = valid && current > 0 ? target / current : 1;

  const apply = async () => {
    if (!valid || busy) return;
    setBusy(true);
    await runTool("calibrate_scale", { wallId: selected.id, actualMm: Math.round(target) });
    setActual("");
    setBusy(false);
  };

  // 보정 뒤의 면적 — 얼마나 달라지는지 누르기 전에 보여 준다.
  const nextArea = floorArea({
    width: room.dimensions.width * factor,
    length: room.dimensions.length * factor,
    height: room.dimensions.height,
  });

  return (
    <div className="rounded-md border border-line bg-sunken/60 p-2">
      <p className="text-[11.5px] font-medium text-ink">한 변만 재서 축척 맞추기</p>
      <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted">
        사진에서 읽은 치수는 추정값입니다. 벽 하나의 실제 길이를 넣으면 도면 전체가 그 비율로
        맞춰집니다.
      </p>

      <div className="mt-2 space-y-1.5">
        <select
          value={selected.id}
          onChange={(event) => setWallId(event.target.value)}
          className="h-8 w-full rounded border border-line bg-canvas px-2 text-[12px]"
        >
          {walls.map((wall) => (
            <option key={wall.id} value={wall.id}>
              {wall.name} — 현재 {Math.round(wallLength(wall)).toLocaleString("ko-KR")}mm
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-[11.5px] text-muted">실제 길이</span>
          <input
            type="number"
            inputMode="numeric"
            value={actual}
            placeholder={String(current)}
            onChange={(event) => setActual(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void apply();
            }}
            className="h-8 w-full rounded border border-line bg-canvas px-2 text-right text-[12px] tabular-nums"
          />
          <span className="text-[10.5px] text-muted">mm</span>
        </div>
      </div>

      {valid && Math.abs(factor - 1) >= 0.001 && (
        <p className="mt-1.5 text-[10.5px] text-muted">
          ×{factor.toFixed(3)} → 면적 {floorArea(room.dimensions).toFixed(1)}㎡ →{" "}
          <strong className="text-ink">{nextArea.toFixed(1)}㎡</strong> (
          {(nextArea / 3.3058).toFixed(1)}평)
        </p>
      )}

      <button
        type="button"
        onClick={() => void apply()}
        disabled={!valid || busy}
        className="mt-2 h-8 w-full rounded bg-accent text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-40"
      >
        {busy ? "맞추는 중…" : "이 길이로 도면 전체 맞추기"}
      </button>
    </div>
  );
}
