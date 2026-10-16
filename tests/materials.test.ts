import { beforeEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  applyTextures,
  resetMaterialCache,
  standardMaterialFor,
} from "@/components/editor/Canvas/materials";
import type { Material } from "@/scene/types";

/**
 * 머티리얼 캐시.
 *
 * 전에는 텍스처가 한 장 도착할 때마다 `new MeshStandardMaterial` 을 만들었다. 사진
 * 마감재는 map·normal·arm 세 장이 따로 오므로, 한 장이 올 때마다 화면의 모든 바닥·벽·
 * 가구 머티리얼이 새로 생기고 셰이더가 다시 컴파일됐다. 3D 를 열고 몇 초간 화면이
 * 툭툭 끊기던 것이 이것이고, 걷기 모드에서는 그대로 두면 못 쓴다.
 *
 * 여기서 지키려는 규칙은 두 가지다.
 *   1. 같은 키에는 늘 같은 머티리얼 객체 (참조가 바뀌면 리렌더와 재컴파일이 딸려 온다)
 *   2. 맵이 "있다 ↔ 없다" 로 바뀔 때만 needsUpdate (그때만 셰이더를 새로 만들 이유가 있다)
 *
 * jsdom 없이 돈다. document 가 없으면 사진·절차적 텍스처가 undefined 로 떨어지므로,
 * 맵이 붙는 상황은 fallbackTexture 로 만든다 — 부르는 쪽이 주는 값이라 DOM 이 필요 없다.
 */

function material(patch: Partial<Material> = {}): Material {
  return {
    id: "mat_oak",
    name: "오크 마루",
    baseColor: "#c9a173",
    roughness: 0.6,
    metallic: 0,
    scale: 2,
    tags: [],
    ...patch,
  };
}

/** DOM 없이 만들 수 있는 아무 텍스처 — 맵 자리에 꽂아 보는 용도 */
function anyTexture(): THREE.Texture {
  return new THREE.Texture();
}

beforeEach(() => {
  resetMaterialCache();
});

describe("같은 키에는 같은 머티리얼", () => {
  it("두 번 불러도 같은 객체다", () => {
    const options = { variant: "floor", repeatX: 5, repeatY: 3 };
    expect(standardMaterialFor(material(), options)).toBe(
      standardMaterialFor(material(), options)
    );
  });

  it("반복 수가 다르면 다른 객체다", () => {
    // 벽마다 길이가 달라 반복이 갈린다 — 벽 수만큼 머티리얼이 생기는 것은 의도한 것이다
    const a = standardMaterialFor(material(), { variant: "wall", repeatX: 2, repeatY: 1 });
    const b = standardMaterialFor(material(), { variant: "wall", repeatX: 4, repeatY: 1 });
    expect(a).not.toBe(b);
  });

  it("오프셋이 다르면 다른 객체다", () => {
    // 문 양옆 벽 조각은 같은 재질·같은 크기라도 무늬 시작점이 달라야 이어진다
    const a = standardMaterialFor(material(), { variant: "wall", offsetX: 0 });
    const b = standardMaterialFor(material(), { variant: "wall", offsetX: 0.5 });
    expect(a).not.toBe(b);
  });

  it("재질이 없는 면끼리도 서로 섞이지 않는다", () => {
    /*
     * 마감재를 하나도 안 고른 프로젝트에서는 바닥과 천장이 둘 다 "재질 없음"이고
     * 방 치수도 같아 반복 수까지 똑같다. variant 가 없으면 천장에 바닥재가 깔린다.
     */
    const floor = standardMaterialFor(undefined, { variant: "floor", repeatX: 3, repeatY: 3 });
    const ceiling = standardMaterialFor(undefined, { variant: "ceiling", repeatX: 3, repeatY: 3 });
    expect(floor).not.toBe(ceiling);
  });

  it("다른 재질은 당연히 다른 객체다", () => {
    const a = standardMaterialFor(material({ id: "mat_oak" }), { variant: "floor" });
    const b = standardMaterialFor(material({ id: "mat_tile" }), { variant: "floor" });
    expect(a).not.toBe(b);
  });
});

