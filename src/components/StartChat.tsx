"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SUGGESTED_PROMPTS } from "@/config/assistant";

/**
 * 시작 화면 챗.
 *
 * 첫 화면에서 하는 일은 두 가지다.
 *  - 일반: 물어보면 답한다 (서비스 전용 챗봇 — /api/chat)
 *  - 전문가: 실측 도면·3D 편집기로 바로 넘어간다
 */

type Track = "quick" | "pro";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export function StartChat() {
  const router = useRouter();
  const [track, setTrack] = useState<Track>("quick");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || pending) return;

    // 전문가 모드는 대화 대신 편집기로 넘긴다.
    if (track === "pro") {
      router.push("/dashboard");
      return;
    }

    const next = [...messages, { role: "user" as const, content: question }];
    setMessages(next);
    setInput("");
    setPending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const data = await response.json();
      setMessages([
        ...next,
        {
          role: "assistant",
          content: data.reply ?? "답변을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.",
        },
      ]);
    } catch {
      setMessages([
        ...next,
        { role: "assistant", content: "연결에 실패했습니다. 잠시 후 다시 시도해 주세요." },
      ]);
    } finally {
      setPending(false);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: 999999 }));
    }
  };

  return (
    <div className="w-full max-w-[680px] text-ink">
      {/* 큰 헤드라인을 걷어내고 이 줄이 문서의 h1을 맡는다 */}
      <h1 className="serif-display text-center text-[24px] leading-tight text-ink sm:text-[28px] lg:text-left">
        사진 한 장으로 시작하는 인테리어
      </h1>

      {/* 일반 / 전문가 */}
      <div className="mt-5 flex justify-center lg:justify-start">
        <div className="flex gap-0.5 rounded-full border border-line bg-surface p-0.5">
          {(
            [
              ["quick", "일반", "사진으로 시안 만들기"],
              ["pro", "전문가", "실측 도면·3D로 작업"],
            ] as [Track, string, string][]
          ).map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTrack(id)}
              title={hint}
              className={[
                "rounded-full px-4 py-1.5 text-[13px] transition-colors",
                track === id ? "bg-ink font-medium text-white" : "text-muted hover:text-ink",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {messages.length > 0 && (
        <div
          ref={listRef}
          className="scrollbar-slim mt-5 max-h-[320px] space-y-3 overflow-y-auto rounded-[var(--radius-card)] border border-line bg-surface p-4"
        >
          {messages.map((message, index) => (
            <div
              key={index}
              className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <p
                className={[
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed",
                  message.role === "user" ? "bg-ink text-white" : "bg-sunken text-ink-soft",
                ].join(" ")}
              >
                {message.content}
              </p>
            </div>
          ))}
          {pending && <p className="text-[12.5px] text-muted">답변을 쓰고 있습니다…</p>}
        </div>
      )}

      {/* 입력 */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
        className="mt-6 rounded-2xl border border-line-strong bg-surface p-3.5 shadow-[0_10px_30px_rgba(27,28,29,0.06)]"
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={
            track === "pro"
              ? "전문가 모드는 실측 도면 편집기로 이동합니다"
              : "인테리어에 대해 무엇이든 물어보세요."
          }
          className="h-10 w-full bg-transparent px-1 text-[14px] text-ink outline-none placeholder:text-muted"
        />

        <div className="mt-1 flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.push(track === "pro" ? "/dashboard" : "/studio")}
            className="rounded-md px-2 py-1 text-[12.5px] text-muted hover:bg-sunken hover:text-ink"
          >
            {track === "pro" ? "도면 편집기 열기" : "사진 올려서 시작"}
          </button>

          <button
            type="submit"
            disabled={pending || (track === "quick" && !input.trim())}
            className="h-9 rounded-lg bg-ink px-4 text-[13px] font-medium text-white transition-colors hover:bg-ink-soft disabled:opacity-40"
          >
            {track === "pro" ? "시작하기" : "보내기"}
          </button>
        </div>
      </form>

      {track === "quick" && messages.length === 0 && (
        <div className="mt-4 flex flex-wrap justify-center gap-1.5 lg:justify-start">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => void send(prompt)}
              className="rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:border-line-strong hover:bg-sunken hover:text-ink"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
