"use client";

import { useEditorStore, useSelectedObject } from "@/lib/editor/store";
import type { RoomArea } from "@/scene/types";
import { DEFAULT_MATERIALS } from "@/models/materials";
import { ensureRoom, polygonArea, toSquareMeters } from "@/scene/geometry";
import { planCenter } from "@/scene/placement";
import { NumberField } from "../shared/NumberField";

/** 선택한 객체의 속성 · 변형 · 재질 · AI 편집 */
export function PropertiesPanel() {
  const object = useSelectedObject();
  const scene = useEditorStore((state) => state.scene);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const runTool = useEditorStore((state) => state.runTool);
  const startJob = useEditorStore((state) => state.startJob);

  /*
   * 평면도에서 실을 고르면 그 실의 속성을 보여 준다.
   * 실은 객체가 아니라 방의 일부라 useSelectedObject로는 잡히지 않는다.
   */
  const area = (ensureRoom(scene.room).areas ?? []).find((item) => selectedIds.includes(item.id));
  if (area) return <AreaProperties area={area} />;

  if (!object) {
    return (
      <p className="px-3 py-6 text-center text-[12px] leading-relaxed text-muted">
        객체나 실을 선택하면 속성이 표시됩니다.
      </p>
    );
  }

  const room = ensureRoom(scene.room);
  const center = planCenter(object.screen, object.depth, room);

  const materials = [
    ...scene.materials,
    ...DEFAULT_MATERIALS.filter((m) => !scene.materials.some((s) => s.id === m.id)),
  ];

  return (
    <div className="space-y-4 p-3 text-[12px]">
      <section>
        <p className="text-[13px] font-semibold">{object.name}</p>
        <p className="mt-0.5 text-[11px] text-muted">
          {object.type} · {object.category} · 신뢰도 {(object.confidence * 100).toFixed(0)}%
        </p>
      </section>

      <Section title="위치 (mm)">
        <div className="space-y-1">
          <NumberField
            label="X"
            value={center.cx}
            unit="mm"
            min={0}
            onCommit={(next) =>
              runTool("move_object", {
                objectId: object.id,
                x: next / room.dimensions.width - object.screen.width / 2,
                depth: object.depth,
              })
            }
          />
          <NumberField
            label="Y"
            value={center.cy}
            unit="mm"
            min={0}
            onCommit={(next) =>
              runTool("move_object", {
                objectId: object.id,
                x: object.screen.x,
                depth: next / room.dimensions.length,
              })
            }
          />
        </div>
        <p className="mt-1 text-[10.5px] text-muted">방 좌측 하단이 원점입니다.</p>
      </Section>

      <Section title="변형">
        <NumberField
          label="회전"
          value={object.screen.rotation}
          unit="°"
          min={-360}
          // rotate_object는 상대 회전이라, 원하는 각도까지의 차이만큼 돌린다.
          onCommit={(next) =>
            runTool("rotate_object", {
              objectId: object.id,
              degrees: next - object.screen.rotation,
            })
          }
        />
        <Row label="배율">{object.transform.scale[0].toFixed(2)}배</Row>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <MiniButton onClick={() => runTool("scale_object", { objectId: object.id, factor: 1.1 })}>
            +10%
          </MiniButton>
          <MiniButton onClick={() => runTool("scale_object", { objectId: object.id, factor: 0.9 })}>
            −10%
          </MiniButton>
          <MiniButton onClick={() => runTool("rotate_object", { objectId: object.id, degrees: 15 })}>
            +15°
          </MiniButton>
          <MiniButton onClick={() => runTool("rotate_object", { objectId: object.id, degrees: 90 })}>
            +90°
          </MiniButton>
        </div>
      </Section>

      <Section title="치수 (mm)">
        <div className="space-y-1">
          {(
            [
              ["가로", object.dimensions.width, "width"],
              ["높이", object.dimensions.height, "height"],
              ["깊이", object.dimensions.depth, "depth"],
            ] as [string, number, string][]
          ).map(([label, value, key]) => (
            <NumberField
              key={key}
              label={label}
              value={value}
              unit="mm"
              onCommit={(next) => runTool("set_dimensions", { objectId: object.id, [key]: next })}
            />
          ))}
        </div>
        <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
          도면(DXF·평면도)에 이 치수가 그대로 들어갑니다. 실제 제품 치수를 넣어 두세요.
        </p>
      </Section>

      <Section title="재질">
        <select
          value={object.materialId ?? ""}
          onChange={(event) =>
            runTool("change_material", { objectId: object.id, materialId: event.target.value })
          }
          className="h-8 w-full rounded-md border border-line bg-surface px-2 text-[12px]"
        >
          <option value="">지정 없음</option>
          {materials.map((material) => (
            <option key={material.id} value={material.id}>
              {material.name}
            </option>
          ))}
        </select>

        <div className="mt-2 flex flex-wrap gap-1">
          {["#efe4d3", "#d8c8b2", "#a8a49e", "#6d4a33", "#2f2d2b", "#5c7a52", "#000000"].map(
            (color) => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => runTool("change_color", { objectId: object.id, color })}
                className="h-6 w-6 rounded-full border border-line"
                style={{ backgroundColor: color }}
              />
            )
          )}
        </div>
      </Section>

      <Section title="AI 편집">
        <div className="flex flex-wrap gap-1">
          <MiniButton
            onClick={() =>
              startJob("/generate", { prompt: `${object.name}을(를) 더 자연스럽게 다듬는다.` })
            }
          >
            이 장면 재생성
          </MiniButton>
          <MiniButton onClick={() => runTool("duplicate_object", { objectId: object.id })}>
            복제
          </MiniButton>
          <MiniButton onClick={() => runTool("replace_object", { objectId: object.id, query: object.type })}>
            교체
          </MiniButton>
          <MiniButton
            tone="danger"
            onClick={() => runTool("delete_object", { objectId: object.id })}
          >
            삭제
          </MiniButton>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-1.5 text-[11px] font-medium tracking-tight text-muted">{title}</p>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{children}</span>
    </div>
  );
}


