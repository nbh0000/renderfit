"use client";

import { useEffect, useState } from "react";
import type { GenerationJob } from "@/lib/types";
import { BRAND } from "@/config/brand";
import { composeImage, extensionForBlob, saveBlob } from "@/lib/compose-download";
import { useToast } from "@/components/ui/Toast";
import { ResultCard } from "./ResultCard";
import { Lightbox } from "./Lightbox";

interface Props {
  job: GenerationJob | null;
  originalUrl: string | null;
  running: boolean;
  /** 생성 중 스켈레톤 장수 */
  expectedCount: number;
  /** 이번 요청의 예상 소요 시간(초). 2K·4K는 몇 분이 걸려 안내가 없으면 실패로 오해한다 */
  estimatedSeconds?: number;
  onRegenerate: () => void;
  onFloorplan: (result: GenerationJob["results"][number]) => void;
}

export function ResultsPanel({
  job,
  originalUrl,
  running,
  expectedCount,
  estimatedSeconds,
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
    try {
      const blob = await composeImage(result.url, { watermark: result.watermarked });
      saveBlob(blob, `${BRAND.name}-${result.id}.${extensionForBlob(blob)}`);
    } catch {
      toast("이미지를 내려받지 못했습니다.", "error");
    }
  };

  if (running) {
    return (
      <div className="space-y-3">
        <Progress estimatedSeconds={estimatedSeconds} count={expectedCount} />
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
      </div>
    );
  }

  if (job?.status === "failed") {
    return (
      <EmptyState
        title="생성에 실패했습니다"
        // 실패 사유를 그대로 보여 준다 — 안전 필터인지 한도 초과인지에 따라 다음 행동이 달라진다.
        description={`${job.error ?? "알 수 없는 오류가 발생했습니다."} 크레딧은 자동으로 환불되었습니다.`}
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

  // 일부만 성공한 경우 — 결과는 그대로 보여 주고 무슨 일이 있었는지만 위에 알린다.
  const partial = job.status === "succeeded" && job.results.length < expectedCount;

  return (
    <>
      {(partial || job.error) && (
        <p className="mb-3 rounded-lg border border-line bg-sunken px-3 py-2 text-[12.5px] text-muted">
          {job.error ?? `${expectedCount}장 중 ${job.results.length}장만 생성되었습니다. 나머지 크레딧은 환불되었습니다.`}
        </p>
      )}

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

      {/* 무엇이 실제로 모델에 전달됐는지 확인할 수 있게 열어 둔다 */}
      {job.prompt && (
        <details className="mt-4 rounded-[var(--radius-card)] border border-line bg-surface">
          <summary className="cursor-pointer px-3 py-2 text-[12.5px] text-muted hover:text-ink">
            이 시안에 사용된 프롬프트 보기
          </summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap border-t border-line px-3 py-2.5 text-[11.5px] leading-relaxed text-muted">
            {job.prompt}
          </pre>
        </details>
      )}

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

/**
 * 생성 대기 안내.
 *
 * 4K는 한 장에 50초, 네 장이면 3분을 넘긴다.
 * 아무 표시가 없으면 멈춘 것으로 보이기 때문에 예상 시간과 경과 시간을 같이 보여 준다.
 */
function Progress({ estimatedSeconds, count }: { estimatedSeconds?: number; count: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const total = estimatedSeconds ? estimatedSeconds * count : null;
  const overdue = total !== null && elapsed > total * 1.5;

  return (
    <p className="rounded-lg border border-line bg-sunken px-3 py-2 text-[12.5px] text-muted">
      시안 {count}장을 만들고 있습니다
      {total !== null && ` · 예상 약 ${total < 60 ? `${total}초` : `${Math.round(total / 60)}분`}`}
      {` · 경과 ${elapsed < 60 ? `${elapsed}초` : `${Math.floor(elapsed / 60)}분 ${elapsed % 60}초`}`}
      {overdue && " — 예상보다 오래 걸리고 있습니다. 창을 닫지 말고 조금만 더 기다려 주세요."}
    </p>
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
