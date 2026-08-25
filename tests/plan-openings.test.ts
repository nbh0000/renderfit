import { describe, expect, it } from "vitest";
import fixture from "./fixtures/office-plan-openings.json";
import type { RoomAnalysis } from "@/ai/providers/types";

/**
 * 문·현관이 실제로 살아 오는지.
 *
 * 이 자료는 사용자가 넣은 사무실 도면을 문·창 전용 읽기를 붙인 뒤 한 번 분석해 받은
 * 응답이다. 그 전에는 방 일곱 개짜리 아파트에서 창 넷만 오고 문은 하나도 오지 않았다 —
 * 현관문도 방문도 없어서, 어느 방에도 들어갈 수 없는 도면이 나왔다.
 *
 * 유료 호출이라 다시 돌리지 않고 여기 고정해 둔다.
 */

const analysis = fixture as unknown as RoomAnalysis;
const walls = analysis.plan?.walls ?? [];
const openings = walls.flatMap((wall) => wall.openings);

describe("도면에서 읽은 문·창", () => {
  it("문이 있다 — 없으면 어느 방에도 들어갈 수 없다", () => {
    const doors = openings.filter((opening) => opening.kind !== "window");
    expect(doors.length).toBeGreaterThanOrEqual(4);
  });

  it("창도 함께 잡힌다", () => {
    expect(openings.filter((opening) => opening.kind === "window").length).toBeGreaterThan(0);
  });

  it("현관이 빠지지 않는다 — 한국 주택 도면에는 반드시 있다", () => {
    const names = (analysis.plan?.rooms ?? []).map((room) => room.name);
    expect(names.some((name) => name.includes("현관"))).toBe(true);
  });

  it("모든 개구부가 자기 벽 안에 들어간다", () => {
    for (const wall of walls) {
      const span = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
      for (const opening of wall.openings) {
        expect(opening.offsetMm).toBeGreaterThanOrEqual(0);
        expect(opening.offsetMm + opening.widthMm).toBeLessThanOrEqual(Math.ceil(span) + 1);
      }
    }
  });

  it("한 벽에 문이 겹쳐 달리지 않는다", () => {
    for (const wall of walls) {
      const sorted = [...wall.openings].sort((a, b) => a.offsetMm - b.offsetMm);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i].offsetMm).toBeGreaterThanOrEqual(
          sorted[i - 1].offsetMm + sorted[i - 1].widthMm - 1
        );
      }
    }
  });
});
