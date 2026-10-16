/**
 * 올라온 그림이 사진인가 도면인가.
 *
 * ── 왜 자동으로 가려야 하나 ──
 *
 * 사진과 도면은 분석 경로가 통째로 다르다. 도면은 치수 체인을 읽어 격자를 세우고,
 * 사진은 원근에서 치수를 역산한다. 프롬프트도 "이 실내 사진을 보고 평면도를 복원한다"
 * 와 "이 평면도를 도면 데이터로 옮긴다" 로 정반대다.
 *
 * 그런데 지금까지는 사용자가 올리기 전에 "사진 / 평면도" 를 직접 눌러 골라야 했고,
 * 기본값이 사진이었다. 실제로 박물관 평면도 한 장이 사진으로 올라가 "실내 사진에서
 * 방을 복원" 하는 경로를 탔고, 방 25개짜리 도면이 방 4개로 나왔다. 사용자는 무엇을
 * 잘못 눌렀는지 알 길이 없고, 분석 크레딧은 이미 나갔다.
 *
 * 선 도면은 사진과 통계가 확연히 다르다 — 흰 종이가 화면의 대부분이고 색이 거의 없다.
 * 그래서 그림 몇 개의 숫자만 보면 가릴 수 있다. AI 를 부르지 않으므로 돈이 안 든다.
 */

export interface ImageStats {
  /** 거의 흰색인 픽셀의 비율 (0~1) */
  nearWhiteRatio: number;
  /** 채도 평균 (0~255). 선 도면은 회색조라 0 에 가깝다 */
  meanSaturation: number;
  width: number;
  height: number;
}

export type SourceKind = "photo" | "floorplan";

export interface KindVerdict {
  kind: SourceKind;
  /** 사용자가 고른 것을 덮어썼는가 */
  overrode: boolean;
  /** 왜 그렇게 봤는지 — 로그와 안내에 그대로 쓴다 */
  reason: string;
}

/**
 * 도면으로 보는 기준.
 *
 * 흰 바탕이 절반을 넘고 색이 거의 없으면 선 도면이다. 사진은 아무리 밝아도 벽·바닥·
 * 가구의 색이 있어 채도가 이만큼 낮게 나오지 않는다.
 *
 * 흑백으로 찍은 실내 사진이 걸릴 수 있지만, 그때도 흰 바탕 비율에서 걸러진다 —
 * 사진은 화면 전체가 무언가로 차 있어 흰 픽셀이 절반을 넘지 않는다.
 */
const DRAWING = { nearWhite: 0.5, saturation: 26 };

/**
 * 그림을 보고 종류를 정한다.
 *
 * 사용자가 고른 값보다 그림이 우선이다 — 잘못 고르면 분석이 통째로 헛돈다.
 * 다만 **도면 쪽으로만** 덮어쓴다. "도면이라고 골랐는데 사진처럼 보인다" 는 경우는
 * 어두운 데서 찍은 도면 사진일 수 있어 사용자 말을 따른다.
 */
export function classifyImage(stats: ImageStats, chosen: SourceKind): KindVerdict {
  const looksDrawn =
    stats.nearWhiteRatio >= DRAWING.nearWhite && stats.meanSaturation <= DRAWING.saturation;

  if (chosen === "floorplan") {
    return { kind: "floorplan", overrode: false, reason: "사용자가 도면으로 올렸습니다." };
  }

  if (!looksDrawn) {
    return { kind: "photo", overrode: false, reason: "사진으로 봅니다." };
  }

  return {
    kind: "floorplan",
    overrode: true,
    reason:
      `흰 바탕 ${Math.round(stats.nearWhiteRatio * 100)}% · 채도 ${Math.round(stats.meanSaturation)} — ` +
      "선 도면으로 보고 도면 경로로 분석합니다.",
  };
}

/**
 * 도면을 읽을 만한 해상도인가.
 *
 * ── 왜 더 이상 사용자에게 떠넘기지 않나 ──
 *
 * 한때 "가로 2000px 이상으로 다시 올려 주세요" 라고 띄웠다. 틀린 대응이었다.
 * 사용자는 손에 있는 파일을 올릴 뿐이고, 화면을 캡처한 그림밖에 없는 경우도 많다.
 * 못 읽는 것은 우리 문제지 사용자 문제가 아니다.
 *
 * 그래서 읽는 쪽을 고쳤다 — 지금은 파서가 좌표를 그대로 읽으므로 해상도에 걸리지 않는다.
 * 모델은 그림을 768×768 타일로 잘라 타일마다 같은 크기의 정보로 보므로, 조각을
 * 보내면 그 조각이 타일 하나를 통째로 차지해 같은 글자가 몇 배 커진다. 원본 픽셀이
 * 작아도 통한다.
 *
 * 이 함수는 이제 **로그에만** 남긴다. 사용자에게 띄우지 않는다 — 우리가 얼마나
 * 불리한 조건에서 읽었는지는 나중에 결과를 따질 때 알아야 할 값이지, 사용자가
 * 지금 알아야 할 값이 아니다.
 */
export function drawingReadability(image: { width: number; height: number }): string | null {
  const longest = Math.max(image.width, image.height);
  if (longest <= 0 || longest >= 1600) return null;

  return `원본이 ${image.width}×${image.height}px 로 작습니다 — 조각내 읽습니다.`;
}
