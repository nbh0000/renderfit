"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { CHAT_MAX, CHAT_PAGE, toChatMessage, type ChatMessage } from "@/lib/community";
import { timeAgo } from "@/lib/timeAgo";

interface Props {
  initial: ChatMessage[];
  /** 지금 보는 사람 — 내 메시지에만 삭제 단추가 붙는다 */
  viewerId: string | null;
  /** Supabase 가 연결돼 있는지. 아니면 실시간 대신 주기적으로 다시 읽는다 */
  live: boolean;
}

/**
 * 갤러리 실시간 대화.
 *
 * 새 글은 Supabase Realtime(postgres_changes)으로 받는다 — 내가 보낸 글도 같은
 * 경로로 돌아오므로 응답을 목록에 따로 붙이지 않는다(두 번 보인다). 삭제도 같다.
 * 로컬 mock 모드에는 Realtime 이 없어 3초마다 다시 읽는다.
 */
export function GalleryChat({ initial, viewerId, live }: Props) {
  const { toast } = useToast();
  const [messages, setMessages] = useState(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  /* 새 글이 오면 아래로 — 단, 위로 올려 옛 글을 읽는 중이면 건드리지 않는다 */
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!live) {
      const timer = setInterval(async () => {
        const res = await fetch("/api/gallery/chat").catch(() => null);
        if (!res?.ok) return;
        const data = await res.json();
        setMessages(data.messages as ChatMessage[]);
      }, 3000);
      return () => clearInterval(timer);
    }

    const supabase = createClient();
    if (!supabase) return;

    const channel = supabase
      .channel("gallery-chat")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "gallery_chat_messages" },
        (payload) => {
          const message = toChatMessage(payload.new as Parameters<typeof toChatMessage>[0]);
          setMessages((prev) =>
            prev.some((m) => m.id === message.id) ? prev : [...prev, message].slice(-CHAT_PAGE)
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "gallery_chat_messages" },
        (payload) => {
          const id = (payload.old as { id?: string }).id;
          if (id) setMessages((prev) => prev.filter((m) => m.id !== id));
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [live]);

  const send = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/gallery/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "메시지를 보내지 못했습니다.");
      // mock 모드에는 실시간 경로가 없으니 직접 붙인다
      if (!live) setMessages((prev) => [...prev, data.message as ChatMessage]);
      setDraft("");
      stickToBottom.current = true;
    } catch (error) {
      toast(error instanceof Error ? error.message : "메시지를 보내지 못했습니다.", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const res = await fetch(`/api/gallery/chat/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      toast(data.error ?? "메시지를 지우지 못했습니다.", "error");
      return;
    }
    if (!live) setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  return (
    <aside
      aria-label="실시간 대화"
      className="flex h-[520px] flex-col rounded-[var(--radius-card)] border border-line bg-surface lg:sticky lg:top-20 lg:h-[calc(100vh-6rem)]"
    >
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
        </span>
        <h2 className="text-[14px] font-semibold">실시간 대화</h2>
        <span className="ml-auto text-[11.5px] text-muted">인테리어 이야기를 나눠 보세요</span>
      </header>

      <div
        ref={listRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted">
            아직 대화가 없습니다. 첫 인사를 남겨 보세요.
          </p>
        ) : (
          messages.map((message) => {
            const mine = viewerId !== null && message.userId === viewerId;
            return (
              <div key={message.id} className="group text-[13px]">
                <div className="flex items-baseline gap-1.5 text-[11.5px] text-muted">
                  <span className={mine ? "font-medium text-accent" : "font-medium text-ink-soft"}>
                    {message.authorName}
                  </span>
                  <time dateTime={message.createdAt}>{timeAgo(message.createdAt)}</time>
                  {(mine || !live) && (
                    <button
                      type="button"
                      onClick={() => void remove(message.id)}
                      className="ml-auto opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                      aria-label="메시지 삭제"
                    >
                      삭제
                    </button>
                  )}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words leading-relaxed">
                  {message.body}
                </p>
              </div>
            );
          })
        )}
      </div>

      {viewerId || !live ? (
        <form
          className="border-t border-line p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, CHAT_MAX))}
              onKeyDown={(event) => {
                // 엔터로 보내고, Shift+엔터로 줄을 바꾼다. 한글 조합 중에는 보내지 않는다
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder="메시지를 입력하세요"
              className="min-h-[40px] flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed placeholder:text-muted/70"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="inline-flex h-10 shrink-0 items-center rounded-lg bg-ink px-3.5 text-[13px] font-medium text-white hover:bg-ink/90 disabled:opacity-40"
            >
              보내기
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted">
            광고·욕설·음란·비방 글은 자동으로 걸러지며, 반복되면 글쓰기가 차단됩니다.
          </p>
        </form>
      ) : (
        <p className="border-t border-line px-4 py-3 text-[13px] text-muted">
          <Link href="/login" className="text-ink underline underline-offset-2">
            로그인
          </Link>
          하면 대화에 참여할 수 있습니다.
        </p>
      )}
    </aside>
  );
}
