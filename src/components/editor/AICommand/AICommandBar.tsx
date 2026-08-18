"use client";

import { useState } from "react";
import { useEditorStore, useSelectedObject } from "@/lib/editor/store";

const EXAMPLES = [
  "소파를 베이지색으로 바꿔줘",
  "이 공간을 Japandi로",
  "식물 두 개 추가",
  "테이블을 조금 작게",
  "벽을 더 밝게",
];

/** 에디터 하단 AI Command Bar — 항상 떠 있다 */
export function AICommandBar() {
  const runCommand = useEditorStore((state) => state.runCommand);
  const busy = useEditorStore((state) => state.busy);
  const lastMessage = useEditorStore((state) => state.lastMessage);
  const selected = useSelectedObject();
  const [value, setValue] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const instruction = value.trim();
    if (!instruction || busy) return;
    setValue("");
    await runCommand(instruction);
  };

  return (
    <div className="shrink-0 border-t border-line bg-surface px-3 py-2">
      <form onSubmit={submit} className="flex items-center gap-2">
        <span className="shrink-0 rounded-md bg-accent-soft px-2 py-1 text-[11px] font-medium text-accent">
          AI
        </span>
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={
            selected ? `${selected.name}에 대해 — 무엇을 바꿔볼까요?` : "무엇을 바꿔볼까요?"
          }
          disabled={Boolean(busy)}
          className="h-9 flex-1 rounded-lg border border-line bg-canvas px-3 text-[13px] disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={Boolean(busy) || !value.trim()}
          className="h-9 shrink-0 rounded-lg bg-accent px-4 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          실행
        </button>
      </form>

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        {lastMessage ? (
          <span className="text-[11.5px] text-muted">{lastMessage}</span>
        ) : (
          EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setValue(example)}
              className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:bg-sunken hover:text-ink"
            >
              {example}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
