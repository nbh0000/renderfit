import type { SceneObject } from "@/scene/types";

/**
 * 평면도의 가구 기호.
 *
 * 예전에는 가구를 빈 사각형으로 그리고 그 안에 이름과 치수를 적었다. 그래서 도면을
 * 펼치면 글자만 빼곡했고, 실제 도면처럼 보이지 않았다 — 도면을 읽는 사람은 글자가
 * 아니라 모양으로 무엇인지 안다. 침대는 베개와 이불선이 있고, 변기는 변기 모양이고,
 * 식탁 의자는 등받이가 테이블을 향한다.
 *
 * 여기서는 각 가구를 자기 좌표계(가로 -0.5~0.5, 세로 -0.5~0.5)에서 그리고, 부르는
 * 쪽이 실제 크기와 회전으로 옮긴다. 그래야 침대가 커지든 작아지든 같은 모양이 된다.
 */

/** 자기 좌표계에서 그린 선들 — 부르는 쪽이 크기·회전을 입힌다 */
export interface Symbol {
  /** 바깥 윤곽 (없으면 사각형) */
  outline?: string;
  /** 안쪽 선들 */
  detail: string;
}

/** 0~1 비율을 -0.5~0.5 좌표로 */
const u = (value: number) => (value - 0.5).toFixed(4);

/** 사각형 하나 */
function rect(x: number, y: number, w: number, h: number, radius = 0): string {
  return `<rect x="${u(x)}" y="${u(y)}" width="${w.toFixed(4)}" height="${h.toFixed(4)}"${
    radius ? ` rx="${radius.toFixed(4)}"` : ""
  }/>`;
}

/** 타원 하나 */
function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `<ellipse cx="${u(cx)}" cy="${u(cy)}" rx="${rx.toFixed(4)}" ry="${ry.toFixed(4)}"/>`;
}

function line(x1: number, y1: number, x2: number, y2: number): string {
  return `<line x1="${u(x1)}" y1="${u(y1)}" x2="${u(x2)}" y2="${u(y2)}"/>`;
}

/*
 * 가구 좌표계는 "위쪽(y=0)이 가구의 뒤"다.
 *
 * 회전 0도는 정면이 도면 아래를 보는 상태이므로(scene/placement의 규칙과 같다),
 * 침대 머리판과 소파 등받이는 y=0 쪽에 온다.
 */

/** 침대 — 머리판, 베개 둘, 걷어 놓은 이불선 */
function bed(): Symbol {
  return {
    detail: [
      rect(0, 0, 1, 0.1), // 머리판
      rect(0.06, 0.12, 0.38, 0.2, 0.03), // 왼쪽 베개
      rect(0.56, 0.12, 0.38, 0.2, 0.03), // 오른쪽 베개
      line(0, 0.62, 1, 0.62), // 이불 접힌 선
      line(0, 0.68, 1, 0.68),
    ].join(""),
  };
}

/** 1인용 — 베개 하나 */
function singleBed(): Symbol {
  return {
    detail: [
      rect(0, 0, 1, 0.1),
      rect(0.2, 0.12, 0.6, 0.2, 0.03),
      line(0, 0.62, 1, 0.62),
      line(0, 0.68, 1, 0.68),
    ].join(""),
  };
}

/** 소파 — 등받이, 팔걸이 둘, 방석 나눔 */
function sofa(seats: number): Symbol {
  const cushions: string[] = [];
  for (let i = 1; i < seats; i += 1) {
    const x = 0.12 + ((1 - 0.24) * i) / seats;
    cushions.push(line(x, 0.22, x, 0.92));
  }

  return {
    detail: [
      rect(0, 0, 1, 0.22, 0.03), // 등받이
      rect(0, 0.18, 0.12, 0.82, 0.03), // 왼쪽 팔걸이
      rect(0.88, 0.18, 0.12, 0.82, 0.03), // 오른쪽 팔걸이
      ...cushions,
    ].join(""),
  };
}

/** 의자 — 등받이가 위(테이블 쪽) */
function chair(): Symbol {
  return {
    outline: `<rect x="${u(0.08)}" y="${u(0.14)}" width="0.84" height="0.8" rx="0.06"/>`,
    detail: rect(0.02, 0, 0.96, 0.14, 0.04),
  };
}

/** 변기 — 물탱크와 좌대 */
function toilet(): Symbol {
  return {
    outline: "",
    detail: [
      rect(0.12, 0, 0.76, 0.24, 0.02), // 물탱크
      ellipse(0.5, 0.62, 0.34, 0.34), // 좌대
      ellipse(0.5, 0.62, 0.22, 0.22),
    ].join(""),
  };
}

/** 세면대 — 볼과 수전 */
function basin(): Symbol {
  return {
    detail: [ellipse(0.5, 0.55, 0.34, 0.28), ellipse(0.5, 0.16, 0.06, 0.06)].join(""),
  };
}

/** 욕조 — 안쪽 선과 배수구 */
function bathtub(): Symbol {
  return {
    detail: [rect(0.06, 0.06, 0.88, 0.88, 0.06), ellipse(0.5, 0.86, 0.05, 0.05)].join(""),
  };
}

