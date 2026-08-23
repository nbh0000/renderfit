import type { RoomSpec, SceneObject } from "@/scene/types";
import { ensureRoom } from "@/scene/geometry";

/**
 * 실 하나의 치수를 실측값으로 고쳐 앉힌다.
 *
 * 도면을 스캔하면 치수선이 그어져 있는 실은 정확히 나오지만, 치수선이 없는 실은
 * 모델이 눈대중으로 그린 그대로 들어온다 — 같은 도면을 두 번 넣으면 거실 깊이가
 * 2.2m와 4.5m로 갈리기도 한다. AI를 더 조여서 없앨 수 있는 종류의 오차가 아니다.
 *
 * 그래서 사람이 줄자로 잰 값을 직접 넣는 길을 둔다. 그 실만 늘이면 이웃 실과 벽이
 * 어긋나므로, 실 경계를 따라 도면 전체를 세로줄·가로줄로 잘라 칸을 만들고 그 실이
 * 차지한 칸만 늘인다. 나머지 칸은 크기를 지킨 채 밀려나므로, 방들이 서로 붙어 있는
 * 관계와 벽·가구의 상대 위치가 그대로 남는다.
 *
 * 가구는 제품 규격이라 크기를 지키고 자리만 따라 옮긴다.
 */

/** 좌표가 이만큼 안쪽이면 같은 칸 경계로 본다 (mm) */
const CUT_TOLERANCE = 120;

/** 좌표들을 칸 경계로 추린다 — 가까운 것끼리는 하나로 본다 */
function cutsFrom(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const cuts: number[] = [];
  for (const value of sorted) {
    if (cuts.length === 0 || value - cuts[cuts.length - 1] > CUT_TOLERANCE) cuts.push(value);
  }
  return cuts;
}

/** from~to 구간에 든 칸 번호 */
function spanOf(cuts: number[], from: number, to: number): number[] {
  const cells: number[] = [];
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const middle = (cuts[i] + cuts[i + 1]) / 2;
    if (middle > from && middle < to) cells.push(i);
  }
  return cells;
}

/**
 * 옛 좌표를 새 좌표로 옮기는 함수를 만든다.
 *
 * 늘어난 칸 안쪽은 비례로, 칸 바깥은 통째로 밀린다. 그래서 벽 한 장이 늘어난 칸에
 * 걸쳐 있어도 끊기지 않고 함께 늘어난다.
 */
function remapper(cuts: number[], sizes: number[]) {
  const moved = [cuts[0]];
  for (let i = 0; i < sizes.length; i += 1) moved.push(moved[i] + sizes[i]);

  return (value: number) => {
    if (value <= cuts[0]) return Math.round(moved[0] + (value - cuts[0]));

    for (let i = 0; i < sizes.length; i += 1) {
      if (value <= cuts[i + 1]) {
        const width = cuts[i + 1] - cuts[i];
        const ratio = width > 0 ? (value - cuts[i]) / width : 0;
        return Math.round(moved[i] + sizes[i] * ratio);
      }
    }

    return Math.round(moved[moved.length - 1] + (value - cuts[cuts.length - 1]));
  };
}

/** 사람이 사는 방 치수로 말이 되는 값인가 */
export function isSaneRoomSize(millimetres: number): boolean {
  return Number.isFinite(millimetres) && millimetres >= 600 && millimetres <= 30000;
}

export type ResizeAreaResult = {
  room: RoomSpec;
  objects: SceneObject[];
};

/**
 * 실 하나의 폭·깊이를 바꾼다.
 *
 * width나 length 중 준 것만 바꾸고, 나머지 축은 건드리지 않는다 — 한 변만 재고
 * 온 경우가 많다.
 */
