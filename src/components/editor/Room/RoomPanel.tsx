"use client";

import { useEffect, useState } from "react";
import { useEditorStore } from "@/lib/editor/store";
import type { WallOpening, WallSegment } from "@/scene/types";
import {
  ensureRoom,
  findFreeOffset,
  floorArea,
  polygonArea,
  toSquareMeters,
  wallLength,
} from "@/scene/geometry";
import { NumberField } from "../shared/NumberField";
import { ElectricalPanel } from "./ElectricalPanel";

/**
 * 공간 패널 — 실측 치수 입력 + 벽·개구부 편집.
 *
 * 도면(DXF·평면도)과 3D가 모두 이 값을 그대로 쓰므로, 여기 입력한 값이 곧 산출물 치수다.
 * 실측 확정 체크를 켜면 도면의 고지 문구가 "AI 추정"에서 "실측 기준"으로 바뀐다.
 */
export function RoomPanel() {
  const scene = useEditorStore((state) => state.scene);
  const runTool = useEditorStore((state) => state.runTool);

  const room = scene?.room ? ensureRoom(scene.room) : null;
  const walls = room?.walls ?? [];
  const areas = room?.areas ?? [];

  const [width, setWidth] = useState("");
  const [length, setLength] = useState("");
  const [height, setHeight] = useState("");
  const [saving, setSaving] = useState(false);
  const [openWallId, setOpenWallId] = useState<string | null>(null);
  const [deriveNote, setDeriveNote] = useState<string | null>(null);

  // 서버 Scene이 바뀌면 입력값을 동기화한다.
  useEffect(() => {
    if (!room) return;
    setWidth(String(Math.round(room.dimensions.width)));
    setLength(String(Math.round(room.dimensions.length)));
    setHeight(String(Math.round(room.dimensions.height)));
  }, [room?.dimensions.width, room?.dimensions.length, room?.dimensions.height]);

  if (!room) return null;

  const applyDimensions = async (measured: boolean) => {
    setSaving(true);
    await runTool("set_room", {
      width: Number(width),
      length: Number(length),
      height: Number(height),
      measured,
    });

    /*
     * 실측값을 확정하면 그 치수 위에 사진 속 창·문을 얹는다.
     * 실치수를 넣는 이유가 "이 방 구조 그대로 도면을 뽑는 것"이므로,
     * 별도 버튼을 누르게 하지 않고 여기서 같이 처리한다.
     */
    if (measured) {
      const result = await runTool("derive_openings", {});
      setDeriveNote(result.ok ? result.message : null);
    }

    setSaving(false);
  };

  /** 사진 속 창·문을 다시 읽어 온다 (치수를 이미 확정한 뒤 쓰는 버튼) */
  const syncOpenings = async () => {
    setSaving(true);
    const result = await runTool("derive_openings", {});
    setDeriveNote(result.message);
    setSaving(false);
  };

  const dirty =
    Number(width) !== Math.round(room.dimensions.width) ||
    Number(length) !== Math.round(room.dimensions.length) ||
    Number(height) !== Math.round(room.dimensions.height);

  return (
    <div className="space-y-4 p-2 text-[12px]">
      {/* ── 실측 치수 ── */}
      <section className="rounded-md border border-line p-2">
        <div className="flex items-center justify-between">
          <p className="text-[12px] font-semibold">방 치수 (mm)</p>
          <span
            className={[
              "rounded-full px-1.5 py-0.5 text-[10px]",
              room.measured ? "bg-success/15 text-success" : "bg-sunken text-muted",
            ].join(" ")}
          >
            {room.measured ? "실측 확정" : "AI 추정"}
          </span>
        </div>

        <div className="mt-2 space-y-1.5">
          {(
            [
              ["가로", width, setWidth],
              ["세로", length, setLength],
              ["높이", height, setHeight],
            ] as [string, string, (value: string) => void][]
          ).map(([label, value, setter]) => (
            <label key={label} className="flex items-center gap-2">
              <span className="w-9 shrink-0 text-muted">{label}</span>
              <input
                type="number"
                inputMode="numeric"
                value={value}
                onChange={(event) => setter(event.target.value)}
                className="h-8 w-full rounded border border-line bg-canvas px-2 text-right tabular-nums"
              />
              <span className="text-[10.5px] text-muted">mm</span>
            </label>
          ))}
        </div>

        <p className="mt-1.5 text-[10.5px] text-muted">
          면적 {floorArea(room.dimensions).toFixed(1)}㎡ (
          {(floorArea(room.dimensions) / 3.3058).toFixed(1)}평)
        </p>

        <div className="mt-2 flex gap-1">
          <button
            type="button"
            disabled={saving || !dirty}
            onClick={() => void applyDimensions(room.measured ?? false)}
            className="flex-1 rounded border border-line px-2 py-1.5 text-[11.5px] hover:bg-sunken disabled:opacity-40"
          >
            적용
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void applyDimensions(true)}
            className="flex-1 rounded bg-accent px-2 py-1.5 text-[11.5px] text-white hover:bg-accent-hover disabled:opacity-40"
          >
            실측값으로 확정
          </button>
        </div>

        <button
          type="button"
          onClick={() => void syncOpenings()}
          disabled={saving}
          className="mt-1.5 w-full rounded border border-line px-2 py-1.5 text-[11.5px] hover:bg-sunken disabled:opacity-40"
        >
          사진 속 창·문을 벽에 반영
        </button>

        {deriveNote && <p className="mt-1 text-[10.5px] text-accent">{deriveNote}</p>}

        <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted">
          확정하면 도면 고지가 &lsquo;실측 기준&rsquo;으로 바뀌고, 사진에서 찾은 창·문이 그 치수에 맞춰
          벽에 반영됩니다. 치수를 바꾸면 벽이 새 크기로 다시 맞춰지고 개구부는 비율대로 따라갑니다.
        </p>
      </section>

      {/* ── 벽 목록 ── */}
      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[12px] font-semibold">벽 {walls.length}개</p>
          <button
            type="button"
            onClick={() => {
              // 마지막 벽 끝점에서 이어 그린다 — ㄱ자·비직사각형 평면을 만들 때의 출발점.
              const last = walls[walls.length - 1];
              const start = last ? last.end : [0, 0];
              runTool("add_wall", {
                x1: start[0],
                y1: start[1],
                x2: start[0],
                y2: Math.min(room.dimensions.length, start[1] + 1000),
                name: `벽 ${walls.length + 1}`,
              });
            }}
            className="text-[11px] text-accent hover:underline"
          >
            벽 추가
          </button>
        </div>

        <ul className="space-y-1.5">
          {walls.map((wall) => (
            <WallRow
              key={wall.id}
              wall={wall}
              expanded={openWallId === wall.id}
              onToggle={() => setOpenWallId(openWallId === wall.id ? null : wall.id)}
            />
          ))}
        </ul>

        {walls.length === 0 && (
          <p className="py-4 text-center text-[11.5px] text-muted">
            벽이 없습니다. 치수를 적용하면 자동으로 만들어집니다.
          </p>
        )}
      </section>

      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-[11.5px] font-semibold text-ink">실 {areas.length}개</h3>
          <button
            type="button"
            onClick={() => void runTool("add_room_area", { name: "거실" })}
            className="text-[11px] text-accent hover:underline"
          >
            방 전체를 실로
          </button>
        </div>

        {areas.length === 0 ? (
          <p className="text-[10.5px] leading-relaxed text-muted">
            실을 만들면 평면도에 실명과 면적이 적힙니다. 평면도에서 &lsquo;실&rsquo; 도구로 모서리를
            찍어 그리거나, 위 버튼으로 방 전체를 실 하나로 잡을 수 있습니다.
          </p>
        ) : (
          <ul className="space-y-1">
            {areas.map((area) => (
              <li
                key={area.id}
                className="flex items-center gap-1.5 rounded border border-line bg-canvas px-1.5 py-1"
              >
                <input
                  defaultValue={area.name}
                  onBlur={(event) => {
                    const name = event.target.value.trim();
                    if (name && name !== area.name) {
                      void runTool("update_room_area", { areaId: area.id, name });
                    }
                  }}
                  className="min-w-0 flex-1 bg-transparent text-[11px] outline-none focus:underline"
                />
                <span className="shrink-0 text-[10.5px] tabular-nums text-muted">
                  {toSquareMeters(polygonArea(area.points)).toFixed(1)}㎡
                </span>
                <button
                  type="button"
                  onClick={() => void runTool("delete_room_area", { areaId: area.id })}
                  className="shrink-0 text-[10.5px] text-danger hover:underline"
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="mb-1.5 text-[11.5px] font-semibold text-ink">전기 · 통신</h3>
        <ElectricalPanel />
      </section>
    </div>
  );
}

function WallRow({
  wall,
  expanded,
  onToggle,
}: {
  wall: WallSegment;
  expanded: boolean;
  onToggle: () => void;
}) {
  const runTool = useEditorStore((state) => state.runTool);
  const [notice, setNotice] = useState<string | null>(null);
  const length = Math.round(wallLength(wall));

  const addOpening = async (type: "door" | "window") => {
    const width = type === "door" ? 900 : 1500;
    const offset = findFreeOffset(wall, width);

    if (offset === null) {
      setNotice(`${type === "door" ? "문" : "창"}을 놓을 빈 자리가 없습니다.`);
      return;
    }

    const result = await runTool("add_opening", {
      wallId: wall.id,
      type,
      offset,
      width,
    });
    setNotice(result.ok ? null : result.message);
  };

  const updateWall = async (patch: Record<string, unknown>) => {
    const result = await runTool("update_wall", { wallId: wall.id, ...patch });
    setNotice(result.ok ? null : result.message);
  };

  return (
    <li className="rounded-md border border-line">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-2 py-1.5 text-left"
      >
        <span>
          <span className="font-medium">{wall.name}</span>
          <span className="ml-1.5 text-[10.5px] text-muted">
            {length}mm · 두께 {wall.thickness} · 개구부 {(wall.openings ?? []).length}
          </span>
        </span>
        <span className="text-[10px] text-muted">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="space-y-2 border-t border-line p-2">
          {notice && <p className="text-[10.5px] text-danger">{notice}</p>}

          <div className="flex gap-1.5">
            <NumberField
              label="두께"
              value={wall.thickness}
              onCommit={(value) => void updateWall({ thickness: value })}
            />
            <NumberField
              label="높이"
              value={wall.height}
              onCommit={(value) => void updateWall({ height: value })}
            />
          </div>

          {/* 벽 끝점 좌표 — 방 좌측 하단이 원점(mm). ㄱ자 평면은 여기서 만든다. */}
          <div>
            <p className="mb-1 text-[10.5px] text-muted">시작·끝 좌표 (좌측 하단 0,0 기준 mm)</p>
            <div className="grid grid-cols-2 gap-1.5">
              <NumberField
                label="시작X"
                value={wall.start[0]}
                min={0}
                onCommit={(value) => void updateWall({ start: [value, wall.start[1]] })}
              />
              <NumberField
                label="시작Y"
                value={wall.start[1]}
                min={0}
                onCommit={(value) => void updateWall({ start: [wall.start[0], value] })}
              />
              <NumberField
                label="끝X"
                value={wall.end[0]}
                min={0}
                onCommit={(value) => void updateWall({ end: [value, wall.end[1]] })}
              />
              <NumberField
                label="끝Y"
                value={wall.end[1]}
                min={0}
                onCommit={(value) => void updateWall({ end: [wall.end[0], value] })}
              />
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium">개구부</span>
              <span className="flex gap-1">
                <button
                  type="button"
                  onClick={() => void addOpening("door")}
                  className="rounded border border-line px-1.5 py-0.5 text-[10.5px] hover:bg-sunken"
                >
                  + 문
                </button>
                <button
                  type="button"
                  onClick={() => void addOpening("window")}
                  className="rounded border border-line px-1.5 py-0.5 text-[10.5px] hover:bg-sunken"
                >
                  + 창
                </button>
              </span>
            </div>

            {(wall.openings ?? []).length === 0 ? (
              <p className="py-1.5 text-center text-[10.5px] text-muted">없음</p>
            ) : (
              <ul className="space-y-1.5">
                {(wall.openings ?? []).map((opening) => (
                  <OpeningRow key={opening.id} wall={wall} opening={opening} />
                ))}
              </ul>
            )}
          </div>

          <button
            type="button"
            onClick={() => runTool("delete_wall", { wallId: wall.id })}
            className="w-full rounded border border-danger/30 px-2 py-1 text-[11px] text-danger hover:bg-danger/10"
          >
            벽 삭제
          </button>
        </div>
      )}
    </li>
  );
}

function OpeningRow({ wall, opening }: { wall: WallSegment; opening: WallOpening }) {
  const runTool = useEditorStore((state) => state.runTool);
  const [notice, setNotice] = useState<string | null>(null);

  const update = async (patch: Record<string, number | string>) => {
    const result = await runTool("update_opening", {
      wallId: wall.id,
      openingId: opening.id,
      ...patch,
    });
    setNotice(result.ok ? null : result.message);
  };

  return (
    <li className="rounded border border-line bg-canvas p-1.5">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px]">
          {opening.type === "door" ? "🚪" : "🪟"} {opening.name}
        </span>
        <button
          type="button"
          onClick={() =>
            runTool("delete_opening", {
              wallId: wall.id,
              openingId: opening.id,
            })
          }
          className="text-[10.5px] text-danger hover:underline"
        >
          삭제
        </button>
      </div>

      {notice && <p className="mb-1 text-[10.5px] text-danger">{notice}</p>}

      <div className="grid grid-cols-2 gap-1.5">
        <NumberField label="위치" value={opening.offset} onCommit={(v) => update({ offset: v })} />
        <NumberField label="폭" value={opening.width} onCommit={(v) => update({ width: v })} />
        <NumberField label="높이" value={opening.height} onCommit={(v) => update({ height: v })} />
        {opening.type === "window" && (
          <NumberField
            label="하부"
            value={opening.sillHeight}
            onCommit={(v) => update({ sillHeight: v })}
          />
        )}
      </div>

      {/* 문 사양 — 평면도 기호와 입면도 표기가 이 값으로 결정된다 */}
      {opening.type === "door" && (
        <div className="mt-1.5 space-y-1.5 border-t border-line pt-1.5">
          <Choice
            label="종류"
            value={opening.doorType ?? "hinged"}
            options={[
              ["hinged", "여닫이"],
              ["sliding", "미닫이"],
              ["folding", "접이"],
              ["opening", "개구부"],
            ]}
            onChange={(v) => update({ doorType: v })}
          />
          {(opening.doorType ?? "hinged") === "hinged" && (
            <>
              <Choice
                label="경첩"
                value={opening.hinge ?? "start"}
                options={[
                  ["start", "좌측"],
                  ["end", "우측"],
                ]}
                onChange={(v) => update({ hinge: v })}
              />
              <Choice
                label="열림"
                value={opening.swing ?? "in"}
                options={[
                  ["in", "안쪽"],
                  ["out", "바깥"],
                ]}
                onChange={(v) => update({ swing: v })}
              />
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** 값이 몇 개뿐인 선택 — 셀렉트보다 눌러서 바로 보이는 쪽이 도면 작업에 빠르다 */
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-8 shrink-0 text-[10.5px] text-muted">{label}</span>
      <div className="flex flex-1 gap-0.5">
        {options.map(([id, text]) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-pressed={value === id}
            className={[
              "flex-1 rounded px-1 py-1 text-[10.5px] transition-colors",
              value === id
                ? "bg-accent-soft font-medium text-accent"
                : "border border-line text-muted hover:text-ink",
            ].join(" ")}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
