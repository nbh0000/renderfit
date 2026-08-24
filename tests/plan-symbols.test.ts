import { describe, expect, it } from "vitest";
import { symbolFor } from "@/services/planSymbols";

/**
 * 평면도 가구 기호.
 *
 * 예전에는 가구를 빈 사각형으로 그리고 안에 이름과 치수를 적었다. 그래서 도면을
 * 펼치면 글자만 빼곡했고 실제 도면처럼 보이지 않았다 — 도면을 읽는 사람은 글자가
 * 아니라 모양으로 무엇인지 안다.
 */
describe("무엇을 그릴지 고르기", () => {
  it("이름이 종류보다 앞선다", () => {
    /*
     * 변기는 appliance 로 분류돼 오는 일이 많다. 종류만 보면 냉장고와 같은 모양이
     * 되므로 이름을 먼저 본다.
     */
    const toilet = symbolFor({ name: "욕실 변기", type: "appliance" });
    const fridge = symbolFor({ name: "냉장고", type: "appliance" });

    expect(toilet).not.toBeNull();
    expect(fridge).not.toBeNull();
    expect(toilet!.detail).not.toBe(fridge!.detail);
  });

  it("침대는 베개가 있다 — 사각형과 구별돼야 한다", () => {
    const bed = symbolFor({ name: "침실1 침대", type: "bed" });
    expect(bed).not.toBeNull();
    // 베개 둘 + 머리판 + 이불선
    expect(bed!.detail).toContain("rect");
    expect(bed!.detail.match(/rect/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it("소파는 인원수만큼 방석이 나뉜다", () => {
    const two = symbolFor({ name: "2인 소파", type: "sofa" });
    const three = symbolFor({ name: "3인 소파", type: "sofa" });

    const lines = (value: string) => (value.match(/<line/g) ?? []).length;
    expect(lines(three!.detail)).toBeGreaterThan(lines(two!.detail));
  });

  it("위생기구는 저마다 다른 모양이다", () => {
    const shapes = ["변기", "세면대", "욕조", "샤워부스"].map(
      (name) => symbolFor({ name, type: "appliance" })!.detail
    );

    // 넷이 모두 달라야 도면에서 구별된다
    expect(new Set(shapes).size).toBe(4);
  });

  it("모르는 것은 기호 없이 사각형으로 둔다", () => {
    // 기호가 없으면 부르는 쪽이 빈 사각형을 그린다 — 엉뚱한 모양보다 낫다
    expect(symbolFor({ name: "정체불명", type: "decoration" })).toBeNull();
  });

  it("기호는 자기 좌표계 안에 있다", () => {
    /*
     * 크기와 회전은 부르는 쪽이 입힌다. 기호가 -0.5~0.5 밖으로 나가면 가구 크기를
     * 입혔을 때 이웃을 침범한다.
     */
    for (const name of ["침대", "3인 소파", "변기", "냉장고", "식탁"]) {
      const symbol = symbolFor({ name, type: "cabinet" })!;
      const numbers = (symbol.detail + (symbol.outline ?? ""))
        .match(/-?\d+\.\d+/g)
        ?.map(Number) ?? [];

      for (const value of numbers) {
        expect(Math.abs(value), `${name}의 ${value}가 좌표계를 벗어난다`).toBeLessThanOrEqual(1);
      }
    }
  });
});