export function resizeArea(
  source: RoomSpec,
  objects: SceneObject[],
  areaId: string,
  wanted: { width?: number; length?: number }
): ResizeAreaResult | null {
  const room = ensureRoom(source);
  const area = (room.areas ?? []).find((item) => item.id === areaId);
  if (!area || area.points.length < 3) return null;

  const xs = area.points.map(([x]) => x);
  const ys = area.points.map(([, y]) => y);
  const box = {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };

  const width = wanted.width && isSaneRoomSize(wanted.width) ? wanted.width : null;
  const length = wanted.length && isSaneRoomSize(wanted.length) ? wanted.length : null;
  if (width === null && length === null) return null;

  /*
   * 칸 경계는 모든 실의 모서리에서 뽑는다.
   * 실이 하나뿐이면 방 전체 테두리가 유일한 칸이 되어 그냥 전체가 늘어난다.
   */
  const areas = room.areas ?? [];
  const xCuts = cutsFrom([0, room.dimensions.width, ...areas.flatMap((a) => a.points.map(([x]) => x))]);
  const yCuts = cutsFrom([0, room.dimensions.length, ...areas.flatMap((a) => a.points.map(([, y]) => y))]);

  const xSizes = xCuts.slice(0, -1).map((cut, index) => xCuts[index + 1] - cut);
  const ySizes = yCuts.slice(0, -1).map((cut, index) => yCuts[index + 1] - cut);

  /** 이 실이 차지한 칸들을 합이 target이 되도록 같은 비율로 늘인다 */
  const stretch = (cuts: number[], sizes: number[], from: number, to: number, target: number) => {
    const cells = spanOf(cuts, from, to);
    if (cells.length === 0) return;

    const current = cells.reduce((sum, index) => sum + sizes[index], 0);
    if (current <= 0) return;

    const factor = target / current;
    for (const index of cells) sizes[index] = Math.max(100, Math.round(sizes[index] * factor));
  };

  if (width !== null) stretch(xCuts, xSizes, box.x0, box.x1, width);
  if (length !== null) stretch(yCuts, ySizes, box.y0, box.y1, length);

  const mapX = remapper(xCuts, xSizes);
  const mapY = remapper(yCuts, ySizes);
  const point = ([x, y]: [number, number]): [number, number] => [mapX(x), mapY(y)];

  const dimensions = {
    ...room.dimensions,
    width: Math.max(...xCuts.map(mapX)),
    length: Math.max(...yCuts.map(mapY)),
  };

  const walls = (room.walls ?? []).map((wall) => {
    const before = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1]);
    const start = point(wall.start);
    const end = point(wall.end);
    const after = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const scale = before > 0 ? after / before : 1;

    return {
      ...wall,
      start,
      end,
      // 창·문도 벽과 같은 비율로 따라간다 (안 그러면 벽 밖으로 밀려난다)
      openings: wall.openings.map((opening) => {
        const openingWidth = Math.min(Math.round(opening.width * scale), Math.round(after));
        const offset = Math.min(Math.round(opening.offset * scale), Math.round(after) - openingWidth);
        return { ...opening, width: openingWidth, offset: Math.max(0, offset) };
      }),
    };
  });

  /*
   * 가구는 크기를 지키고 자리만 옮긴다.
   *
   * screen.x와 depth는 방 크기에 대한 비율이라, 방이 커지면 같은 비율이 다른 자리를
   * 가리킨다. 그래서 mm로 풀었다가 새 방 크기에 맞춰 다시 비율로 만든다.
   */
  const moved = objects.map((object) => {
    const centreX = (object.screen.x + object.screen.width / 2) * room.dimensions.width;
    const centreY = object.depth * room.dimensions.length;
    const nextX = mapX(centreX);
    const nextY = mapY(centreY);

    return {
      ...object,
      screen: {
        ...object.screen,
        x: Math.min(1, Math.max(0, nextX / dimensions.width - object.screen.width / 2)),
      },
      depth: Math.min(1, Math.max(0, nextY / dimensions.length)),
    };
  });

  return {
    room: {
      ...room,
      dimensions,
      walls,
      areas: areas.map((item) => ({ ...item, points: item.points.map(point) })),
      annotations: (room.annotations ?? []).map((item) => ({
        ...item,
        points: item.points.map(point),
      })),
    },
    objects: moved,
  };
}
