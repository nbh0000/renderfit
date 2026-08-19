"use client";

import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "@/lib/editor/store";
import { summarizeScene } from "@/scene/serialization";

/**
 * 편집기 AI 도우미.
 *
 * 말로 시킨 것을 실제 편집으로 실행한다 — 편집 명령이면 Scene operation으로,
 * 상담성 질문이면 서비스 전용 챗봇(/api/chat)으로 넘긴다.
 */

interface Message {
  role: "user" | "assistant";
  content: string;
  /** 실제로 장면을 바꾼 답변인지 */
  applied?: boolean;
}

/** 버튼 한 번으로 실행되는 자주 쓰는 작업 */
const QUICK_ACTIONS: { label: string; kind: "tool" | "job" | "ask"; value: string }[] = [
  { label: "가구 자동 배치", kind: "tool", value: "arrange_objects" },
  { label: "이 장면 다시 생성", kind: "job", value: "/generate" },
  { label: "가구 추천", kind: "ask", value: "이 방에 어울리는 가구를 3가지만 추천해 줘." },
  { label: "마감재 추천", kind: "ask", value: "이 방의 바닥·벽 마감재 조합을 추천해 줘." },
];

export function AgentPanel() {
  const scene = useEditorStore((state) => state.scene);
  const runCommand = useEditorStore((state) => state.runCommand);
  const runTool = useEditorStore((state) => state.runTool);
  const startJob = useEditorStore((state) => state.startJob);
  const busy = useEditorStore((state) => state.busy);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, pending]);

  const push = (message: Message) => setMessages((current) => [...current, message]);

  /** 상담성 질문 — 장면 요약을 함께 넘겨 맥락 있는 답을 받는다 */
  const ask = async (question: string) => {
    const context = scene?.sceneId ? `현재 작업 중인 공간: ${summarizeScene(scene)}` : "";
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          ...(context ? [{ role: "assistant" as const, content: context }] : []),
          { role: "user" as const, content: question },
        ],
      }),
    });
    const data = await response.json();
    return (data.reply as string) ?? "답변을 가져오지 못했습니다.";
  };

  const send = async (text: string) => {
    const instruction = text.trim();
    if (!instruction || pending) return;

    push({ role: "user", content: instruction });
    setInput("");
    setPending(true);

    try {
      // 먼저 편집 명령으로 해석해 본다.
      const result = await runCommand(instruction);
      const understood = result.ok && result.intent && result.intent !== "UNKNOWN";

      if (understood) {
        push({ role: "assistant", content: result.message || "적용했습니다.", applied: true });
      } else {
        push({ role: "assistant", content: await ask(instruction) });
      }
    } catch {
      push({ role: "assistant", content: "실행에 실패했습니다. 잠시 후 다시 시도해 주세요." });
    } finally {
      setPending(false);
    }
  };

  const runQuickAction = async (action: (typeof QUICK_ACTIONS)[number]) => {
    if (pending) return;
    push({ role: "user", content: action.label });
    setPending(true);

    try {
      if (action.kind === "tool") {
        const result = await runTool(action.value);
        push({
          role: "assistant",
          content: result.message || (result.ok ? "적용했습니다." : "적용하지 못했습니다."),
          applied: result.ok,
        });
      } else if (action.kind === "job") {
        await startJob(action.value);
        push({
          role: "assistant",
          content: "생성을 시작했습니다. 완료되면 장면에 반영됩니다.",
          applied: true,
        });
      } else {
        push({ role: "assistant", content: await ask(action.value) });
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={listRef} className="scrollbar-slim min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="rounded-lg bg-sunken p-3 text-[12px] leading-relaxed text-ink-soft">
            <p className="font-medium text-ink">무엇을 도와드릴까요?</p>
            <p className="mt-1.5">
              &ldquo;소파를 베이지색으로&rdquo;, &ldquo;천장 높이 2400으로&rdquo;, &ldquo;식물 두 개
              추가&rdquo;처럼 말하면 바로 반영합니다. 인테리어 상담도 가능합니다.
            </p>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={[
                "max-w-[92%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[12.5px] leading-relaxed",
                message.role === "user" ? "bg-accent text-white" : "bg-sunken text-ink-soft",
              ].join(" ")}
            >
              {message.content}
              {message.applied && (
                <span className="mt-1 block text-[10.5px] text-success">장면에 적용됨</span>
              )}
            </div>
          </div>
        ))}

        {(pending || busy) && (
          <p className="text-[11.5px] text-muted">{busy ?? "생각하고 있습니다…"}</p>
        )}
      </div>

      <div className="shrink-0 border-t border-line p-2">
        <div className="mb-2 flex flex-wrap gap-1">
          {QUICK_ACTIONS.map((action) => (
            <button
              key={action.label}
              type="button"
              disabled={pending}
              onClick={() => void runQuickAction(action)}
              className="rounded-md border border-line px-2 py-1 text-[11px] text-ink-soft transition-colors hover:border-line-strong hover:bg-sunken disabled:opacity-40"
            >
              {action.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
          className="flex gap-1.5"
        >
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="무엇을 바꿔볼까요?"
            disabled={pending}
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2.5 text-[12.5px] disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={pending || !input.trim()}
            className="h-9 shrink-0 rounded-lg bg-accent px-3 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            보내기
          </button>
        </form>
      </div>
    </div>
  );
}
