"use client";

import { useEditorStore, useSelectedObject } from "@/lib/editor/store";
import { DEFAULT_MATERIALS } from "@/models/materials";
import { NumberField } from "../shared/NumberField";

/** 선택한 객체의 속성 · 변형 · 재질 · AI 편집 */
export function PropertiesPanel() {
  const object = useSelectedObject();
  const scene = useEditorStore((state) => state.scene);
  const runTool = useEditorStore((state) => state.runTool);
  const startJob = useEditorStore((state) => state.startJob);

  if (!object) {
    return (
      <p className="px-3 py-6 text-center text-[12px] leading-relaxed text-muted">
        객체를 선택하면 속성이 표시됩니다.
      </p>
    );
  }

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

      <Section title="위치">
        <Row label="X">{(object.screen.x * 100).toFixed(1)}%</Row>
        <Row label="Y">{(object.screen.y * 100).toFixed(1)}%</Row>
        <Row label="깊이">{object.depth.toFixed(2)}</Row>
      </Section>

      <Section title="변형">
        <Row label="회전">{object.screen.rotation.toFixed(0)}°</Row>
        <Row label="폭">{(object.screen.width * 100).toFixed(1)}%</Row>
        <Row label="높이">{(object.screen.height * 100).toFixed(1)}%</Row>
        <div className="mt-1.5 flex gap-1">
          <MiniButton onClick={() => runTool("scale_object", { objectId: object.id, factor: 1.1 })}>
            +10%
          </MiniButton>
          <MiniButton onClick={() => runTool("scale_object", { objectId: object.id, factor: 0.9 })}>
            −10%
          </MiniButton>
          <MiniButton onClick={() => runTool("rotate_object", { objectId: object.id, degrees: 15 })}>
            15° 회전
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
