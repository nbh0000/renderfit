"use client";

import { useState } from "react";
import type { GenerationJob } from "@/lib/types";
import { BRAND } from "@/config/brand";
import { composeImage, saveBlob } from "@/lib/compose-download";
import { useToast } from "@/components/ui/Toast";
import { ResultCard } from "./ResultCard";
import { Lightbox } from "./Lightbox";

interface Props {
  job: GenerationJob | null;
  originalUrl: string | null;
  running: boolean;
  /** 생성 중 스켈레톤 장수 */
  expectedCount: number;
  onRegenerate: () => void;
  onFloorplan: (result: GenerationJob["results"][number]) => void;
}

export function ResultsPanel({
  job,
  originalUrl,
  running,
  expectedCount,
  onRegenerate,
  onFloorplan,
}: Props) {
  const { toast } = useToast();
  const [zoomIndex, setZoomIndex] = useState<number | null>(null);
  const [compare, setCompare] = useState(false);
  const [published, setPublished] = useState<Record<string, string>>({});
  const [publishing, setPublishing] = useState<string | null>(null);

  /** 사용자가 동의한 결과만 갤러리에 공개한다. */
  const publish = async (result: GenerationJob["results"][number]) => {
    if (!job) return;
    setPublishing(result.id);
    try {
      const res = await fetch(`/api/results/${result.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isPublic: true,
          imageUrl: result.url,
          roomId: job.settings.roomId,
          styleId: job.settings.styleId,
          width: result.width,
          height: result.height,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "공개하지 못했습니다.");
      setPublished((prev) => ({ ...prev, [result.id]: data.slug as string }));
      toast("갤러리에 공개되었습니다", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "공개하지 못했습니다.", "error");
    } finally {
      setPublishing(null);
    }
  };

  /** 무료 플랜 결과물은 워터마크를 구운 파일로 내려받게 한다. */
  const download = async (result: { url: string; id: string; watermarked: boolean }) => {
    const filename = `${BRAND.name}-${result.id}.png`;
    try {
      const blob = await composeImage(result.url, { watermark: result.watermarked });
      saveBlob(blob, filename);
    } catch {
      toast("이미지를 내려받지 못했습니다.", "error");
    }
  };

  if (running) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: expectedCount }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface"
          >
            <div className="aspect-[4/3] w-full bg-sunken" />
            <div className="h-9 border-t border-line" />
          </div>
        ))}
      </div>
    );
  }

  if (job?.status === "failed") {
    return (
      <EmptyState
        title="생성에 실패했습니다"
        description="크레딧은 자동으로 환불되었습니다. 잠시 후 다시 시도해 주세요."
        action={{ label: "다시 시도", onClick: onRegenerate }}
      />
    );
  }

  if (!job || job.results.length === 0) {
    return (
      <EmptyState
        title="아직 생성한 시안이 없습니다"
        description="왼쪽에서 사진을 올리고 모드와 스타일을 고른 뒤 생성을 눌러 주세요. 한 번에 최대 4장이 만들어집니다."
      />
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {job.results.map((result, i) => (
          <ResultCard
            key={result.id}
            result={result}
            index={i}
            originalUrl={originalUrl}
            onZoom={() => {
              setCompare(false);
              setZoomIndex(i);
            }}
            onDownload={() => void download(result)}
            onRegenerate={onRegenerate}
            onFloorplan={() => onFloorplan(result)}
            onPublish={() => void publish(result)}
            publishedSlug={published[result.id] ?? null}
            publishing={publishing === result.id}
          />
        ))}
      </div>

      {zoomIndex !== null && job.results[zoomIndex] && (
        <Lightbox
          result={job.results[zoomIndex]}
          originalUrl={originalUrl}
          compare={compare}
          onCompareChange={setCompare}
          onClose={() => setZoomIndex(null)}
          onDownload={() => void download(job.results[zoomIndex])}
        />
      )}
    </>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface/60 px-6 py-16 text-center">
      <p className="text-[15px] font-semibold">{title}</p>
      <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">{description}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-4 rounded-lg border border-line-strong px-4 py-2 text-[13px] hover:bg-sunken"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
