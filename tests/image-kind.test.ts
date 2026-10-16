import { describe, expect, it } from "vitest";
import { classifyImage, drawingReadability } from "@/scene/imageKind";

/**
 * 사진인가 도면인가.
 *
 * 여기가 틀리면 그 뒤가 전부 헛돈다 — 도면을 사진 경로로 보내면 "이 실내 사진을 보고
 * 평면도를 복원한다" 는 프롬프트가 나가고, 치수 체인도 격자도 아예 안 읽는다.
 * 실제로 방 25개짜리 박물관 평면도가 4개로 나온 적이 있다.
 */

/** 선 도면 — 흰 종이가 대부분이고 색이 거의 없다 */
const DRAWING = { nearWhiteRatio: 0.82, meanSaturation: 6, width: 2400, height: 1600 };
/** 실내 사진 — 화면이 무언가로 차 있고 색이 있다 */
const PHOTO = { nearWhiteRatio: 0.08, meanSaturation: 54, width: 1600, height: 1200 };

describe("classifyImage", () => {
  it("사진으로 올린 선 도면을 도면으로 되돌린다", () => {
    const verdict = classifyImage(DRAWING, "photo");

    expect(verdict.kind).toBe("floorplan");
    expect(verdict.overrode).toBe(true);
    expect(verdict.reason).toContain("선 도면");
  });

  it("진짜 사진은 건드리지 않는다", () => {
    const verdict = classifyImage(PHOTO, "photo");

    expect(verdict.kind).toBe("photo");
    expect(verdict.overrode).toBe(false);
  });

  it("도면이라고 고른 것은 사진처럼 보여도 그대로 둔다", () => {
    /*
     * 어두운 데서 찍은 도면 사진이 여기 걸린다. 사용자가 도면이라고 했으면 도면이다 —
     * 우리 통계가 사용자 말을 뒤집을 이유는 "잘못 고르면 통째로 헛돈다" 한 방향뿐이다.
     */
    const verdict = classifyImage(PHOTO, "floorplan");

    expect(verdict.kind).toBe("floorplan");
    expect(verdict.overrode).toBe(false);
  });

  it("밝지만 색이 있는 사진은 도면으로 보지 않는다", () => {
    /* 흰 벽에 채광이 좋은 방 — 흰 픽셀은 많지만 나무·천의 색이 남는다 */
    const bright = { nearWhiteRatio: 0.55, meanSaturation: 40, width: 1600, height: 1200 };
    expect(classifyImage(bright, "photo").kind).toBe("photo");
  });

  it("회색조지만 꽉 찬 그림도 도면으로 보지 않는다", () => {
    /* 흑백으로 찍은 실내 사진 — 채도는 0 이지만 흰 바탕이 없다 */
    const monochrome = { nearWhiteRatio: 0.12, meanSaturation: 3, width: 1600, height: 1200 };
    expect(classifyImage(monochrome, "photo").kind).toBe("photo");
  });
});

describe("drawingReadability", () => {
  /*
   * 이제 사용자에게 "다시 올려 주세요" 라고 하지 않는다.
   *
   * 사용자는 손에 있는 파일을 올릴 뿐이고, 못 읽는 것은 우리 문제다. 작은 그림은
   * 파서가 좌표를 그대로 읽는다. 이 함수는 로그에만 남는 기록이다.
   */

  it("작은 그림은 조각내 읽는다고 기록만 남긴다", () => {
    const note = drawingReadability({ width: 747, height: 449 })!;

    expect(note).toContain("747×449");
    expect(note).toContain("조각내");
    /* 다시 올리라는 말은 하지 않는다 */
    expect(note).not.toContain("올려");
  });

  it("넉넉한 그림에는 아무 말도 남기지 않는다", () => {
    expect(drawingReadability({ width: 3300, height: 2300 })).toBeNull();
    expect(drawingReadability({ width: 2400, height: 1600 })).toBeNull();
  });
});