/** 샤워부스 — 대각선과 배수구 */
function shower(): Symbol {
  return {
    detail: [line(0, 0, 1, 1), line(1, 0, 0, 1), ellipse(0.5, 0.5, 0.06, 0.06)].join(""),
  };
}

/** 싱크대 — 개수통과 수전 */
function sink(): Symbol {
  return {
    detail: [rect(0.12, 0.22, 0.5, 0.56, 0.03), ellipse(0.8, 0.2, 0.06, 0.06)].join(""),
  };
}

/** 가스레인지 — 화구 넷 */
function cooktop(): Symbol {
  return {
    detail: [
      ellipse(0.28, 0.28, 0.16, 0.16),
      ellipse(0.72, 0.28, 0.16, 0.16),
      ellipse(0.28, 0.72, 0.13, 0.13),
      ellipse(0.72, 0.72, 0.13, 0.13),
    ].join(""),
  };
}

/** 냉장고 — 문 나눔선과 손잡이 */
function fridge(): Symbol {
  return {
    detail: [line(0.5, 0, 0.5, 1), line(0.44, 0.3, 0.44, 0.6), line(0.56, 0.3, 0.56, 0.6)].join(""),
  };
}

/** 세탁기 — 원형 도어 */
function washer(): Symbol {
  return {
    detail: [ellipse(0.5, 0.55, 0.32, 0.32), rect(0.1, 0.06, 0.8, 0.14)].join(""),
  };
}

/** 옷장·수납장 — 문 나눔선 */
function wardrobe(doors: number): Symbol {
  const lines: string[] = [];
  for (let i = 1; i < doors; i += 1) lines.push(line(i / doors, 0, i / doors, 1));
  return { detail: lines.join("") };
}

/** 식탁·책상 — 상판만 (다리는 평면도에서 그리지 않는다) */
function table(): Symbol {
  return { detail: rect(0.05, 0.05, 0.9, 0.9, 0.02) };
}

/** 둥근 테이블 */
function roundTable(): Symbol {
  return { outline: `<ellipse cx="0" cy="0" rx="0.5" ry="0.5"/>`, detail: "" };
}

/** 화분 — 잎 갈래 */
function plant(): Symbol {
  return {
    outline: `<ellipse cx="0" cy="0" rx="0.5" ry="0.5"/>`,
    detail: [
      line(0.5, 0.1, 0.5, 0.9),
      line(0.1, 0.5, 0.9, 0.5),
      line(0.2, 0.2, 0.8, 0.8),
      line(0.8, 0.2, 0.2, 0.8),
    ].join(""),
  };
}

/** 러그 — 테두리 안쪽 선 */
function rug(): Symbol {
  return { detail: rect(0.06, 0.06, 0.88, 0.88) };
}

/** TV — 화면 선 */
function tv(): Symbol {
  return { detail: line(0.05, 0.5, 0.95, 0.5) };
}

/** 이름에서 더 정확한 기호를 고른다 — 도면의 글자가 종류보다 구체적일 때가 많다 */
const BY_NAME: { match: RegExp; symbol: () => Symbol }[] = [
  { match: /변기|양변기/, symbol: toilet },
  { match: /세면대|세면기/, symbol: basin },
  { match: /욕조/, symbol: bathtub },
  { match: /샤워/, symbol: shower },
  { match: /싱크|개수/, symbol: sink },
  { match: /레인지|쿡탑|인덕션|가스/, symbol: cooktop },
  { match: /냉장고/, symbol: fridge },
  { match: /세탁기|건조기/, symbol: washer },
  { match: /붙박이장|옷장|드레스|수납장|신발장/, symbol: () => wardrobe(3) },
  { match: /거실장|tv\s*장/i, symbol: () => wardrobe(2) },
  { match: /1\s*인\s*소파|암체어/, symbol: () => sofa(1) },
  { match: /2\s*인\s*소파/, symbol: () => sofa(2) },
  { match: /코너|ㄱ자|4\s*인\s*소파/, symbol: () => sofa(4) },
  { match: /소파/, symbol: () => sofa(3) },
  { match: /싱글|1\s*인용\s*침대/, symbol: singleBed },
  { match: /침대/, symbol: bed },
  { match: /원형\s*(식탁|테이블)/, symbol: roundTable },
  { match: /의자|체어|스툴/, symbol: chair },
  { match: /식탁|책상|테이블|데스크/, symbol: table },
];

/** 종류별 기본 기호 */
const BY_TYPE: Partial<Record<SceneObject["type"], () => Symbol>> = {
  bed,
  sofa: () => sofa(3),
  chair,
  table,
  cabinet: () => wardrobe(2),
  rug,
  tv,
  plant,
};

/**
 * 이 가구를 어떤 기호로 그릴지 고른다.
 *
 * 이름이 종류보다 구체적이므로 이름을 먼저 본다 — 종류가 appliance 여도 이름이
 * "변기"면 변기 모양으로 그려야 도면이 읽힌다.
 */
export function symbolFor(object: { name: string; type: SceneObject["type"] }): Symbol | null {
  const named = BY_NAME.find((rule) => rule.match.test(object.name));
  if (named) return named.symbol();

  const typed = BY_TYPE[object.type];
  return typed ? typed() : null;
}