/**
 * 실 속성 — 이름과 실측 치수.
 *
 * 도면을 스캔하면 치수선이 그어진 실만 정확하고, 치수선이 없는 실은 모델이 눈대중으로
 * 그린 값이 들어온다. 같은 도면을 두 번 넣어도 달라지는 종류의 오차라 AI 쪽에서
 * 없앨 수 없다. 그래서 줄자로 잰 값을 여기에 적으면 그 실만 늘어나고 이웃 실과 벽은
 * 붙어 있는 관계를 그대로 지킨다 — 벽을 하나씩 끌어 맞출 필요가 없다.
 */
function AreaProperties({ area }: { area: RoomArea }) {
  const runTool = useEditorStore((state) => state.runTool);

  const xs = area.points.map(([x]) => x);
  const ys = area.points.map(([, y]) => y);
  const width = Math.max(...xs) - Math.min(...xs);
  const length = Math.max(...ys) - Math.min(...ys);
  const squareMeters = toSquareMeters(polygonArea(area.points));

  return (
    <div className="space-y-4 p-3 text-[12px]">
      <section>
        <p className="text-[13px] font-semibold">{area.name}</p>
        <p className="mt-0.5 text-[11px] text-muted">
          실 · {squareMeters.toFixed(1)}㎡ ({(squareMeters / 3.3058).toFixed(1)}평)
        </p>
      </section>

      <Section title="실측 치수 (mm)">
        <div className="space-y-1">
          <NumberField
            label="폭"
            value={width}
            unit="mm"
            min={600}
            onCommit={(next) => runTool("resize_room_area", { areaId: area.id, width: next })}
          />
          <NumberField
            label="깊이"
            value={length}
            unit="mm"
            min={600}
            onCommit={(next) => runTool("resize_room_area", { areaId: area.id, length: next })}
          />
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          줄자로 잰 값을 적으면 이 실만 늘어나고 이웃 실과 벽은 붙은 채로 따라옵니다.
          도면에 치수선이 없어 잘못 읽힌 방을 여기서 바로잡습니다.
        </p>
      </Section>

      <Section title="이름">
        <input
          defaultValue={area.name}
          onBlur={(event) => {
            const next = event.target.value.trim();
            if (next && next !== area.name) {
              void runTool("update_room_area", { areaId: area.id, name: next });
            }
          }}
          className="w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1 text-[12px]"
        />
      </Section>
    </div>
  );
}

function MiniButton({
  children,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-md border px-2 py-1 text-[11.5px] transition-colors",
        tone === "danger"
          ? "border-danger/30 text-danger hover:bg-danger/10"
          : "border-line text-ink-soft hover:bg-sunken",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
