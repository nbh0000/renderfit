"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Material } from "@/scene/types";
import { onTextureReady, textureForMaterial, tiledTexture } from "./textures";

/**
 * 재질 → three 머티리얼, 그리고 그 머티리얼을 오래 살려 두는 캐시.
 *
 * ── 왜 캐시가 필요한가 ──
 *
 * 전에는 텍스처가 한 장 도착할 때마다 `new MeshStandardMaterial` 을 만들었다. 사진
 * 마감재는 map·normal·arm 세 장이 따로 오므로, 한 장이 올 때마다 화면에 있는 바닥·벽·
 * 가구의 머티리얼이 통째로 새로 생겼다.
 *
 * 머티리얼이 새로 생기면 three 는 셰이더 프로그램을 다시 컴파일한다. 맵의 유무가
 * 바뀌면 defines 가 달라져서 정말로 새 프로그램이 만들어진다. 3D 를 열고 몇 초 동안
 * 화면이 툭툭 끊기던 것이 이것이다. 게다가 옛 머티리얼을 dispose 하지 않아 GPU
 * 메모리도 함께 샜다.
 *
 * 그래서 머티리얼은 키마다 하나만 만들어 두고, 텍스처가 도착하면 **그 객체의 맵만
 * 바꿔 끼운다.** 맵이 null 에서 텍스처로(또는 반대로) 바뀔 때만 `needsUpdate` 를 켠다 —
 * 그때만 셰이더를 다시 만들 이유가 있고, 텍스처 객체만 갈아 끼우는 것은 uniform 교체라
 * 프로그램이 그대로 유지된다.
 *
 * 캐시는 비우지 않는다. 편집기 한 세션에서 쓰이는 재질은 많아야 수십 개고, 벽마다
 * 반복이 달라 키가 갈려도 벽 수만큼이다. 지우고 다시 만드는 쪽이 오히려 비싸다.
 */

/** 재질이 없을 때 쓰는 색 */
const DEFAULT_COLOR = "#b9b2a8";
const DEFAULT_ROUGHNESS = 0.75;

export interface MaterialOptions {
  /**
   * 같은 재질을 쓰는 다른 면을 갈라 주는 이름.
   *
   * 마감재를 하나도 안 고른 프로젝트에서는 바닥·천장이 둘 다 "재질 없음"이고 방
   * 치수도 같아서 캐시 키가 겹친다. 그러면 천장에 바닥재가 깔린다 — 실제로 겹쳤다.
   */
  variant?: string;
  /** 이 면에 텍스처를 가로로 몇 번 반복할지 */
  repeatX?: number;
  repeatY?: number;
  /** 벽 조각이 벽 중간에서 시작할 때 무늬를 이어 주는 값 */
  offsetX?: number;
  offsetY?: number;
  anisotropy?: number;
  /** 재질이 지정되지 않았을 때 쓸 색 (바닥 우드톤, 천장 흰색처럼 면마다 다르다) */
  fallbackColor?: string;
  /** 재질이 지정되지 않았을 때 깔 절차적 텍스처 */
  fallbackTexture?: THREE.Texture;
  /** 이 면에만 다르게 줄 값들 (바닥의 polygonOffset 등) */
  overrides?: Partial<
    Pick<
      THREE.MeshStandardMaterial,
      "roughness" | "metalness" | "polygonOffset" | "polygonOffsetFactor" | "polygonOffsetUnits"
    >
  >;
}

/** 키 하나에 살아 있는 머티리얼 하나 */
const cache = new Map<string, THREE.MeshStandardMaterial>();

function keyOf(material: Material | undefined, options: MaterialOptions): string {
  const { variant = "", repeatX = 1, repeatY = 1, offsetX = 0, offsetY = 0 } = options;
  return `${material?.id ?? "__default"}|${variant}|${repeatX}x${repeatY}|${offsetX},${offsetY}`;
}

