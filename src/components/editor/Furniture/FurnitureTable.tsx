"use client";

import { useEditorStore } from "@/lib/editor/store";

/**
 * 가구 목록 표.
 *
 * 레이어 패널이 "무엇이 있는가"를 보여 준다면, 이 표는 "각각이 몇 mm인가"를 다룬다.
 * 실측한 가구 치수를 하나씩 다이얼로그로 고치는 대신 표에서 바로 고칠 수 있어야
 * 실제 도면 작업 속도가 난다.
 */

/** 표에서 편집할 수 있는 치수 */
const COLUMNS: { key: "width" | "depth" | "height"; label: string }[] = [
  { key: "width", label: "폭" },
  { key: "depth", label: "깊이" },
  { key: "height", label: "높이" },
];

export function FurnitureTable() {
  const scene = useEditorStore((state) => state.scene);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const select = useEditorStore((state) => state.select);
  const runTool = useEditorStore((state) => state.runTool);

  const objects = (scene?.objects ?? []).filter(
    (object) => object.type !== "wall" && object.type !== "floor" && object.type !== "ceiling"
  );

  if (objects.length === 0) {
    return (
      <p className="p-3 text-[11.5px] leading-relaxed text-muted">
        아직 배치한 가구가 없습니다. 왼쪽 카탈로그에서 골라 넣으면 여기에 치수와 함께 쌓입니다.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            <th className="py-1.5 pl-2 font-medium">이름</th>
            {COLUMNS.map((column) => (
              <th key={column.key} className="w-14 py-1.5 text-right font-medium">
                {column.label}
              </th>
            ))}
            <th className="w-10 py-1.5 text-center font-medium">보임</th>
          </tr>
        </thead>

        <tbody>
          {objects.map((object) => {
            const selected = selectedIds.includes(object.id);
            return (
              <tr
                key={object.id}
                onClick={() => select([object.id])}
                className={[
                  "cursor-pointer border-b border-line/60 transition-colors",
                  selected ? "bg-accent-soft" : "hover:bg-sunken",
                ].join(" ")}
              >
                <td className="py-1 pl-2">
                  <input
                    defaultValue={object.name}
                    onClick={(event) => event.stopPropagation()}
                    onBlur={(event) => {
                      const name = event.target.value.trim();
                      if (name && name !== object.name) {
                        void runTool("rename_object", { objectId: object.id, name });
                      }
                    }}
                    className="w-full truncate bg-transparent outline-none focus:underline"
                  />
                </td>

                {COLUMNS.map((column) => (
                  <td key={column.key} className="py-1 text-right">
                    <input
                      type="number"
                      defaultValue={Math.round(object.dimensions[column.key])}
                      onClick={(event) => event.stopPropagation()}
                      onBlur={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isFinite(value) || value <= 0) return;
                        if (Math.round(object.dimensions[column.key]) === value) return;
                        void runTool("set_dimensions", {
                          objectId: object.id,
                          [column.key]: value,
                        });
                      }}
                      className="w-12 bg-transparent text-right tabular-nums outline-none focus:underline"
                    />
                  </td>
                ))}

                <td className="py-1 text-center">
                  <input
                    type="checkbox"
                    checked={object.visibility}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      void runTool("change_visibility", {
                        objectId: object.id,
                        visible: event.target.checked,
                      })
                    }
                    className="accent-[var(--color-accent)]"
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="px-2 py-1.5 text-[10.5px] text-muted">
        치수 단위는 mm입니다. 값을 고치면 평면도·3D에 바로 반영됩니다.
      </p>
    </div>
  );
}
