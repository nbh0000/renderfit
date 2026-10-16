"use client";

import { useState } from "react";
import Link from "next/link";
import { useToast } from "@/components/ui/Toast";
import { COMMENT_MAX, type Comment } from "@/lib/community";
import { timeAgo } from "@/lib/timeAgo";

interface Props {
  slug: string;
  initial: Comment[];
  /** 로그인해 있는지 — 아니면 입력창 대신 로그인 안내를 보여 준다 */
  authed: boolean;
}

/**
 * 시안 댓글.
 *
 * 처음 목록은 서버가 그려 주고, 이후에는 응답으로 받은 한 줄만 붙인다 —
 * 댓글 하나 달았다고 페이지 전체를 다시 그리지 않는다.
 */
export function CommentSection({ slug, initial, authed }: Props) {
  const { toast } = useToast();
  const [comments, setComments] = useState(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const base = `/api/gallery/${encodeURIComponent(slug)}/comments`;

  const submit = async () => {
    const body = draft.trim();
    if (!body || busy) return;
    setBusy(true);
    try {
      const res = await fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "댓글을 저장하지 못했습니다.");
      setComments((prev) => [...prev, data.comment as Comment]);
      setDraft("");
    } catch (error) {
      toast(error instanceof Error ? error.message : "댓글을 저장하지 못했습니다.", "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    const previous = comments;
    setComments((prev) => prev.filter((comment) => comment.id !== id));
    const res = await fetch(`${base}/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setComments(previous);
      const data = await res.json().catch(() => ({}));
      toast(data.error ?? "댓글을 지우지 못했습니다.", "error");
    }
  };

  return (
    <section className="mt-8" aria-labelledby="comments-heading">
      <h2 id="comments-heading" className="text-[15px] font-semibold">
        댓글 <span className="tabular-nums text-muted">{comments.length}</span>
      </h2>

      {comments.length > 0 && (
        <ul className="mt-3 divide-y divide-line">
          {comments.map((comment) => (
            <li key={comment.id} className="py-3">
              <div className="flex items-baseline gap-2 text-[12px] text-muted">
                <span className="font-medium text-ink-soft">{comment.authorName}</span>
                <time dateTime={comment.createdAt}>{timeAgo(comment.createdAt)}</time>
                {comment.canDelete && (
                  <button
                    type="button"
                    onClick={() => void remove(comment.id)}
                    className="ml-auto text-[11.5px] text-muted hover:text-danger"
                  >
                    삭제
                  </button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed">
                {comment.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      {authed ? (
        <form
          className="mt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, COMMENT_MAX))}
            rows={3}
            placeholder="이 시안에 대한 생각을 남겨 보세요"
            className="w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed placeholder:text-muted/70"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[11.5px] tabular-nums text-muted">
              {draft.length}/{COMMENT_MAX}
            </span>
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="inline-flex h-9 items-center rounded-lg bg-ink px-4 text-[13px] font-medium text-white hover:bg-ink/90 disabled:opacity-40"
            >
              댓글 남기기
            </button>
          </div>
        </form>
      ) : (
        <p className="mt-3 rounded-lg border border-dashed border-line-strong px-4 py-3 text-[13px] text-muted">
          <Link href="/login" className="text-ink underline underline-offset-2">
            로그인
          </Link>
          하면 댓글을 남길 수 있습니다.
        </p>
      )}
    </section>
  );
}
