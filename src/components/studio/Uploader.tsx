"use client";

import { useCallback, useRef, useState } from "react";
import { ACCEPTED_EXT_LABEL, ACCEPTED_MIME, formatBytes, validateImageFile } from "@/lib/upload";
import type { InputType } from "@/config/modes";

export interface UploadValue {
  file: File;
  url: string;
}

const HINTS: Record<InputType, string> = {
  photo: "공간 사진을 올려 주세요",
};

interface Props {
  value: UploadValue | null;
  onChange: (value: UploadValue | null) => void;
  inputType: InputType;
  onError: (message: string) => void;
}

export function Uploader({ value, onChange, inputType, onError }: Props) {
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const accept = useCallback(
    (file: File | undefined | null) => {
      if (!file) return;
      const check = validateImageFile(file);
      if (!check.ok) {
        onError(check.message!);
        return;
      }
      if (value) URL.revokeObjectURL(value.url);
      onChange({ file, url: URL.createObjectURL(file) });
    },
    [onChange, onError, value]
  );

  if (value) {
    return (
      <div className="space-y-2">
        <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-sunken">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.url} alt="업로드한 원본" className="max-h-64 w-full object-contain" />
        </div>
        <div className="flex items-center justify-between text-[13px] text-muted">
          <span className="truncate">
            {value.file.name} · {formatBytes(value.file.size)}
          </span>
          <button
            type="button"
            className="shrink-0 text-accent hover:underline"
            onClick={() => {
              URL.revokeObjectURL(value.url);
              onChange(null);
            }}
          >
            다시 올리기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInput.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") fileInput.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          accept(e.dataTransfer.files?.[0]);
        }}
        className={[
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed px-4 py-10 text-center transition-colors",
          dragging ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:bg-sunken",
        ].join(" ")}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" className="text-muted" aria-hidden>
          <path
            d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <p className="text-sm font-medium">{HINTS[inputType]}</p>
        <p className="text-[12px] text-muted">
          드래그해서 놓거나 눌러서 선택 · {ACCEPTED_EXT_LABEL} · 최대 10MB
        </p>
      </div>

      <button
        type="button"
        onClick={() => cameraInput.current?.click()}
        className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-surface py-2.5 text-[13px] text-ink-soft hover:bg-sunken sm:hidden"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M4 8h3l1.5-2h7L17 8h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="13" r="3.2" stroke="currentColor" strokeWidth="1.6" />
        </svg>
        카메라로 촬영
      </button>

      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED_MIME.join(",")}
        className="hidden"
        onChange={(e) => accept(e.target.files?.[0])}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => accept(e.target.files?.[0])}
      />
    </div>
  );
}
