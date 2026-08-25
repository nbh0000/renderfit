import { describe, expect, it } from "vitest";
import { dealColumns, type GalleryMarqueeItem } from "@/components/gallery/GalleryMarquee";

/**
 * 메인 갤러리 띠에 같은 사진이 겹쳐 보이던 문제.
 *
 * 앞에서부터 잘라 열마다 몰아 주면, 시안이 적을 때 세 열이 같은 사진으로 시작해서
 * 같은 거실이 화면에 세 번 걸린다. 카드패 돌리듯 한 장씩 번갈아 주면 어떤 사진도
 * 두 열에 동시에 들어가지 않는다.
 */

function items(count: number): GalleryMarqueeItem[] {
  return Array.from({ length: count }, (_, index) => ({
    slug: `s${index}`,
    imageUrl: `/${index}.webp`,
    roomLabel: "거실",
    styleLabel: "모던",
    blurb: "",
    authorName: "익명",
    viewCount: 0,
    likeCount: 0,
    width: 4800,
    height: 3584,
  }));
}

/** 어느 사진이 몇 번 걸렸는지 */
function counts(columns: GalleryMarqueeItem[][]): Map<string, number> {
  const seen = new Map<string, number>();
  for (const column of columns) {
    for (const card of column) seen.set(card.slug, (seen.get(card.slug) ?? 0) + 1);
  }
  return seen;
}

describe("갤러리 띠 카드 나누기", () => {
  it("시안이 넉넉하면 어떤 사진도 두 번 걸리지 않는다", () => {
    const dealt = dealColumns(items(12), 3);
    for (const count of counts(dealt).values()) expect(count).toBe(1);
  });

  it("세 열에 고르게 나눈다", () => {
    const dealt = dealColumns(items(12), 3);
    expect(dealt.map((column) => column.length)).toEqual([4, 4, 4]);
  });

  it("나누어떨어지지 않아도 한 장 차이까지만 벌어진다", () => {
    const sizes = dealColumns(items(11), 3).map((column) => column.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("모든 시안이 빠짐없이 걸린다", () => {
    const dealt = dealColumns(items(12), 3);
    expect(counts(dealt).size).toBe(12);
  });

  it("시안이 아주 적으면 열마다 다른 사진으로 시작한다", () => {
    // 두 장을 세 열에 겹치지 않게 나눌 수는 없다. 최소한 시작이라도 어긋나야 한다.
    const dealt = dealColumns(items(2), 3);
    expect(dealt.every((column) => column.length > 0)).toBe(true);
    expect(dealt[0][0].slug).not.toBe(dealt[1][0].slug);
  });

  it("열이 비지 않는다", () => {
    for (const count of [1, 2, 3, 5, 12, 40]) {
      const dealt = dealColumns(items(count), 3);
      expect(dealt.every((column) => column.length > 0)).toBe(true);
    }
  });
});
