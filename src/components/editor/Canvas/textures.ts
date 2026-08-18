"use client";

import * as THREE from "three";

/**
 * 절차적 텍스처.
 *
 * 외부 에셋(HDR·텍스처 파일)을 받아오지 않고 캔버스에서 직접 그린다.
 * 배포 환경에서 CDN 의존성이 없고, 재질 카탈로그의 baseColor를 그대로 물려받는다.
 */

const cache = new Map<string, THREE.Texture>();

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
