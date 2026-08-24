import { describe, expect, it } from "vitest";
import { authorLabel } from "@/lib/gallery";

/**
 * 익명 공개.
 *
 * 남의 집 사진이다. 스타일은 자랑하고 싶어도 자기 이름이 갤러리에 붙는 것은 꺼리는
 * 사람이 많고, 그 한 가지 때문에 공개를 안 누른다. 갤러리는 시안이 쌓여야 사는
 * 곳이라 이름을 빼는 선택지를 준다.
 *
 * 구현은 이름 칸을 비우는 것이다 — 갤러리가 빈 칸을 "익명"으로 읽는다. 별도의
 * 플래그를 두지 않은 이유는, 두면 "익명인데 이름은 남아 있는" 상태가 생길 수 있어서다.
 * 이름 자체를 적지 않으면 새어 나갈 것이 없다.
 */
describe("익명으로 공개하기", () => {
  it("이름 칸이 비어 있으면 익명으로 보여 준다", () => {
    expect(authorLabel(null)).toBe("익명");
    expect(authorLabel(undefined)).toBe("익명");
    expect(authorLabel("")).toBe("익명");
  });

  it("공백만 적혀 있어도 익명으로 본다", () => {
    expect(authorLabel("   ")).toBe("익명");
  });

  it("이름을 남기기로 했으면 그대로 보여 준다", () => {
    expect(authorLabel("박하늘")).toBe("박하늘");
    expect(authorLabel("  박하늘  ")).toBe("박하늘");
  });
});
