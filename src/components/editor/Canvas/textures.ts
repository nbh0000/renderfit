"use client";

import * as THREE from "three";

/**
 * 절차적 텍스처.
 *
 * 외부 에셋(HDR·텍스처 파일)을 받아오지 않고 캔버스에서 직접 그린다.
 * 배포 환경에서 CDN 의존성이 없고, 재질 카탈로그의 baseColor를 그대로 물려받는다.
 */

const cache = new Map<string, THREE.Texture>();

/**
 * 텍스처가 뒤늦게 도착했다고 알린다.
 *
 * 3D는 요청이 있을 때만 다시 그린다(frameloop="demand"). 그런데 사진 텍스처와
 * 잘라낸 가구 이미지는 비동기로 도착하고, 도착해도 아무도 다시 그려 달라고 하지
 * 않으면 화면은 검은 방과 빈 바닥으로 남는다 — 실제로 그랬다.
 * 타이머로 몇 번 두드려 보는 것으로는 큰 이미지를 못 기다린다.
 */
const listeners = new Set<() => void>();

export function onTextureReady(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyReady(): void {
  for (const listener of listeners) listener();
}

function makeCanvas(size = 512): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return { canvas, ctx: canvas.getContext("2d")! };
}

function finish(canvas: HTMLCanvasElement, repeat: number): THREE.Texture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function shade(hex: string, amount: number): string {
  const color = new THREE.Color(hex);
  color.offsetHSL(0, 0, amount);
  return `#${color.getHexString()}`;
}

/** 나뭇결 */
export function woodTexture(baseColor: string, repeat = 2): THREE.Texture {
  const key = `wood:${baseColor}:${repeat}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { canvas, ctx } = makeCanvas();
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 512, 512);

  // 판재 경계
  for (let plank = 0; plank < 4; plank++) {
    const y = plank * 128;
    ctx.fillStyle = shade(baseColor, -0.06);
    ctx.fillRect(0, y, 512, 2);
  }

  // 결
  for (let i = 0; i < 260; i++) {
    const y = Math.random() * 512;
    ctx.strokeStyle = shade(baseColor, (Math.random() - 0.5) * 0.09);
    ctx.lineWidth = Math.random() * 1.6 + 0.2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) {
      ctx.lineTo(x, y + Math.sin((x + i * 13) / 60) * 2.2);
    }
    ctx.stroke();
  }

  const texture = finish(canvas, repeat);
  cache.set(key, texture);
  return texture;
}

/** 패브릭 위브 */
export function fabricTexture(baseColor: string, repeat = 8): THREE.Texture {
  const key = `fabric:${baseColor}:${repeat}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { canvas, ctx } = makeCanvas(256);
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 256, 256);

  for (let y = 0; y < 256; y += 4) {
    for (let x = 0; x < 256; x += 4) {
      const on = ((x / 4 + y / 4) % 2) === 0;
      ctx.fillStyle = shade(baseColor, on ? 0.035 : -0.035);
      ctx.fillRect(x, y, 4, 4);
    }
  }
  // 미세 노이즈
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = shade(baseColor, (Math.random() - 0.5) * 0.12);
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1, 1);
  }

  const texture = finish(canvas, repeat);
  cache.set(key, texture);
  return texture;
}

/** 대리석 / 석재 */
export function stoneTexture(baseColor: string, repeat = 1): THREE.Texture {
  const key = `stone:${baseColor}:${repeat}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { canvas, ctx } = makeCanvas();
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 22; i++) {
    ctx.strokeStyle = shade(baseColor, (Math.random() - 0.6) * 0.16);
    ctx.lineWidth = Math.random() * 2.5 + 0.4;
    ctx.beginPath();
    let x = Math.random() * 512;
    let y = -10;
    ctx.moveTo(x, y);
    while (y < 522) {
      x += (Math.random() - 0.5) * 70;
      y += Math.random() * 40 + 12;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const texture = finish(canvas, repeat);
  cache.set(key, texture);
  return texture;
}

/** 벽 도장 (미세 요철) */
export function paintTexture(baseColor: string, repeat = 3): THREE.Texture {
  const key = `paint:${baseColor}:${repeat}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { canvas, ctx } = makeCanvas(256);
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = shade(baseColor, (Math.random() - 0.5) * 0.045);
    ctx.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
  }

  const texture = finish(canvas, repeat);
  cache.set(key, texture);
  return texture;
}

