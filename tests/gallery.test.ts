import { describe, expect, it } from "vitest";
import { STYLES } from "@/config/styles";
import {
  compareBySort,
  parseSort,
  styleBlurb,
  type GalleryItem,
  type GallerySort,
} from "@/lib/gallery";

describe("styleBlurb", () => {
  it("스타일 접두어를 떼고 앞의 두 마디만 남긴다", () => {
    expect(styleBlurb("modern")).toBe("직선적인 가구 · 무광 화이트와 차콜 그레이 위주의 절제된 팔레트");
  });

  it("문장 끝 마침표를 남기지 않는다", () => {
    for (const style of STYLES) {
      expect(styleBlurb(style.id).endsWith(".")).toBe(false);
    }
  });

  it("모든 스타일이 카드에 얹을 만큼 짧은 설명을 갖는다", () => {
    for (const style of STYLES) {
      const blurb = styleBlurb(style.id);
      expect(blurb.length).toBeGreaterThan(0);
      expect(blurb.length).toBeLessThanOrEqual(60);
    }
  });
});

describe("갤러리 정렬", () => {
  const item = (slug: string, createdAt: string, likeCount: number, viewCount: number) =>
    ({ slug, createdAt, likeCount, viewCount }) as GalleryItem;

  const items = [
    item("a", "2026-01-01", 1, 90),
    item("b", "2026-03-01", 5, 10),
    item("c", "2026-02-01", 5, 50),
  ];

  const order = (sort: GallerySort) => [...items].sort(compareBySort(sort)).map((i) => i.slug);

  it("모르는 값은 최신순으로 본다", () => {
    expect(parseSort(undefined)).toBe("recent");
    expect(parseSort("hot")).toBe("recent");
    expect(parseSort("popular")).toBe("popular");
    expect(parseSort("views")).toBe("views");
  });

  it("최신순", () => {
    expect(order("recent")).toEqual(["b", "c", "a"]);
  });

  it("좋아요순 — 같은 수면 최신 것이 앞", () => {
    expect(order("popular")).toEqual(["b", "c", "a"]);
  });

  it("조회순", () => {
    expect(order("views")).toEqual(["a", "c", "b"]);
  });
});
