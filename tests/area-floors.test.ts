import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { areaGeometry } from "@/components/editor/Canvas/AreaFloors";
import { worldXZ } from "@/scene/placement";
import type { RoomArea, RoomSpec } from "@/scene/types";

/**
 * 실별 바닥 패치의 방향.
 *
 * ShapeGeometry 는 XY 평면에 만들어지므로 눕혀야 하는데, 그 회전이 XY 의 +y 를 월드의
 * -z 로 보낸다. 부호를 하나 빠뜨리면 평면도의 욕실이 3D 에서는 반대편에 생긴다 —
 * 화면으로만 보면 "어딘가 이상한데" 로 끝나고 어디가 틀렸는지 알 수가 없다.
 *
 * 그래서 평면 좌표를 넣고 월드 좌표가 제자리에 오는지 숫자로 확인한다.
 */

const room: RoomSpec = {
  type: "living-room",
  dimensions: { width: 4000, length: 3000, height: 2400 },
};

function area(points: [number, number][]): RoomArea {
  return { id: "a1", name: "욕실", points, floorMaterialId: "mat_tile" };
}

/** 지오메트리의 정점들을 [x, y, z] 목록으로 */
function vertices(geometry: THREE.BufferGeometry): [number, number, number][] {
  const position = geometry.getAttribute("position");
  return Array.from({ length: position.count }, (_, i) => [
    position.getX(i),
    position.getY(i),
    position.getZ(i),
  ]);
}

describe("실 바닥 패치", () => {
  it("평면 좌표가 3D 제자리에 온다 — 좌우가 뒤집히지 않는다", () => {
    /*
     * 방 왼쪽 위 구석(도면 기준)에 붙은 실.
     * worldXZ 로는 x 가 음수(왼쪽), z 도 음수(안쪽)여야 한다.
     */
    const corner: [number, number][] = [
      [0, 2000],
      [1000, 2000],
      [1000, 3000],
      [0, 3000],
    ];

    const geometry = areaGeometry(area(corner), room);
    expect(geometry).not.toBeNull();

    const points = vertices(geometry!);

    // 네 꼭짓점이 전부 worldXZ 가 말하는 자리에 있어야 한다
    for (const [px, py] of corner) {
      const [wantX, wantZ] = worldXZ({ cx: px, cy: py }, room);
      const found = points.some(
        ([x, y, z]) =>
          Math.abs(x - wantX) < 1e-6 && Math.abs(z - wantZ) < 1e-6 && Math.abs(y) < 1e-6
      );
      expect(found, `평면 (${px}, ${py}) → 월드 (${wantX}, ${wantZ})`).toBe(true);
    }
  });

  it("도면 위쪽 실은 3D 에서 -z(안쪽)에 온다", () => {
    // 부호를 뒤집으면 이 값이 +z 로 나와 앞뒤가 바뀐다
    const top = areaGeometry(
      area([
        [1000, 2500],
        [3000, 2500],
        [3000, 3000],
        [1000, 3000],
      ]),
      room
    )!;

    const zs = vertices(top).map(([, , z]) => z);
    expect(Math.max(...zs)).toBeLessThan(0);
  });

  it("도면 오른쪽 실은 3D 에서 +x 에 온다", () => {
    const right = areaGeometry(
      area([
        [3000, 0],
        [4000, 0],
        [4000, 1000],
        [3000, 1000],
      ]),
      room
    )!;

    const xs = vertices(right).map(([x]) => x);
    expect(Math.min(...xs)).toBeGreaterThan(0);
  });

  it("UV 는 월드 좌표(m)라 이웃 실과 타일 줄이 맞는다", () => {
    /*
     * ShapeGeometry 의 UV 는 shape 좌표를 그대로 쓴다. shape 좌표가 곧 월드 x·-z(m)
     * 이므로, 머티리얼 반복을 1/타일크기로 주면 타일 한 장이 정확히 그 크기가 된다.
     * 패치 모양이나 방 크기와 무관하다.
     */
    const geometry = areaGeometry(
      area([
        [0, 0],
        [2000, 0],
        [2000, 1000],
        [0, 1000],
      ]),
      room
    )!;

    const uv = geometry.getAttribute("uv");
    const position = geometry.getAttribute("position");

    for (let i = 0; i < position.count; i += 1) {
      expect(uv.getX(i)).toBeCloseTo(position.getX(i), 6);
      // 눕히는 회전이 y → -z 였으므로 UV 의 v 는 -z 다
      expect(uv.getY(i)).toBeCloseTo(-position.getZ(i), 6);
    }
  });

  it("바닥에 눕는다 — 모든 정점의 y 가 0", () => {
    const geometry = areaGeometry(
      area([
        [0, 0],
        [1000, 0],
        [1000, 1000],
      ]),
      room
    )!;

    for (const [, y] of vertices(geometry)) expect(y).toBeCloseTo(0, 9);
  });

  it("점이 모자라거나 면적이 없으면 만들지 않는다", () => {
    expect(areaGeometry(area([[0, 0], [1000, 0]]), room)).toBeNull();
    // 한 줄로 눌린 폴리곤 — 넓이가 0이다
    expect(
      areaGeometry(area([[0, 0], [1000, 0], [2000, 0]]), room)
    ).toBeNull();
  });
});
