"use client";

import { useEditorStore } from "@/lib/editor/store";
import { levelsOf } from "@/scene/geometry";

/**
 * 층 탭.
 *
 * 복층이나 다락을 다루려면 "지금 몇 층을 그리고 있는지"가 화면에 늘 보여야 한다.
 * 도면 위쪽에 탭으로 두고, 층을 바꾸면 평면도는 그 층만 진하게 그리고
 * 바로 아래 층을 옅게 비춘다.
 */
export function LevelTabs() {
  const scene = useEditorStore((state) => state.scene);
  const activeLevelId = useEditorStore((state) => state.activeLevelId);
  const setActiveLevel = useEditorStore((state) => state.setActiveLevel);
  const runTool = useEditorStore((state) => state.runTool);

  if (!scene?.room) return null;

  const levels = levelsOf(scene.room);
  const active = activeLevelId ?? levels[0].id;

  const rename = async (id: string, current: string) => {
    const name = window.prompt("층 이름", current)?.trim();
    if (name && name !== current) await runTool("update_level", { levelId: id, name });
  };

  const remove = async (id: string, name: string) => {
    if (levels.length <= 1) return;
    if (!window.confirm(`${name}과(와) 그 층에 놓인 벽·실·가구를 함께 지웁니다. 계속할까요?`)) {
      return;
    }
    const result = await runTool("delete_level", { levelId: id });
    if (result.ok && active === id) setActiveLevel(null);
  };

  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b border-line bg-surface px-2 py-1">
      {levels.map((level) => {
        const selected = level.id === active;
        return (
          <button
            key={level.id}
            type="button"
            onClick={() => setActiveLevel(level.id)}
            onDoubleClick={() => void rename(level.id, level.name)}
            title={`바닥 ${level.elevation}mm · 천장고 ${level.height}mm (더블클릭으로 이름 변경)`}
            className={[
              "group flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] transition-colors",
              selected ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink",
            ].join(" ")}
          >
            {level.name}
            <span className="text-[10px] tabular-nums opacity-60">
              {(level.elevation / 1000).toFixed(1)}m
            </span>
            {selected && levels.length > 1 && (
              <span
                role="button"
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation();
                  void remove(level.id, level.name);
                }}
                className="ml-0.5 text-[11px] text-muted hover:text-danger"
              >
                ×
              </span>
            )}
          </button>
        );
      })}

      <button
        type="button"
        onClick={() => void runTool("add_level", {})}
        title="맨 위 층 위에 같은 높이로 한 층 얹습니다"
        className="rounded-md px-2 py-1 text-[13px] leading-none text-muted hover:bg-sunken hover:text-ink"
      >
        +
      </button>
    </div>
  );
}
