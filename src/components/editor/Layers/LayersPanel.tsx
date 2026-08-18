"use client";

import { useState } from "react";
import { useEditorStore } from "@/lib/editor/store";
import { OBJECT_GROUP_OF, type SceneObject } from "@/scene/types";

const GROUP_LABEL: Record<string, string> = {
  room: "공간",
  furniture: "가구",
  lighting: "조명",
  decoration: "장식",
  appliance: "가전",
};

export function LayersPanel() {
  const scene = useEditorStore((state) => state.scene);
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const select = useEditorStore((state) => state.select);
  const runTool = useEditorStore((state) => state.runTool);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const objects = [...(scene?.objects ?? [])].sort((a, b) => b.order - a.order);
  const groups = new Map<string, SceneObject[]>();
  for (const object of objects) {
    const group = OBJECT_GROUP_OF[object.type] ?? "furniture";
    groups.set(group, [...(groups.get(group) ?? []), object]);
  }

  const commitRename = async (object: SceneObject) => {
    const name = draftName.trim();
    setRenaming(null);
    if (name && name !== object.name) {
      await runTool("rename_object", { objectId: object.id, name });
    }
  };

  if (objects.length === 0) {
    return (
      <p className="px-3 py-6 text-center text-[12px] leading-relaxed text-muted">
        아직 객체가 없습니다.
        <br />
        사진을 분석하거나 에셋을 추가해 보세요.
      </p>
    );
  }

  return (
    <div className="space-y-3 p-2">
      {[...groups.entries()].map(([group, items]) => (
        <section key={group}>
          <p className="px-1.5 pb-1 text-[11px] font-medium tracking-tight text-muted">
            {GROUP_LABEL[group] ?? group}
          </p>
          <ul className="space-y-0.5">
            {items.map((object) => {
              const selected = selectedIds.includes(object.id);
              return (
                <li key={object.id}>
                  <div
                    className={[
                      "group flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px]",
                      selected ? "bg-accent-soft text-ink" : "hover:bg-sunken",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      title={object.visibility ? "숨기기" : "표시"}
                      onClick={() =>
                        runTool("change_visibility", {
                          objectId: object.id,
                          visibility: !object.visibility,
                        })
                      }
                      className="shrink-0 text-[11px] text-muted hover:text-ink"
                    >
                      {object.visibility ? "◉" : "○"}
                    </button>

                    <button
                      type="button"
                      title={object.locked ? "잠금 해제" : "잠금"}
                      onClick={() => runTool("change_lock", { objectId: object.id, locked: !object.locked })}
                      className="shrink-0 text-[11px] text-muted hover:text-ink"
                    >
                      {object.locked ? "🔒" : "🔓"}
                    </button>

                    {renaming === object.id ? (
                      <input
                        autoFocus
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        onBlur={() => void commitRename(object)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void commitRename(object);
                          if (event.key === "Escape") setRenaming(null);
                        }}
                        className="h-6 flex-1 rounded border border-line bg-surface px-1 text-[12px]"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => select([object.id])}
                        onDoubleClick={() => {
                          setRenaming(object.id);
                          setDraftName(object.name);
                        }}
                        className="flex-1 truncate text-left"
                      >
                        {object.name}
                      </button>
                    )}

                    <span className="hidden shrink-0 gap-0.5 group-hover:flex">
                      <button
                        type="button"
                        title="앞으로"
                        onClick={() => runTool("reorder_object", { objectId: object.id, order: object.order + 1 })}
                        className="px-1 text-[10px] text-muted hover:text-ink"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        title="뒤로"
                        onClick={() => runTool("reorder_object", { objectId: object.id, order: object.order - 1 })}
                        className="px-1 text-[10px] text-muted hover:text-ink"
                      >
                        ▼
                      </button>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
