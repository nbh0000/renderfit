import {
  ensureRoom,
  levelIdOf,
  levelsOf,
  pointAlongWall,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  wallLength,
  wallSpans,
} from "./geometry";
import { mountingOf, planCenter } from "./placement";
import type { Scene } from "./types";

/**
 * 걷기 모드의 순수 계산.
 *
 * 3D 뷰에서 사람 눈높이로 공간을 걸어 다니며 확인하는 기능의 밑바닥이다. 여기에는
 * 렌더러(3D 라이브러리·화면 프레임워크)를 들이지 않는다 — 매 프레임 불리는 계산이라
 * 정확성과 "끼임 없음"을 시험으로 굳혀 둬야 하는데, 렌더러에 섞여 있으면 시험할 수가
 * 없다. 이 파일이 그 둘을 import 하지 않는지는 기계로도 확인한다.
 *
 * ── 좌표계 ──
 * 이 파일의 모든 좌표는 **평면 좌표(mm)** 다. 원점은 방의 좌측 하단이고,
 * x 는 오른쪽, y 는 도면 위쪽(안쪽)으로 커진다. 벽·실·가구가 전부 이 좌표를 쓴다.
 *
 * 3D 월드(m) 로의 변환은 여기서 하지 않는다. `scene/placement.ts` 의 `worldXZ` 가
 * 유일한 통로다 — 변환 규칙이 흩어지면 3D 에서 소파가 벽을 보고 앉는다.
 */

/* ────────────────────────────── 사람의 치수 ────────────────────────────── */

/** 키 170cm·몸무게 70kg 성인 남성 기준. 선 자세 눈높이는 신장의 약 93.5%. (mm) */
export const EYE_HEIGHT_MM = 1590;

/** 어깨너비 약 46cm 의 절반 — 몸이 벽·가구에 닿는 거리 (mm) */
export const PLAYER_RADIUS_MM = 230;

/** 실내 보행 속도 (mm/초). 인테리어 확인용이라 실제 속도여야 크기감이 맞는다 */
export const WALK_SPEED_MM_S = 1400;

/** 뛰는 속도 (mm/초) */
export const RUN_SPEED_MM_S = 3000;

/** 이보다 낮은 벽 조각(문지방·걸레받이 높이)은 넘어간다 (mm) */
export const STEP_OVER_MM = 300;

/**
 * 한 번의 충돌 보정에서 옮길 수 있는 최대 거리 (mm).
 *
 * 이보다 길면 나눠서 처리한다. 사람 반지름(230mm)보다 작아야 한 프레임에 벽을
 * 관통하지 않는다 — 성큼 뛰어 벽 반대편에 서 있는 일을 막는 것이 목적이다.
 */
export const MAX_SUBSTEP_MM = 80;

/** 이보다 작은 물체는 막지 않는다 (mm). 화분·소품에 걸려 못 지나가면 답답하다 */
const MIN_BLOCKING_SIZE_MM = 150;

/** 밀어내기를 몇 번까지 되풀이할지 — 모서리는 두세 번이면 풀린다 */
const MAX_PUSH_ROUNDS = 6;

/** 이보다 얕은 침투는 없는 것으로 본다 (mm). 부동소수 오차로 무한히 밀어내지 않게 */
const PENETRATION_EPSILON = 0.01;

/* ────────────────────────────── 조이스틱 ────────────────────────────── */

/**
 * 화면 조이스틱의 치수 (px).
 *
 * 엄지로 미는 거리라 손가락 크기에 맞춘 값이다. 반지름을 더 키우면 엄지가 안 닿고,
 * 더 줄이면 미세 조작이 안 된다.
 */
export const JOYSTICK = {
  /** 이보다 덜 움직였으면 안 민 것으로 본다 — 엄지를 얹기만 해도 걸어가면 곤란하다 */
  deadZone: 6,
  /** 여기까지 밀면 최대 속도 */
  radius: 40,
  /** 최대치에서 이만큼 더 밀면 달린다 */
  runExtra: 40,
} as const;

export interface JoystickInput {
  /** 좌(-1) ~ 우(+1) */
  x: number;
  /** 뒤(-1) ~ 앞(+1) */
  y: number;
  /** 손잡이가 베이스 밖까지 나갔는지 */
  run: boolean;
}