/** 이 재질에 붙은 사진 맵들 — 아직 안 온 것은 undefined */
function photoMaps(material: Material | undefined, options: MaterialOptions) {
  const { repeatX = 1, repeatY = 1, offsetX = 0, offsetY = 0, anisotropy } = options;
  const tile = { repeatX, repeatY, offsetX, offsetY, anisotropy };

  return {
    map: material?.textureUrl ? tiledTexture(material.textureUrl, tile) : undefined,
    normal: material?.normalMapUrl
      ? tiledTexture(material.normalMapUrl, { ...tile, srgb: false })
      : undefined,
    /* ARM 한 장에 R=AO, G=거칠기, B=금속감이 들어 있어 세 자리에 같은 텍스처를 문다 */
    arm: material?.armMapUrl
      ? tiledTexture(material.armMapUrl, { ...tile, srgb: false })
      : undefined,
  };
}

/**
 * 도착한 맵을 머티리얼에 끼운다.
 *
 * @returns 셰이더를 다시 만들어야 하는지 (맵의 유무가 바뀌었을 때만 true)
 */
export function applyTextures(
  mat: THREE.MeshStandardMaterial,
  material: Material | undefined,
  options: MaterialOptions = {}
): boolean {
  const { map, normal, arm } = photoMaps(material, options);
  const color = material?.baseColor ?? options.fallbackColor ?? DEFAULT_COLOR;

  /*
   * 사진이 없는 동안에는 절차적 텍스처로 면을 채운다 — 민무늬 색면보다 낫다.
   * 재질 자체가 없으면 부르는 쪽이 준 것을 깐다(바닥은 나뭇결, 벽은 도장).
   */
  const procedural = material ? textureForMaterial(color, material.tags ?? []) : undefined;
  const wanted = map ?? procedural ?? options.fallbackTexture ?? null;
  const wantedNormal = normal ?? null;
  const wantedArm = arm ?? null;

  /*
   * 맵이 "있다 ↔ 없다" 로 바뀔 때만 셰이더를 다시 만든다.
   * 텍스처 객체만 갈아 끼우는 것은 uniform 교체라 프로그램이 그대로 유지된다.
   */
  const changed =
    !!mat.map !== !!wanted ||
    !!mat.normalMap !== !!wantedNormal ||
    !!mat.aoMap !== !!wantedArm ||
    !!mat.roughnessMap !== !!wantedArm ||
    !!mat.metalnessMap !== !!wantedArm;

  mat.map = wanted;
  mat.normalMap = wantedNormal;
  /* aoMap 은 원래 uv2 를 쓰지만 three 0.185 는 uv 가 없으면 uv 를 그대로 쓴다 */
  mat.aoMap = wantedArm;
  mat.roughnessMap = wantedArm;
  mat.metalnessMap = wantedArm;

  // 사진이 붙으면 색은 흰색이어야 한다 — 안 그러면 사진 위에 색이 한 번 더 곱해진다
  const tint = map ? "#ffffff" : color;
  if (mat.color.getHexString() !== tint.replace("#", "")) mat.color.set(tint);

  if (changed) mat.needsUpdate = true;
  return changed;
}

/**
 * 이 재질의 머티리얼. 같은 키면 늘 같은 객체를 돌려준다.
 *
 * 재질의 값(색·거칠기)이 바뀌면 같은 id 라도 갱신해야 하므로 부를 때마다 다시 넣는다.
 * 이 세 가지는 uniform 이라 바꿔도 셰이더가 다시 만들어지지 않는다.
 *
 * heightMapUrl 은 쓰지 않는다. displacement 는 지오메트리를 잘게 쪼개야 효과가 나는데,
 * 실내 규모에서 벽 한 장을 수만 개로 쪼개는 값이 아니다. 요철은 normalMap 이 맡는다.
 */
