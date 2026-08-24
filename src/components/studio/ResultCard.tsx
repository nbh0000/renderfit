"use client";

import { useState } from "react";
import type { GenerationResultImage } from "@/lib/types";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { Watermark } from "./Watermark";

interface Props {
  result: GenerationResultImage;
  originalUrl: string | null;
  index: number;
  onZoom: () => void;
  onRegenerate: () => void;
  onDownload: () => void;
  onFloorplan: () => void;
  /** 올린 원본을 편집기로 보내 실측 도면·3D로 세운다 */
  onOpenInEditor?: () => void;
  openingEditor?: boolean;
  /** @param anonymous 이름 없이 올린다 */
  onPublish: (anonymous: boolean) => void;
  /** 공개된 경우 생성된 갤러리 slug */
  publishedSlug?: string | null;
  publishing?: boolean;
}

export function ResultCard({
  result,
  originalUrl,
  index,
  onZoom,
  onRegenerate,
  onDownload,
  onFloorplan,
  onOpenInEditor,
  openingEditor,
  onPublish,
  publishedSlug,
  publishing,
}: Props) {
  const [compare, setCompare] = useState(false);
  /** 공개를 눌렀을 때, 이름을 붙일지 묻는 중 */
  const [asking, setAsking] = useState(false);

  return (
    <figure className="group overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      <div className="relative">
        {compare && originalUrl ? (
          <BeforeAfterSlider
            beforeSrc={originalUrl}
            afterSrc={result.url}
            className="w-full"
            afterOverlay={result.watermarked ? <Watermark /> : undefined}
          />
        ) : (
          <button
            type="button"
            onClick={onZoom}
            className="block w-full cursor-zoom-in"
            aria-label={`시안 ${index + 1} 확대`}
          >
            <span className="relative block aspect-[4/3] w-full overflow-hidden bg-sunken">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.url}
                alt={`생성 시안 ${index + 1}`}
                className="h-full w-full object-cover"
              />
              {result.watermarked && <Watermark />}
            </span>
          </button>
        )}
      </div>

      <figcaption className="border-t border-line px-2 py-2">
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <span className="mr-auto pl-1 text-[11.5px] text-muted">시안 {index + 1}</span>
          <CardAction onClick={onZoom} label="확대" />
          <CardAction onClick={onDownload} label="다운로드" />
          <CardAction
            onClick={() => setCompare((v) => !v)}
            label={compare ? "시안만" : "비교"}
            disabled={!originalUrl}
            active={compare}
          />
          <CardAction onClick={onRegenerate} label="다시 생성" />
        </div>
        {/*
          이 시안은 AI가 그린 그림이라 치수가 없다.
          평면도·입면도·3D가 필요하면 편집기(사진 → 벽·개구부 → 3D)로 보내야 한다.
        */}
        {onOpenInEditor && (
          <button
            type="button"
            onClick={onOpenInEditor}
            disabled={openingEditor}
            className="mt-1 w-full rounded-md border border-accent bg-accent-soft px-2 py-1.5 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent/10 disabled:opacity-50"
          >
            {openingEditor ? "편집기로 보내는 중…" : "편집기에서 도면·3D로 만들기"}
          </button>
        )}

        <div className="mt-1 flex gap-1">
          <button
            type="button"
            onClick={onFloorplan}
            className="flex-1 rounded-md border border-line px-2 py-1.5 text-[11.5px] text-ink-soft transition-colors hover:bg-sunken"
          >
            배치도 보기 (참고용)
          </button>
          {publishedSlug ? (
            <a
              href={`/gallery/${encodeURIComponent(publishedSlug)}`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-md border border-accent bg-accent-soft px-2 py-1.5 text-[11.5px] text-accent"
            >
              공개됨 ↗
            </a>
          ) : (
            <button
              type="button"
              onClick={() => setAsking((v) => !v)}
              disabled={publishing}
              className={`shrink-0 rounded-md border px-2 py-1.5 text-[11.5px] transition-colors disabled:opacity-50 ${
                asking ? "border-accent bg-accent-soft text-accent" : "border-line text-ink-soft hover:bg-sunken"
              }`}
            >
              {publishing ? "공개 중…" : "갤러리 공개"}
            </button>
          )}
        </div>

        {/*
          이름을 붙일지 먼저 묻는다.

          남의 집 사진이다. 스타일은 자랑하고 싶어도 자기 이름이 갤러리에 붙는 것은
          꺼리는 사람이 많고, 그 한 가지 때문에 공개를 안 누른다. 누르자마자 올라가
          버리면 되돌리는 일이 생기므로, 올리기 전에 고르게 한다.
        */}
        {asking && !publishedSlug && (
          <div className="mt-1 rounded-md border border-line bg-sunken p-2">
            <p className="px-0.5 text-[11.5px] text-ink-soft">
              갤러리에 어떻게 올릴까요? 사진은 언제든 다시 내릴 수 있습니다.
            </p>
            <div className="mt-1.5 flex gap-1">
              <button
                type="button"
                onClick={() => {
                  setAsking(false);
                  onPublish(true);
                }}
                className="flex-1 rounded-md border border-accent bg-accent-soft px-2 py-1.5 text-[11.5px] font-medium text-accent transition-colors hover:bg-accent/10"
              >
                익명으로 올리기
              </button>
              <button
                type="button"
                onClick={() => {
                  setAsking(false);
                  onPublish(false);
                }}
                className="flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-[11.5px] text-ink-soft transition-colors hover:bg-sunken"
              >
                내 이름으로 올리기
              </button>
            </div>
          </div>
        )}
      </figcaption>
    </figure>
  );
}

function CardAction({
  label,
  onClick,
  disabled,
  active,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        "rounded-md px-2 py-1 text-[11.5px] transition-colors disabled:opacity-40",
        active ? "bg-accent-soft text-accent" : "text-ink-soft hover:bg-sunken",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
