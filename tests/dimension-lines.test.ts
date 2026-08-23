import { describe, expect, it } from "vitest";
import { dimensionsByRoom } from "@/ai/providers/vision";

/**
 * 치수선에서 실 치수만 골라내기.
 *
 * 아래 값들은 실제 아파트 평면도 한 장에서 치수선 전용 호출이 돌려준 39개 가운데
 * 골라 온 것이다. 도면에 적힌 숫자는 대부분 실 전체를 재지 않는다 — 침실 아래
 * 2190mm은 방문과 모서리 사이 벽 토막이고, 위쪽 3150mm은 침대 폭이다.
 * 이것을 방 폭으로 쓰면 3150mm짜리 침실이 2190mm으로 줄어든다.
 */
describe("치수선에서 실 치수 고르기", () => {
  it("실 전체를 재는 것만 쓴다", () => {
    const byRoom = dimensionsByRoom([
      { millimetres: 2450, axis: "x", scope: "room", roomName: "침실 1" },
      { millimetres: 2330, axis: "x", scope: "segment", roomName: "침실 1" },
      { millimetres: 2520, axis: "y", scope: "room", roomName: "침실 1" },
    ]);

    expect(byRoom.get("침실1")).toEqual({ x: 2450, y: 2520 });
  });

  it("벽 토막밖에 없으면 그 실은 비워 둔다", () => {
    // 실제로 침실2에는 room으로 잡힌 폭이 없었다 — 그럴 때는 그림을 따라야 한다
    const byRoom = dimensionsByRoom([
      { millimetres: 2190, axis: "x", scope: "segment", roomName: "침실 2" },
      { millimetres: 350, axis: "x", scope: "segment", roomName: "침실 2" },
      { millimetres: 2520, axis: "y", scope: "room", roomName: "침실 2" },
    ]);

    expect(byRoom.get("침실2")).toEqual({ y: 2520 });
  });

  it("이름의 공백은 무시하고 맞춘다", () => {
    // 본문은 "침실 1", 치수선 쪽은 "침실1"로 적는 일이 흔하다
    const byRoom = dimensionsByRoom([
      { millimetres: 2200, axis: "x", scope: "room", roomName: " 욕 실 " },
    ]);

    expect(byRoom.get("욕실")).toEqual({ x: 2200 });
  });

  it("어느 실인지 모르는 치수선은 버린다", () => {
    // 여러 실을 함께 재는 5700 같은 것은 roomName이 비어 온다
    const byRoom = dimensionsByRoom([
      { millimetres: 5700, axis: "x", scope: "segment", roomName: "" },
      { millimetres: 4530, axis: "y", scope: "room", roomName: "" },
    ]);

    expect(byRoom.size).toBe(0);
  });

  it("사람이 사는 방 크기가 아닌 값은 버린다", () => {
    const byRoom = dimensionsByRoom([
      { millimetres: 90, axis: "x", scope: "room", roomName: "욕실" },
      { millimetres: 120000, axis: "y", scope: "room", roomName: "욕실" },
    ]);

    expect(byRoom.size).toBe(0);
  });
});