export function standardMaterialFor(
  material: Material | undefined,
  options: MaterialOptions = {}
): THREE.MeshStandardMaterial {
  const key = keyOf(material, options);
  const hit = cache.get(key);

  const roughness = options.overrides?.roughness ?? material?.roughness ?? DEFAULT_ROUGHNESS;
  const metalness = options.overrides?.metalness ?? material?.metallic ?? 0;

  if (hit) {
    if (hit.roughness !== roughness) hit.roughness = roughness;
    if (hit.metalness !== metalness) hit.metalness = metalness;
    applyTextures(hit, material, options);
    return hit;
  }

  const mat = new THREE.MeshStandardMaterial({ roughness, metalness });

  if (options.overrides?.polygonOffset) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = options.overrides.polygonOffsetFactor ?? 1;
    mat.polygonOffsetUnits = options.overrides.polygonOffsetUnits ?? 1;
  }

  applyTextures(mat, material, options);
  cache.set(key, mat);
  return mat;
}

/**
 * 머티리얼 하나를 붙들고, 텍스처가 도착하면 그 자리에서 맵만 갈아 끼운다.
 *
 * React 상태를 건드리지 않는 것이 핵심이다. 머티리얼 객체의 참조가 바뀌지 않으므로
 * 다시 그릴 이유가 없고(장면은 RenderPump 가 invalidate 로 깨운다), 예전처럼
 * 텍스처 한 장에 화면 전체가 다시 계산되지 않는다.
 */
export function useStandardMaterial(
  material?: Material,
  options: MaterialOptions = {}
): THREE.MeshStandardMaterial {
  const mat = standardMaterialFor(material, options);

  /*
   * 리스너 안에서 최신 값을 보려고 담아 둔다 — 의존성 때문에 리스너를 다시 걸지 않는다.
   * 그리는 도중이 아니라 그린 뒤에 담는다. 그리는 중에 ref 를 건드리면 리액트가
   * 화면과 어긋난 값을 보게 될 수 있다.
   */
  const latest = useRef({ material, options });
  useEffect(() => {
    latest.current = { material, options };
  });

  useEffect(
    () =>
      onTextureReady(() => {
        const apply = () => applyTextures(mat, latest.current.material, latest.current.options);

        // 걷는 중이면 모아 뒀다가 멈췄을 때 한 번에 붙인다 (GPU 업로드로 프레임이 튄다)
        if (deferring) pending.add(apply);
        else apply();
      }),
    [mat]
  );

  return mat;
}

/**
 * 텍스처 붙이기를 잠시 미룬다.
 *
 * 사진이 도착해 머티리얼에 물리는 순간, three 는 다음 프레임에 그 이미지를 GPU 로
 * 올린다. 4K 마감재 한 장이 수십 ms 를 먹기도 하는데, 걷는 도중에 그 일이 나면 화면이
 * 통째로 한 번 걸린다 — 눈높이에서 움직이는 중이라 그게 곧바로 멀미가 된다.
 *
 * 그래서 걷는 동안에는 붙이지 않고 모아 두었다가, 멈춰 섰을 때 한 번에 붙인다.
 * 머티리얼에 물리기 전까지는 업로드가 일어나지 않으므로 미루는 것만으로 충분하다.
 * 그동안 절차적 텍스처가 조금 더 보이는데, 화면이 걸리는 것보다는 낫다.
 */
let deferring = false;
const pending = new Set<() => void>();

export function setTextureDeferred(value: boolean): void {
  deferring = value;
  if (!value) flushTextures();
}

/** 미뤄 둔 것을 지금 붙인다 */
export function flushTextures(): void {
  if (pending.size === 0) return;
  const waiting = [...pending];
  pending.clear();
  for (const apply of waiting) apply();
}

/** 미뤄 둔 일이 있는지 — 멈춘 순간에만 붙이려고 부르는 쪽이 본다 */
export function hasPendingTextures(): boolean {
  return pending.size > 0;
}

/** 테스트에서 캐시를 비운다 — 운영 중에는 부르지 않는다 */
export function resetMaterialCache(): void {
  pending.clear();
  deferring = false;
  for (const mat of cache.values()) mat.dispose();
  cache.clear();
}
