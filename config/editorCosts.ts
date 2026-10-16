/**
 * 편집기에서 AI를 쓸 때 드는 크레딧.
 *
 * 서버(`src/lib/credits.ts`)와 화면이 같은 표를 봐야 한다. 서버 파일은 Supabase 를
 * 물고 있어 브라우저에서 불러올 수 없으므로, 숫자만 여기 떼어 두고 양쪽이 가져간다.
 * 두 군데에 적어 두면 "3개 든다"고 물어보고 5개가 빠지는 일이 반드시 생긴다.
 *
 * 값은 실제로 나가는 API 비용의 대략적인 비율이다. 도면 분석은 vision 두 번,
 * 실사 렌더는 이미지 생성 한 번, 가구 만들기도 이미지 생성 한 번이다.
 * AI 명령은 텍스트라 훨씬 싸지만, 공짜로 두면 무한히 부를 수 있어 1을 매긴다.
 *
 *
 * 도면을 읽는 일(DXF 파싱·벡터화)에는 크레딧을 매기지 않는다. 우리 서비스가 계산으로
 * 하는 일이고 모델을 부르지 않는다 — 래스터 경로의 라벨러만 모델을 쓰는데, 그건 방
 * 이름을 붙이는 짧은 호출이라 들여오기 한 번에 포함으로 본다.
 */
export const EDITOR_COST = {
  /** 미리보기 렌더 */
  renderPreview: 1,
  /** 최종 실사 렌더 */
  renderFinal: 2,
  /** 설명으로 가구 만들기 (이미지 생성) */
  generateAsset: 1,
  /** AI 명령 (텍스트) */
  command: 1,
} as const;

export interface EditorCharge {
  /** 이 작업에 드는 크레딧 */
  cost: number;
  /** 확인 창에 띄울 작업 이름 */
  label: string;
}

/**
 * 편집기가 부르는 경로 → 얼마가 드는 무슨 작업인가.
 *
 * 크레딧이 나가는 길은 전부 store 의 startJob 을 지난다. 그래서 이 함수 하나로
 * 리본·좌측 패널·속성 패널·온보딩이 한꺼번에 덮인다 — 버튼마다 확인 창을 달면
 * 새 버튼이 생길 때마다 빠뜨린다.
 *
 * 아는 경로가 아니면 0 을 돌려준다. 돈이 안 드는 일을 물어보면 성가시기만 하다.
 */
export function chargeForJob(path: string): EditorCharge {
  if (path.startsWith("/render/final")) {
    return { cost: EDITOR_COST.renderFinal, label: "실사 렌더" };
  }
  if (path.startsWith("/render")) {
    return { cost: EDITOR_COST.renderPreview, label: "미리보기 렌더" };
  }
  if (path.startsWith("/generate-asset")) {
    return { cost: EDITOR_COST.generateAsset, label: "가구 만들기" };
  }
  if (path.startsWith("/generate")) {
    return { cost: EDITOR_COST.generateAsset, label: "이미지 생성" };
  }

  return { cost: 0, label: "" };
}

/** AI 명령은 경로가 아니라 따로 부르므로 여기서 짝을 맞춰 둔다 */
export const COMMAND_CHARGE: EditorCharge = {
  cost: EDITOR_COST.command,
  label: "AI 명령",
};
