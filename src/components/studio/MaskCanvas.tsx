"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** 마스크 내부 해상도의 긴 변 상한. 너무 크면 모바일에서 무거워진다. */
const MAX_MASK_EDGE = 1024;

interface Props {
  /** 업로드한 원본 이미지 URL */
  imageUrl: string;
  /** 칠한 영역이 생기거나 지워질 때 흑백 PNG 마스크를 전달한다. 비어 있으면 null */
  onMaskChange: (mask: File | null) => void;
  disabled?: boolean;
}

interface Stroke {
  points: { x: number; y: number }[];
  size: number;
  erase: boolean;
}

/**
 * 보존 마스킹 브러시.
 * 칠한 영역 = 보존(흰색), 나머지 = 편집 허용(검정)인 흑백 PNG를 만들어 생성 API에 함께 보낸다.
 * 모바일 터치를 우선해 pointer 이벤트만 사용한다.
 */
export function MaskCanvas({ imageUrl, onMaskChange, disabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingRef = useRef<Stroke | null>(null);

  const [size, setSize] = useState({ width: 0, height: 0 });
  const [brush, setBrush] = useState(48);
  const [erase, setErase] = useState(false);
  const [hasMask, setHasMask] = useState(false);

  /* 원본 비율에 맞춰 캔버스 내부 해상도를 정한다. */
  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (cancelled) return;
      const ratio = Math.min(1, MAX_MASK_EDGE / Math.max(image.width, image.height));
      setSize({
        width: Math.round(image.width * ratio),
        height: Math.round(image.height * ratio),
      });
    };
    image.src = imageUrl;
    return () => {
      cancelled = true;
    };
  }, [imageUrl]);

  /* 이미지가 바뀌면 마스크를 초기화한다. */
  useEffect(() => {
    strokesRef.current = [];
    setHasMask(false);
    onMaskChange(null);
  }, [imageUrl, onMaskChange]);

  /** 화면에 보이는 미리보기(반투명 오렌지) */
  const renderPreview = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.width) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const stroke of strokesRef.current) {
      ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
      ctx.strokeStyle = "rgba(191, 98, 66, 0.55)";
      ctx.lineWidth = stroke.size;
      ctx.beginPath();
      stroke.points.forEach((point, i) => {
        if (i === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      if (stroke.points.length === 1) {
        ctx.lineTo(stroke.points[0].x + 0.01, stroke.points[0].y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
  }, [size.width]);

  /** 흑백 PNG 마스크를 만들어 상위로 전달한다. */
  const emitMask = useCallback(() => {
    if (!size.width) return;
    const painted = strokesRef.current.some((s) => !s.erase);
    if (!painted) {
      setHasMask(false);
      onMaskChange(null);
      return;
    }

    const out = document.createElement("canvas");
    out.width = size.width;
    out.height = size.height;
    const ctx = out.getContext("2d");
    if (!ctx) return;

    // 편집 허용 영역 = 검정
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, out.width, out.height);

    // 보존 영역 = 흰색
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokesRef.current) {
      ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = stroke.size;
      ctx.beginPath();
      stroke.points.forEach((point, i) => {
        if (i === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      if (stroke.points.length === 1) {
        ctx.lineTo(stroke.points[0].x + 0.01, stroke.points[0].y);
      }
      ctx.stroke();
    }

    // 지우개로 뚫린 자리는 다시 검정으로 메운다.
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.globalCompositeOperation = "source-over";

    out.toBlob((blob) => {
      if (!blob) return;
      setHasMask(true);
      onMaskChange(new File([blob], "mask.png", { type: "image/png" }));
    }, "image/png");
  }, [onMaskChange, size.height, size.width]);

  useEffect(() => {
    renderPreview();
  }, [renderPreview, size]);

  const toCanvasPoint = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const undo = () => {
    strokesRef.current = strokesRef.current.slice(0, -1);
    renderPreview();
    emitMask();
  };

  const clear = () => {
    strokesRef.current = [];
    renderPreview();
    emitMask();
  };

  if (!size.width) {
    return (
      <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-line-strong bg-sunken text-[12px] text-muted">
        이미지를 불러오는 중…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        ref={wrapRef}
        className="relative overflow-hidden rounded-lg border border-line bg-sunken"
        style={{ aspectRatio: `${size.width} / ${size.height}` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="마스킹 대상 원본"
          className="absolute inset-0 h-full w-full object-contain"
          draggable={false}
        />
        <canvas
          ref={canvasRef}
          width={size.width}
          height={size.height}
          className={`absolute inset-0 h-full w-full touch-none ${
            disabled ? "cursor-not-allowed" : "cursor-crosshair"
          }`}
          onPointerDown={(e) => {
            if (disabled) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            const point = toCanvasPoint(e.clientX, e.clientY);
            drawingRef.current = { points: [point], size: brush, erase };
            strokesRef.current = [...strokesRef.current, drawingRef.current];
            renderPreview();
          }}
          onPointerMove={(e) => {
            if (disabled || !drawingRef.current) return;
            drawingRef.current.points.push(toCanvasPoint(e.clientX, e.clientY));
            renderPreview();
          }}
          onPointerUp={() => {
            if (!drawingRef.current) return;
            drawingRef.current = null;
            emitMask();
          }}
          onPointerCancel={() => {
            drawingRef.current = null;
            emitMask();
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setErase(false)}
          disabled={disabled}
          className={`rounded-md border px-2.5 py-1 text-[12px] ${
            !erase ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-sunken"
          }`}
        >
          브러시
        </button>
        <button
          type="button"
          onClick={() => setErase(true)}
          disabled={disabled}
          className={`rounded-md border px-2.5 py-1 text-[12px] ${
            erase ? "border-accent bg-accent-soft text-accent" : "border-line hover:bg-sunken"
          }`}
        >
          지우개
        </button>
        <label className="flex min-w-[110px] flex-1 items-center gap-2 text-[11.5px] whitespace-nowrap text-muted">
          굵기
          <input
            type="range"
            min={12}
            max={120}
            step={4}
            value={brush}
            disabled={disabled}
            onChange={(e) => setBrush(Number(e.target.value))}
            className="w-full accent-[var(--color-accent)]"
          />
        </label>
        <button
          type="button"
          onClick={undo}
          disabled={disabled}
          className="rounded-md px-2 py-1 text-[12px] text-ink-soft hover:bg-sunken"
        >
          되돌리기
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={disabled}
          className="rounded-md px-2 py-1 text-[12px] text-ink-soft hover:bg-sunken"
        >
          전체 지우기
        </button>
      </div>

      <p className="text-[11.5px] text-muted">
        {hasMask
          ? "칠한 영역은 생성 시 그대로 보존됩니다."
          : "보존하고 싶은 영역을 칠해 주세요. 칠하지 않으면 마스킹 없이 생성됩니다."}
      </p>
    </div>
  );
}
