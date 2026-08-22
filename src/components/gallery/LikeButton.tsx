"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";

interface Props {
  slug: string;
  likeCount: number;
  liked: boolean;
  /** 목록 카드에 얹는 작은 형태인지 */
  compact?: boolean;
  className?: string;
}

function Heart({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-[15px] w-[15px]">
      <path
        d="M12 20.3 4.6 13a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9A4.6 4.6 0 0 1 19.4 13Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 좋아요 버튼.
 *
 * 서버 응답을 기다리지 않고 먼저 눌린 모양으로 바꾼다 — 목록에서 연달아 누를 때
 * 반응이 없으면 눌리지 않은 줄 알고 두 번 누르게 된다. 실패하면 되돌린다.
 *
 * 정렬이 좋아요순일 수 있으므로 성공하면 라우터를 새로고침해 순서를 맞춘다.
 */
export function LikeButton({ slug, likeCount, liked, compact, className }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [state, setState] = useState({ liked, count: likeCount });
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    const previous = state;

    setBusy(true);
    setState({ liked: !previous.liked, count: previous.count + (previous.liked ? -1 : 1) });

    try {
      const res = await fetch(`/api/gallery/${encodeURIComponent(slug)}/like`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "좋아요를 반영하지 못했습니다.");

      setState({ liked: data.liked, count: data.likeCount });
      router.refresh();
    } catch (error) {
      setState(previous);
      toast(error instanceof Error ? error.message : "좋아요를 반영하지 못했습니다.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-pressed={state.liked}
      aria-label={state.liked ? "좋아요 취소" : "좋아요"}
      className={[
        "inline-flex items-center gap-1.5 rounded-full border transition-colors",
        compact ? "px-2 py-0.5 text-[11.5px]" : "h-9 px-3.5 text-[13px]",
        state.liked
          ? "border-danger/40 bg-danger/8 text-danger"
          : "border-line text-muted hover:border-line-strong hover:text-ink",
        className ?? "",
      ].join(" ")}
    >
      <Heart filled={state.liked} />
      <span className="tabular-nums">{state.count.toLocaleString("ko-KR")}</span>
    </button>
  );
}
