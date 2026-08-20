"use client";

import { BRAND } from "@/config/brand";

/**
 * 다운로드 파일에 고지/워터마크를 굽는다.
 * 화면 오버레이만으로는 파일에 남지 않으므로, 내려받는 이미지 자체에 그려 넣는다.
 */
export interface ComposeOptions {
  /** 이미지 하단에 고정으로 붙는 고지 문구 (배치도의 경우 필수) */
  disclaimer?: string;
  /** 타일 워터마크 (무료 플랜 결과물) */
  watermark?: boolean;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다."));
    image.src = src;
  });
}

function drawWatermark(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const step = Math.max(140, Math.round(width / 6));
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 ${Math.round(step / 8)}px Pretendard, sans-serif`;
  ctx.rotate((-24 * Math.PI) / 180);
  for (let y = -height; y < height * 1.6; y += step * 0.7) {
    for (let x = -width; x < width * 1.6; x += step) {
      ctx.fillText(BRAND.watermark, x, y);
    }
  }
  ctx.restore();
}

function drawDisclaimer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  barHeight: number,
  text: string
) {
  ctx.fillStyle = "#26231F";
  ctx.fillRect(0, height, width, barHeight);
  ctx.fillStyle = "#FFFFFF";
  ctx.textBaseline = "middle";

  // 폭에 맞을 때까지 글자 크기를 줄인다 (모바일 세로 이미지 대응)
  let fontSize = Math.round(barHeight * 0.42);
  const padding = Math.round(width * 0.03);
  do {
    ctx.font = `500 ${fontSize}px Pretendard, sans-serif`;
    fontSize -= 1;
  } while (ctx.measureText(text).width > width - padding * 2 && fontSize > 8);

  ctx.fillText(text, padding, height + barHeight / 2);
}

/** 이미지에 고지/워터마크를 합성한 Blob을 만든다. */
export async function composeImage(src: string, options: ComposeOptions): Promise<Blob> {
  const image = await loadImage(src);
  const width = image.naturalWidth || 1024;
  const height = image.naturalHeight || 768;
  const barHeight = options.disclaimer ? Math.max(40, Math.round(height * 0.075)) : 0;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height + barHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("캔버스를 사용할 수 없습니다.");

  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, width, height);

  if (options.watermark) drawWatermark(ctx, width, height);
  if (options.disclaimer) drawDisclaimer(ctx, width, height, barHeight, options.disclaimer);

  /*
   * 2K·4K 결과를 PNG로 구우면 파일이 30MB를 넘고 모바일에서는 메모리째로 실패한다.
   * 인테리어 사진에는 투명도가 필요 없으므로 큰 이미지는 JPEG로 내보낸다.
   */
  const large = canvas.width * canvas.height > 2_000_000;
  const type = large ? "image/jpeg" : "image/png";

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("이미지를 만들지 못했습니다."));
      },
      type,
      large ? 0.92 : undefined
    );
  });
}

/** Blob 종류에 맞는 확장자 — 파일명이 내용과 어긋나지 않게 한다 */
export function extensionForBlob(blob: Blob): string {
  if (blob.type.includes("jpeg")) return "jpg";
  if (blob.type.includes("webp")) return "webp";
  return "png";
}

/** Blob을 파일로 내려받는다. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