/**
 * 손잡이가 베이스 중심에서 얼마나 벗어났는지(px) → 이동 입력.
 *
 * 화면 좌표를 받는다 — 화면은 아래로 y 가 커지므로, 위로 밀면 앞으로 가도록 y 를
 * 뒤집어 돌려준다.
 *
 * 응답을 선형으로 두면 미세 조작이 안 된다. 조금 밀었을 때와 많이 밀었을 때의 차이가
 * 그대로 속도 차이가 되어, 벽 앞에서 살살 다가가려 해도 훅 들어가 버린다. 1.5제곱을
 * 씌우면 초반이 완만해져 천천히 걷는 구간이 생긴다.
 */
export function joystickInput(dx: number, dy: number): JoystickInput {
  const distance = Math.hypot(dx, dy);
  if (distance < JOYSTICK.deadZone) return { x: 0, y: 0, run: false };

  const span = JOYSTICK.radius - JOYSTICK.deadZone;
  const raw = Math.min(1, Math.max(0, (distance - JOYSTICK.deadZone) / span));
  const magnitude = Math.pow(raw, 1.5);

  return {
    x: (dx / distance) * magnitude,
    // 화면 y 는 아래로 커진다 — 위로 밀면 앞(+)이어야 한다
    y: (-dy / distance) * magnitude,
    run: distance >= JOYSTICK.radius + JOYSTICK.runExtra,
  };
}

/**
 * 손잡이를 화면에 그릴 위치 (px, 베이스 중심 기준).
 *
 * 최대 반지름을 넘어가면 방향만 유지하고 테두리에 붙여 둔다 — 손가락은 더 나갔는데
 * 손잡이가 따라 나가면 조이스틱이 아니라 그냥 점 하나가 끌려다니는 것으로 보인다.
 */
export function joystickKnob(dx: number, dy: number): [number, number] {
  const distance = Math.hypot(dx, dy);
  if (distance <= JOYSTICK.radius) return [dx, dy];
  return [(dx / distance) * JOYSTICK.radius, (dy / distance) * JOYSTICK.radius];
}

/* ────────────────────────────── 막는 것 ────────────────────────────── */

/**
 * 이동을 막는 선분 하나.
 *
 * 벽도 가구도 결국 "두께가 있는 선분"으로 본다. 사람을 원으로 보고 이 선분에서
 * `반지름 + halfThickness` 만큼 떨어져 있게 하면 충돌 처리가 끝난다.
 *
 * `abx`·`aby`·`lenSq` 는 매 프레임 다시 구하지 않으려고 미리 담아 두는 값이다.
 * 선분 하나에 대한 최근접점 계산이 프레임당 수천 번 돌기 때문에, 이 세 개를
 * 미리 계산해 두는 것만으로 눈에 띄게 싸진다.
 */
export interface WalkBlocker {
  /** 선분 시작점 (mm) */
  a: [number, number];
  /** 선분 끝점 (mm) */
  b: [number, number];
  /** 선분에서 이만큼 두꺼운 것으로 본다 (벽은 thickness/2, 가구 변은 0) */
  halfThickness: number;
  /** 디버깅·테스트용 */
  source: "wall" | "object";
  sourceId: string;
  /** b - a 의 x 성분 (mm) — 미리 계산해 둔 값 */
  abx: number;
  /** b - a 의 y 성분 (mm) */
  aby: number;
  /** |b - a|² — 0 이면 점이므로 건너뛴다 */
  lenSq: number;
}

/** 선분 하나를 blocker 로 만든다 */
function blocker(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  halfThickness: number,
  source: "wall" | "object",
  sourceId: string
): WalkBlocker {
  const abx = bx - ax;
  const aby = by - ay;
  return {
    a: [ax, ay],
    b: [bx, by],
    halfThickness,
    source,
    sourceId,
    abx,
    aby,
    lenSq: abx * abx + aby * aby,
  };
}

/**
 * 해당 층에서 이동을 막는 선분 목록.
 *
 * 벽은 `wallSpans` 가 개구부로 잘라 준 조각 중 **바닥에 닿아 있는 것** 만 막는다.
 * 문은 sillHeight 가 0 이라 그 자리에 바닥부터 시작하는 조각이 없다 — 그래서 저절로
 * 뚫린다. 창은 sillHeight 가 있어 하인방 조각이 남고, 그 조각이 막는다. 개구부를
 * 따로 뒤질 필요가 없다는 뜻이다.
 *
 * 반환 순서는 벽 → 가구, 각각 id 순으로 고정한다. 3D 뷰가 이 배열을 `useMemo` 의
 * 결과로 들고 있어서, 같은 장면이면 같은 배열이 나와야 매 프레임 다시 만들지 않는다.
 *
 * @param levelId 이 층의 것만 고른다 (복층에서 위층 벽에 막히면 안 된다)
 */
