"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/Toast";

/**
 * 갤러리에서 내리기 (공개한 본인만 보인다).
 *
 * 시안 자체는 지우지 않고 공개만 해제한다 — 결과물은 보관함에 남아 다시 공개할 수 있다.
 * 브라우저 confirm 대신 두 번 누르게 해서 실수를 막는다.
 */
export function GalleryDeleteButton({ slug }: { slug: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/gallery/${encodeURIComponent(slug)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "삭제하지 못했습니다.");
      toast("갤러리에서 내렸습니다", "success");
      router.push("/gallery");
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "삭제하지 못했습니다.", "error");
      setBusy(false);
      setArmed(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void remove()}
      onBlur={() => setArmed(false)}
      disabled={busy}
      className={[
        "ml-auto rounded-md border px-2.5 py-1 text-[12px] transition-colors",
        armed
          ? "border-danger text-danger hover:bg-danger/10"
          : "border-line text-muted hover:text-ink",
      ].join(" ")}
    >
      {busy ? "내리는 중…" : armed ? "정말 내릴까요? 한 번 더" : "갤러리에서 내리기"}
    </button>
  );
}