/** 재질 태그로 알맞은 텍스처를 고른다 */
/**
 * 실제 사진 텍스처.
 *
 * 절차적 텍스처는 색만 다른 면을 만들어 냈다 — 마루와 타일이 같아 보였다.
 * 마감재에 사진이 붙어 있으면(scripts/assets/textures.mjs) 그것을 우선 쓴다.
 * repeatMeters는 텍스처 한 장이 덮는 실제 크기라, 면의 크기에 맞춰 반복 수를 정한다.
 */
const fileCache = new Map<string, THREE.Texture>();

export function imageTexture(
  url: string,
  options: { srgb?: boolean; repeat?: number } = {}
): THREE.Texture | undefined {
  if (typeof document === "undefined") return undefined;

  const { srgb = true, repeat = 1 } = options;
  const key = `${url}:${srgb}:${repeat}`;
  const hit = fileCache.get(key);

  /*
   * 아직 안 온 텍스처는 없는 셈 친다.
   *
   * 마감재 사진은 한 장에 700KB가 넘어 늦게 도착하는데, 그동안 map 자리에
   * 빈 텍스처를 물려 두면 벽과 바닥이 새까맣게 보인다. 그럴 바에는 절차적 텍스처로
   * 먼저 채우고, 사진이 도착하면(notifyReady) 그때 바꿔 다는 편이 낫다.
   */
  if (hit) return hit.image ? hit : undefined;

  const texture = new THREE.TextureLoader().load(url, notifyReady);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;

  fileCache.set(key, texture);
  // 방금 만든 것은 아직 이미지가 없다 — 도착할 때까지는 절차적 텍스처에 맡긴다.
  return texture.image ? texture : undefined;
}

export function textureForMaterial(
  baseColor: string,
  tags: string[] = []
): THREE.Texture | undefined {
  if (typeof document === "undefined") return undefined;
  const t = tags.map((x) => x.toLowerCase());

  if (t.some((x) => ["wood", "oak", "walnut", "우드", "오크", "월넛"].includes(x))) {
    return woodTexture(baseColor, 2);
  }
  if (t.some((x) => ["fabric", "linen", "leather", "패브릭", "린넨", "가죽"].includes(x))) {
    return fabricTexture(baseColor, 6);
  }
  if (t.some((x) => ["stone", "marble", "concrete", "tile", "대리석", "콘크리트", "타일"].includes(x))) {
    return stoneTexture(baseColor, 1.5);
  }
  if (t.some((x) => ["paint", "wall", "ceiling", "도장"].includes(x))) {
    return paintTexture(baseColor, 2);
  }
  return undefined;
}

/**
 * 흰 배경을 지운 텍스처.
 *
 * AI로 만든 가구 이미지는 순백 배경 위에 물체 하나만 있다. 그대로 판에 붙이면
 * 흰 사각형이 방 한가운데 서 있게 되므로, 배경에 가까운 픽셀의 알파를 0으로 만든다.
 * 가장자리는 부드럽게 깎아 실루엣이 톱니처럼 보이지 않게 한다.
 */
export function cutoutTexture(url: string): THREE.Texture | undefined {
  if (typeof document === "undefined") return undefined;

  const key = `cutout:${url}`;
  const hit = cache.get(key);
  if (hit) return hit;

  // 먼저 빈 텍스처를 만들어 캐시에 넣고, 이미지가 오면 채운다 (렌더를 막지 않는다).
  const { canvas, ctx } = makeCanvas(1024);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  cache.set(key, texture);

  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onerror = () => console.warn("[3d] 가구 이미지를 불러오지 못했습니다:", url);
  image.onload = () => {
    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(image, 0, 0, size, size);

    const frame = ctx.getImageData(0, 0, size, size);
    const pixels = frame.data;

    for (let i = 0; i < pixels.length; i += 4) {
      const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
      // 240 이상이면 배경, 214~240은 가장자리로 보고 서서히 지운다.
      if (min >= 240) pixels[i + 3] = 0;
      else if (min > 214) pixels[i + 3] = Math.round(((240 - min) / 26) * 255);
    }

    ctx.putImageData(frame, 0, 0);
    texture.needsUpdate = true;
    notifyReady();
  };
  image.src = url;

  return texture;
}