describe("재질 값이 바뀌면 같은 객체를 갱신한다", () => {
  it("거칠기·금속감을 다시 넣는다", () => {
    const first = standardMaterialFor(material({ roughness: 0.6, metallic: 0 }), {
      variant: "floor",
    });
    const second = standardMaterialFor(material({ roughness: 0.2, metallic: 0.8 }), {
      variant: "floor",
    });

    // 같은 id 라 같은 객체여야 하고, 값은 새 것이어야 한다
    expect(second).toBe(first);
    expect(second.roughness).toBeCloseTo(0.2, 5);
    expect(second.metalness).toBeCloseTo(0.8, 5);
  });

  it("면마다 다른 값을 줄 수 있다", () => {
    const mat = standardMaterialFor(material({ roughness: 0.6 }), {
      variant: "floor",
      overrides: { roughness: 0.95 },
    });
    expect(mat.roughness).toBeCloseTo(0.95, 5);
  });

  it("바닥에는 polygonOffset 을 켤 수 있다", () => {
    // 실별 바닥 패치가 위에 얹히므로 기준 바닥을 뒤로 물려야 깜빡이지 않는다
    const mat = standardMaterialFor(material(), {
      variant: "floor",
      overrides: { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 },
    });

    expect(mat.polygonOffset).toBe(true);
    expect(mat.polygonOffsetFactor).toBe(1);
  });
});

describe("맵이 바뀔 때만 셰이더를 다시 만든다", () => {
  it("없다가 생기면 다시 만든다", () => {
    const mat = new THREE.MeshStandardMaterial();
    const before = mat.version;

    expect(applyTextures(mat, undefined, { fallbackTexture: anyTexture() })).toBe(true);
    expect(mat.map).not.toBeNull();
    expect(mat.version).toBeGreaterThan(before);
  });

  it("같은 상태로 다시 부르면 그대로 둔다", () => {
    const texture = anyTexture();
    const mat = new THREE.MeshStandardMaterial();

    applyTextures(mat, undefined, { fallbackTexture: texture });
    const after = mat.version;

    // 매 프레임 불려도 여기서 셰이더가 다시 만들어지면 안 된다
    expect(applyTextures(mat, undefined, { fallbackTexture: texture })).toBe(false);
    expect(mat.version).toBe(after);
  });

  it("텍스처 객체만 갈아 끼우는 것은 다시 만들지 않는다", () => {
    const mat = new THREE.MeshStandardMaterial();
    applyTextures(mat, undefined, { fallbackTexture: anyTexture() });
    const after = mat.version;

    const other = anyTexture();
    expect(applyTextures(mat, undefined, { fallbackTexture: other })).toBe(false);
    // 맵은 새 것으로 바뀌었지만 프로그램은 그대로다 (uniform 교체일 뿐이다)
    expect(mat.map).toBe(other);
    expect(mat.version).toBe(after);
  });

  it("있다가 없어지면 다시 만든다", () => {
    const mat = new THREE.MeshStandardMaterial();
    applyTextures(mat, undefined, { fallbackTexture: anyTexture() });
    const after = mat.version;

    expect(applyTextures(mat, undefined, {})).toBe(true);
    expect(mat.map).toBeNull();
    expect(mat.version).toBeGreaterThan(after);
  });
});

describe("색", () => {
  it("재질이 없으면 부르는 쪽이 준 색을 쓴다", () => {
    // 바닥은 우드톤, 천장은 흰색처럼 면마다 기본색이 다르다
    const mat = new THREE.MeshStandardMaterial();
    applyTextures(mat, undefined, { fallbackColor: "#f7f7f7" });
    expect(mat.color.getHexString()).toBe("f7f7f7");
  });

  it("재질의 색이 기본색을 이긴다", () => {
    const mat = new THREE.MeshStandardMaterial();
    applyTextures(mat, material({ baseColor: "#334455" }), { fallbackColor: "#f7f7f7" });
    expect(mat.color.getHexString()).toBe("334455");
  });

  it("절차적 텍스처가 깔려도 색은 그대로 곱해진다", () => {
    // 사진이 아니라 절차적 무늬는 baseColor 로 그려진 것이라 색을 지우면 안 된다
    const mat = new THREE.MeshStandardMaterial();
    applyTextures(mat, undefined, { fallbackColor: "#c9a173", fallbackTexture: anyTexture() });
    expect(mat.color.getHexString()).toBe("c9a173");
  });
});
