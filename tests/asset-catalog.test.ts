import { describe, expect, it } from "vitest";
import { ALL_ASSETS, catalogByCategory, searchCatalog } from "@/models/catalog";
import { ASSETS } from "@/models/assets";

/**
 * 카탈로그에 Poly Pizza 무료 모델을 구워 넣은 뒤로 확인해야 하는 것들.
 *
 * 무료 API라 호출은 공짜지만, 굽는 데 몇 분이 걸린다. 그래서 여기서는 네트워크를 쓰지 않고
 * 구워 둔 파일(models/polypizza.generated.ts)만 본다.
 */

/** 가구 탭의 접이식 목록 이름 — 여기에 없는 분류로 들어오면 화면에서 사라진다 */
const 화면_분류 = [
  "sofa",
  "chair",
  "table",
  "bed",
  "cabinet",
  "lamp",
  "appliance",
  "rug",
  "plant",
  "decoration",
];

describe("에셋 카탈로그", () => {
  it("기본 항목이 앞에 오고 무료 모델이 뒤에 붙는다", () => {
    expect(ALL_ASSETS.length).toBeGreaterThan(ASSETS.length);
    expect(ALL_ASSETS.slice(0, ASSETS.length)).toEqual(ASSETS);
  });

  it("모든 항목이 화면에 있는 분류에 들어간다", () => {
    const 벗어난 = ALL_ASSETS.filter((asset) => !화면_분류.includes(asset.category));
    expect(벗어난.map((asset) => `${asset.id}:${asset.category}`)).toEqual([]);
  });

  it("치수가 모두 양수 mm 다 — 0이면 3D에서 납작해진다", () => {
    for (const asset of ALL_ASSETS) {
      expect(asset.dimensions.width).toBeGreaterThan(0);
      expect(asset.dimensions.height).toBeGreaterThan(0);
      expect(asset.dimensions.depth).toBeGreaterThan(0);
    }
  });

  it("무료 모델은 라이선스와 저작자 표시를 달고 있다 — CC-BY는 표기 의무가 있다", () => {
    const 무료 = ALL_ASSETS.filter((asset) => asset.id.startsWith("poly_"));
    expect(무료.length).toBeGreaterThan(1000);

    for (const asset of 무료) {
      expect(asset.license, asset.id).toBeTruthy();
      expect(asset.attribution, asset.id).toBeTruthy();
      expect(asset.modelUrl, asset.id).toMatch(/^https:\/\/static\.poly\.pizza\//);
    }
  });
});

describe("목록 자르기", () => {
  /*
   * 검색어 없이 펼 때 앞에서부터 자르면 소파가 한도를 다 먹는다.
   * 분류마다 같은 수만큼 담아야 침대·러그도 보인다.
   */
  it("분류마다 고르게 담는다", () => {
    const picked = catalogByCategory(20);
    const counts = new Map<string, number>();
    for (const asset of picked) {
      counts.set(asset.category, (counts.get(asset.category) ?? 0) + 1);
    }

    for (const category of 화면_분류) {
      expect(counts.get(category) ?? 0, category).toBeGreaterThan(0);
      expect(counts.get(category) ?? 0, category).toBeLessThanOrEqual(20);
    }
  });

  it("검색은 무료 모델까지 훑는다", () => {
    const hits = searchCatalog("cactus", 20);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((asset) => asset.id.startsWith("poly_"))).toBe(true);
  });
});