export function walkBlockers(scene: Scene, levelId: string): WalkBlocker[] {
  const room = ensureRoom(scene.room);
  const levels = levelsOf(room);
  const blockers: WalkBlocker[] = [];

  /* ── 벽 ── */
  const walls = [...(room.walls ?? [])].sort((a, b) => a.id.localeCompare(b.id));

  for (const wall of walls) {
    if (levelIdOf(wall, levels) !== levelId) continue;
    if (wallLength(wall) < 1) continue;

    const half = wall.thickness / 2;

    for (const span of wallSpans(wall)) {
      // 바닥에서 시작하지 않는 조각(창 위 상인방)은 머리 위로 지나간다
      if (span.bottom !== 0) continue;
      // 문지방만큼 낮은 턱은 넘어간다
      if (span.top < STEP_OVER_MM) continue;
      if (span.to - span.from < 1) continue;

      const [ax, ay] = pointAlongWall(wall, span.from);
      const [bx, by] = pointAlongWall(wall, span.to);
      blockers.push(blocker(ax, ay, bx, by, half, "wall", wall.id));
    }
  }

  /*
   * 이 층에 벽이 하나도 없으면 방 테두리를 대신 세운다.
   *
   * ensureRoom 은 walls 가 비어 있을 때 직사각형을 만들어 주지만, 벽이 있는데 전부
   * 다른 층인 경우는 걸러 주지 못한다. 그러면 막는 것이 하나도 없어 바닥 밖으로
   * 걸어 나가고, 방이 어디서 끝나는지 알 수 없게 된다.
   */
  if (blockers.length === 0) {
    const { width, length } = room.dimensions;
    const corners: [number, number][] = [
      [0, 0],
      [width, 0],
      [width, length],
      [0, length],
    ];

    corners.forEach(([ax, ay], index) => {
      const [bx, by] = corners[(index + 1) % corners.length];
      blockers.push(blocker(ax, ay, bx, by, 0, "wall", `${levelId}_edge_${index}`));
    });
  }

  /* ── 가구 ── */
  const objects = [...scene.objects].sort((a, b) => a.id.localeCompare(b.id));

  for (const object of objects) {
    if (object.visibility === false) continue;
    if (levelIdOf(object, levels) !== levelId) continue;
    // 문·창은 벽 개구부로 이미 처리된다
    if (object.type === "door" || object.type === "window") continue;
    // 벽에 걸린 액자와 천장등은 지나가는 데 걸리지 않는다
    if (mountingOf(object) !== "floor") continue;

    const width = object.dimensions.width * object.transform.scale[0];
    const depth = object.dimensions.depth * object.transform.scale[2];
    if (width < MIN_BLOCKING_SIZE_MM || depth < MIN_BLOCKING_SIZE_MM) continue;

    const { cx, cy } = planCenter(object.screen, object.depth, room);

    /*
     * 회전 부호는 3D 렌더와 반드시 같아야 한다.
     *
     * 3D 는 `rotation=[0, -θ, 0]` 로 그리고(Canvas3D 의 ObjectMesh), 평면 → 3D 변환인
     * `worldXZ` 는 `Z = (length/2 - cy)` 로 y 를 뒤집는다. 둘을 합치면 평면 좌표에서
     * 꼭짓점은 아래 식이 된다.
     *
     *   cx + u·cosθ - v·sinθ
     *   cy - u·sinθ - v·cosθ        (u = 폭 방향, v = 깊이 방향)
     *
     * θ=90도를 넣어 보면 폭 축이 y 로, 깊이 축이 x 로 간다. 부호를 하나라도 뒤집으면
     * 3D 에서는 소파를 옆으로 지나갈 수 있는데 걷기에서는 막히는 일이 생긴다.
     */
    const radians = (object.screen.rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const hw = width / 2;
    const hd = depth / 2;

    // 네 꼭짓점 — 둘레를 한 바퀴 도는 순서로
    const cornerX = [
      cx - hw * cos + hd * sin,
      cx + hw * cos + hd * sin,
      cx + hw * cos - hd * sin,
      cx - hw * cos - hd * sin,
    ];
    const cornerY = [
      cy + hw * sin + hd * cos,
      cy - hw * sin + hd * cos,
      cy - hw * sin - hd * cos,
      cy + hw * sin - hd * cos,
    ];

    for (let i = 0; i < 4; i += 1) {
      const j = (i + 1) % 4;
      blockers.push(
        blocker(cornerX[i], cornerY[i], cornerX[j], cornerY[j], 0, "object", object.id)
      );
    }
  }

  return blockers;
}

/* ────────────────────────────── 충돌 보정 ────────────────────────────── */

/*
 * 밀어내기 결과를 담는 자리.
 *
 * 매 프레임 불리는 계산이라 호출마다 배열·객체를 만들면 그만큼 쓰레기가 쌓인다.
 * 모듈 밖으로 나가지 않는 값이므로 여기에 담아 두고 부르는 쪽이 읽어 간다.
 */
let outX = 0;
let outY = 0;

/**
 * 점 하나를 blocker 밖으로 밀어낸다. 결과는 `outX`·`outY` 에 쓴다.
 *
 * 법선 방향으로만 밀어내는 것이 핵심이다. 그래서 벽에 비스듬히 부딪히면 벽을 따라
 * 미끄러지고(슬라이딩을 따로 만들 필요가 없다), 두 벽이 만나는 모서리에서는 두 법선이
 * 차례로 적용돼 모서리 바깥으로 튀어나가지 않는다.
 *
 * @param refX 선분 위에 정확히 얹혔을 때 어느 쪽으로 밀어낼지 정하는 기준점
 * @returns 침투가 남지 않았으면 true
 */
function pushOut(
  px: number,
  py: number,
  radius: number,
  blockers: WalkBlocker[],
  refX: number,
  refY: number
): boolean {
  let x = px;
  let y = py;

  for (let round = 0; round < MAX_PUSH_ROUNDS; round += 1) {
    let touched = false;

    for (let i = 0; i < blockers.length; i += 1) {
      const item = blockers[i];
      if (item.lenSq === 0) continue;

      const ax = item.a[0];
      const ay = item.a[1];

      // 점에서 선분까지의 최근접점
      let t = ((x - ax) * item.abx + (y - ay) * item.aby) / item.lenSq;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;

      const qx = ax + item.abx * t;
      const qy = ay + item.aby * t;

      let nx = x - qx;
      let ny = y - qy;
      const dist = Math.sqrt(nx * nx + ny * ny);

      const minDist = radius + item.halfThickness;
      if (dist >= minDist - PENETRATION_EPSILON) continue;

      if (dist > PENETRATION_EPSILON) {
        nx /= dist;
        ny /= dist;
      } else {
        /*
         * 선분 위에 정확히 얹혔다 — 나갈 방향을 계산으로 정할 수 없다.
         * 선분에 수직인 두 방향 중 기준점(들어오기 전 자리)에 가까운 쪽으로 나간다.
         * 그래야 벽을 뚫고 반대편으로 나가 버리지 않는다.
         */
        const len = Math.sqrt(item.lenSq);
        nx = -item.aby / len;
        ny = item.abx / len;
        if ((refX - qx) * nx + (refY - qy) * ny < 0) {
          nx = -nx;
          ny = -ny;
        }
      }

      const penetration = minDist - dist;
      x += nx * penetration;
      y += ny * penetration;
      touched = true;
    }

    if (!touched) {
      outX = x;
      outY = y;
      return true;
    }
  }

  outX = x;
  outY = y;
  return false;
}

/**
 * `from` 에서 `to` 로 가려는 이동을 blocker 를 뚫지 않게 보정한 실제 도달 위치.
 *
 * 사람을 반지름 `radius` 의 원으로 본다. 이동이 길면 `MAX_SUBSTEP_MM` 단위로 나눠
 * 처리한다 — 한 프레임에 벽 두께보다 멀리 뛰면 벽 반대편에 가 있게 되기 때문이다.
 *
 * 좁은 틈이나 오목한 모서리에 끼어 밀어내기가 안 풀리면, 그 서브스텝의 이동을 취소하고
 * 거기서 멈춘다. 억지로 밀어내다 벽을 뚫고 나가는 것보다 못 가는 편이 낫다.
 *
 * 호출당 힙 할당이 없다(돌려주는 튜플 하나만 예외).
 *
 * @param from 지금 자리 (평면 mm)
 * @param to 가려는 자리 (평면 mm)
 * @param radius 사람 반지름 (mm)
 */
export function resolveWalk(
  from: [number, number],
  to: [number, number],
  radius: number,
  blockers: WalkBlocker[]
): [number, number] {
  const total = Math.hypot(to[0] - from[0], to[1] - from[1]);

  // 총 이동이 0 이어도 한 번은 밀어내야 한다 — 벽에 끼인 채 시작할 수 있다
  const steps = Math.max(1, Math.ceil(total / MAX_SUBSTEP_MM));
  const dx = (to[0] - from[0]) / steps;
  const dy = (to[1] - from[1]) / steps;

  let x = from[0];
  let y = from[1];

  for (let step = 0; step < steps; step += 1) {
    const prevX = x;
    const prevY = y;

    x += dx;
    y += dy;

    if (pushOut(x, y, radius, blockers, prevX, prevY)) {
      x = outX;
      y = outY;
      continue;
    }

    // 끼었다 — 이 서브스텝을 되돌리고 여기서 멈춘다
    return [prevX, prevY];
  }

  return [x, y];
}

/* ────────────────────────────── 시작 위치 ────────────────────────────── */

/**
 * 걷기를 시작할 자리 (평면 mm).
 *
 * 가장 넓은 실의 한가운데에서 시작한다. 좁은 욕실이나 현관에서 시작하면 처음 보이는
 * 것이 벽밖에 없어서 무엇을 보는 화면인지 알 수 없다.
 *
 * 실 폴리곤의 무게중심이 벽에 걸치는 일이 있다(ㄱ자 실이나 벽에 붙은 좁은 실).
 * 그럴 때는 벽 밖으로 밀어내고, 그래도 안 풀리면 방 한가운데로 물러난다.
 */
/**
 * 가구 하나하나의 외곽 다각형.
 *
 * blocker 는 변 단위라 "안에 있는지"를 못 따진다. 그래서 같은 가구의 변을 다시 모아
 * 다각형으로 만든다. `walkBlockers` 가 가구마다 네 변을 둘레 순서로 넣기 때문에
 * sourceId 로 묶기만 하면 그대로 다각형이 된다.
 */
function furniturePolygons(blockers: WalkBlocker[]): [number, number][][] {
  const byObject = new Map<string, [number, number][]>();

  for (const item of blockers) {
    if (item.source !== "object") continue;
    const points = byObject.get(item.sourceId);
    if (points) points.push(item.a);
    else byObject.set(item.sourceId, [item.a]);
  }

  return [...byObject.values()].filter((points) => points.length >= 3);
}

/**
 * 이 자리가 가구 **안**인가.
 *
 * 침투(변에서 반지름 안)와는 다른 문제다. 큰 테이블 한가운데에 서면 어느 변에서도
 * 반지름 밖이라 침투가 아니지만, 네 변에 둘러싸여 어느 쪽으로도 못 나간다 — 실제로
 * 회의 테이블 위에서 시작해 갇혔다.
 */
function insideFurniture(x: number, y: number, polygons: [number, number][][]): boolean {
  return polygons.some((points) => pointInPolygon([x, y], points));
}

export function walkSpawn(scene: Scene, levelId: string, radius: number): [number, number] {
  const room = ensureRoom(scene.room);
  const levels = levelsOf(room);
  const blockers = walkBlockers(scene, levelId);

  const centerX = room.dimensions.width / 2;
  const centerY = room.dimensions.length / 2;

  let spawnX = centerX;
  let spawnY = centerY;

  let widest = 0;
  for (const area of room.areas ?? []) {
    if (levelIdOf(area, levels) !== levelId) continue;
    if (area.points.length < 3) continue;

    const size = polygonArea(area.points);
    if (size <= widest) continue;

    widest = size;
    const [cx, cy] = polygonCentroid(area.points);
    spawnX = cx;
    spawnY = cy;
  }

  const furniture = furniturePolygons(blockers);

  /** 설 수 있는 자리인가 — 벽·가구에서 떨어져 있고, 가구 안도 아니어야 한다 */
  const standable = (x: number, y: number): boolean =>
    !insideFurniture(x, y, furniture) && pushOut(x, y, radius, blockers, x, y);

  // 무게중심이 벽 안에 박혀 있거나 가구 위일 수 있다
  if (standable(spawnX, spawnY)) {
    return [outX, outY];
  }

  /*
   * 안 풀렸다 — 옆자리를 몇 군데 짚어 본다.
   *
   * 밀어내기는 작은 가구 **한가운데**에서 무력하다. 네 변이 각자 반대 방향으로 밀어
   * 서로 상쇄되기 때문이다. 400mm 짜리 협탁 한가운데에 서면 어느 쪽으로도 안 밀린다.
   * (시험이 이걸 잡았다. 그전에는 밀어내기가 늘 되는 줄 알았다.)
   *
   * 대칭이 깨지는 자리를 찾으면 그때부터는 정상적으로 밀린다. 그래서 조금씩 벌려 가며
   * 여덟 방향을 짚어 본다 — 첫 번째로 풀리는 자리가 답이다.
   */
  const ring = [radius, radius * 2, radius * 4, radius * 8];

  for (const distance of ring) {
    for (let step = 0; step < 8; step += 1) {
      const angle = (Math.PI * 2 * step) / 8;
      const px = spawnX + Math.cos(angle) * distance;
      const py = spawnY + Math.sin(angle) * distance;

      // 방 밖은 후보가 아니다
      if (px < 0 || py < 0 || px > room.dimensions.width || py > room.dimensions.length) continue;
      if (standable(px, py)) return [outX, outY];
    }
  }

  // 방 한가운데도 짚어 본다
  if (standable(centerX, centerY)) {
    return [outX, outY];
  }

  /*
   * 어디에도 설 자리가 없다.
   *
   * 가구가 방을 통째로 덮은 도면에서 그렇다. 여기서 포기하면 가구 속에 파묻힌 채
   * 시작한다. 가구를 빼고 벽만으로 세운다 — 가구를 뚫고 선 것은 한 걸음이면 풀리지만
   * 벽을 뚫고 선 것은 풀 방법이 없다.
   */
  const wallsOnly = blockers.filter((item) => item.source === "wall");
  console.warn("[walk] 설 자리를 찾지 못해 가구를 빼고 세웁니다.");

  pushOut(centerX, centerY, radius, wallsOnly, centerX, centerY);
  return [outX, outY];
}

/**
 * 이 점이 속한 실의 이름. 없으면 null.
 *
 * 실이 겹쳐 있으면 좁은 쪽을 고른다 — 거실 폴리곤 안에 주방이 따로 그려진 경우,
 * 주방에 서 있는 사람에게 "거실"이라고 알려 주면 안 된다.
 *
 * 화면 우상단의 "현재 실" 표시에 쓴다. 매 프레임이 아니라 200ms 마다 부르므로
 * 폴리곤을 하나씩 훑어도 충분히 싸다.
 */
export function roomNameAt(
  scene: Scene,
  levelId: string,
  point: [number, number]
): string | null {
  const room = ensureRoom(scene.room);
  const levels = levelsOf(room);

  let name: string | null = null;
  let smallest = Infinity;

  for (const area of room.areas ?? []) {
    if (levelIdOf(area, levels) !== levelId) continue;
    if (area.points.length < 3) continue;
    if (!pointInPolygon(point, area.points)) continue;

    const size = polygonArea(area.points);
    if (size < smallest) {
      smallest = size;
      name = area.name;
    }
  }

  return name;
}

/**
 * 시작할 때 바라볼 방향 — **평면 좌표계의 라디안** 이다.
 *
 * `atan2(dy, dx)` 이므로 0 은 +x(도면 오른쪽), π/2 는 +y(도면 위쪽)를 뜻한다.
 * 3D 의 yaw 로 옮기는 일은 여기서 하지 않는다 — 3D 는 y 가 뒤집히고 회전 방향도
 * 반대라, 그 변환을 두 군데에 두면 반드시 어긋난다.
 *
 * 방 한가운데를 바라보게 한다. 벽을 마주 보고 시작하면 아무것도 안 보인다.
 * 시작 자리가 이미 방 한가운데면 도면 위쪽을 본다.
 */
export function initialYaw(
  scene: Scene,
  levelId: string,
  spawn: [number, number]
): number {
  void levelId;

  const room = ensureRoom(scene.room);
  const dx = room.dimensions.width / 2 - spawn[0];
  const dy = room.dimensions.length / 2 - spawn[1];

  // 방 한가운데에서 시작했다 — 바라볼 곳이 없으므로 도면 위쪽을 본다
  if (Math.hypot(dx, dy) < 1) return Math.PI / 2;

  return Math.atan2(dy, dx);
}
