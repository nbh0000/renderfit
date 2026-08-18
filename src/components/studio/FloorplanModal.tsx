"use client";

import { useEffect } from "react";
import { FLOORPLAN_DISCLAIMER } from "@/config/modes";
import { composeImage, saveBlob } from "@/lib/compose-download";
import { useToast } from "@/components/ui/Toast";

interface Props {
  /** 생성된 배치도 URL. 생성 중이면 null */
  url: string | null;
  loading: boolean;
  onClose: () => void;
}

/**
 * 참고용 배치도 뷰어.
 * 이미지 위와 UI 양쪽에 고지 문구를 고정으로 노출하고, 다운로드 파일에도 굽는다.
 */
export function FloorplanModal({ url, loading, onClose }: Props) {
  const { toast } = useToast();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const download = async () => {
    if (!url) return;
    try {
      const blob = await composeImage(url, { disclaimer: FLOORPLAN_DISCLAIMER });
      saveBlob(blob, "배치도-참고용.png");
    } catch {
      toast("배치도를 내려받지 못했습니다.", "error");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/85 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label="참고용 배치도"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl overflow-hidden rounded-[var(--radius-card)] bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-[14px] font-semibold">배치도 (참고용)</h2>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={download}
              disabled={!url}
              className="rounded-md px-2.5 py-1 text-[12.5px] text-ink-soft hover:bg-sunken disabled:opacity-40"
            >
              다운로드
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2.5 py-1 text-[12.5px] text-ink-soft hover:bg-sunken"
            >
              닫기
            </button>
          </div>
        </div>

        <div className="relative bg-sunken">
          {loading || !url ? (
            <div className="flex aspect-[4/3] items-center justify-center">
              <div className="text-center">
                <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
                <p className="mt-3 text-[12.5px] text-muted">배치도를 만들고 있습니다…</p>
              </div>
            </div>
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="AI 추정 배치도" className="w-full object-contain" />
              {/* 이미지 위에 고정 노출되는 고지 */}
              <p className="absolute inset-x-0 bottom-0 bg-ink/75 px-3 py-2 text-[11.5px] leading-snug text-white">
                {FLOORPLAN_DISCLAIMER}
              </p>
            </>
          )}
        </div>

        {/* UI에도 같은 고지를 남긴다 */}
        <p className="border-t border-line px-4 py-3 text-[12px] leading-relaxed text-muted">
          {FLOORPLAN_DISCLAIMER} 치수는 표기하지 않습니다. 시공 전에는 반드시 실측 도면을 사용하세요.
        </p>
      </div>
    </div>
  );
}
