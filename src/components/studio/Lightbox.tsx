"use client";

import { useEffect } from "react";
import type { GenerationResultImage } from "@/lib/types";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { Watermark } from "./Watermark";

interface Props {
  result: GenerationResultImage;
  originalUrl: string | null;
  compare: boolean;
  onCompareChange: (value: boolean) => void;
  onClose: () => void;
  onDownload: () => void;
}

export function Lightbox({
  result,
  originalUrl,
  compare,
  onCompareChange,
  onClose,
  onDownload,
}: Props) {
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

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-ink/85 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-3 overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 text-white">
          <div className="flex gap-1">
            <TabButton active={!compare} onClick={() => onCompareChange(false)} label="시안" />
            <TabButton
              active={compare}
              onClick={() => onCompareChange(true)}
              label="원본과 비교"
              disabled={!originalUrl}
            />
          </div>
          <div className="flex gap-1">
            <TabButton active={false} onClick={onDownload} label="다운로드" />
            <TabButton active={false} onClick={onClose} label="닫기" />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center">
          {compare && originalUrl ? (
            <BeforeAfterSlider
              beforeSrc={originalUrl}
              afterSrc={result.url}
              className="w-full max-w-4xl"
              afterOverlay={result.watermarked ? <Watermark /> : undefined}
            />
          ) : (
            <div className="relative max-h-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.url}
                alt="생성 시안 확대"
                className="max-h-[75dvh] w-auto rounded-[var(--radius-card)] object-contain"
              />
              {result.watermarked && <Watermark className="rounded-[var(--radius-card)]" />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "rounded-lg px-3 py-1.5 text-[13px] transition-colors disabled:opacity-40",
        active ? "bg-white text-ink" : "bg-white/10 text-white hover:bg-white/20",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
