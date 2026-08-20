"use client";

import { useState } from "react";
import { ELECTRICAL_SPECS, electricalSpec } from "@/config/electrical";
import { useEditorStore } from "@/lib/editor/store";
import { ensureRoom, wallLength } from "@/scene/geometry";
import { NumberField } from "../shared/NumberField";

/**
 * 전기 · 통신 배치.
 *
 * 평면도에는 위치가, 입면도에는 설치 높이가 그대로 반영된다.
 * 설치 높이는 종류별 관행값을 기본으로 넣고 필요할 때만 고치게 한다.
 */
export function ElectricalPanel() {
  const scene = useEditorStore((state) => state.scene);
  const runTool = useEditorStore((state) => state.runTool);
  const [notice, setNotice] = useState<string | null>(null);

  const room = ensureRoom(scene.room);
  const walls = room.walls ?? [];
  const fixtures = room.electrical ?? [];

  const add = async (kind: string) => {
    const spec = electricalSpec(kind as never);
    const wall = walls[0];
    const result = await runTool("add_fixture", {
      kind,
      // 벽 조명이 아닌 천장 조명은 벽에 붙이지 않는다.
      wallId: kind === "ceiling-light" ? "" : (wall?.id ?? ""),
      offset: wall ? Math.round(wallLength(wall) / 2) : 0,
      height: spec.defaultHeight,
    });
    setNotice(result.ok ? null : result.message);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {ELECTRICAL_SPECS.map((spec) => (
          <button
            key={spec.kind}
            type="button"
            onClick={() => void add(spec.kind)}
            title={spec.note}
            className="rounded border border-line px-1.5 py-1 text-[10.5px] text-muted hover:text-ink"
          >
            + {spec.label}
          </button>
        ))}
      </div>

      {notice && <p className="text-[10.5px] text-danger">{notice}</p>}

      {fixtures.length === 0 ? (
        <p className="text-[10.5px] leading-relaxed text-muted">
          아직 배치한 설비가 없습니다. 위에서 골라 추가하면 평면도에 기호로, 입면도에 설치 높이로
          표시됩니다.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {fixtures.map((fixture) => {
            const spec = electricalSpec(fixture.kind);
            const wall = walls.find((item) => item.id === fixture.wallId);
            return (
              <li key={fixture.id} className="rounded border border-line bg-canvas p-1.5">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px]">
                    <span className="mr-1 rounded bg-sunken px-1 text-[10px] text-accent">
                      {spec.symbol}
                    </span>
                    {fixture.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => void runTool("delete_fixture", { fixtureId: fixture.id })}
                    className="text-[10.5px] text-danger hover:underline"
                  >
                    삭제
                  </button>
                </div>

                <div className="mb-1 flex flex-wrap gap-0.5">
                  {walls.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        void runTool("update_fixture", { fixtureId: fixture.id, wallId: item.id })
                      }
                      aria-pressed={fixture.wallId === item.id}
                      className={[
                        "rounded px-1.5 py-0.5 text-[10px] transition-colors",
                        fixture.wallId === item.id
                          ? "bg-accent-soft font-medium text-accent"
                          : "border border-line text-muted hover:text-ink",
                      ].join(" ")}
                    >
                      {item.name || "벽"}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      void runTool("update_fixture", { fixtureId: fixture.id, wallId: "" })
                    }
                    aria-pressed={!fixture.wallId}
                    className={[
                      "rounded px-1.5 py-0.5 text-[10px] transition-colors",
                      !fixture.wallId
                        ? "bg-accent-soft font-medium text-accent"
                        : "border border-line text-muted hover:text-ink",
                    ].join(" ")}
                  >
                    천장
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <NumberField
                    label="위치"
                    value={fixture.offset}
                    onCommit={(value) =>
                      void runTool("update_fixture", { fixtureId: fixture.id, offset: value })
                    }
                  />
                  <NumberField
                    label="높이"
                    value={fixture.height}
                    onCommit={(value) =>
                      void runTool("update_fixture", { fixtureId: fixture.id, height: value })
                    }
                  />
                </div>

                {wall && (
                  <p className="mt-1 text-[10px] text-muted">
                    {wall.name} 시작점에서 {Math.round(fixture.offset)}mm · 바닥에서{" "}
                    {Math.round(fixture.height)}mm
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
