import type { SceneObject } from "@/scene/types";

/**
 * Gemini 호출에 공통으로 들어가는 것들.
 *
 * 원래 vision.ts 안에 있었는데, 격자 경로(gridChains·gridPlan)가 같은 설정을 쓰면서
 * vision.ts 를 다시 불러오는 순환 참조가 됐다. 순환 참조는 번들러에 따라 값이
 * undefined 로 들어와도 조용히 지나가므로 — temperature 가 빠진 채 호출되면 같은
 * 도면에서 매번 다른 답이 온다 — 아예 이 파일로 떼어 둔다.
 */

/**
 * 같은 사진에는 같은 도면이 나와야 한다.
 *
 * 기본값(temperature ~1)으로 두면 같은 사진을 두 번 분석했을 때 방 면적이
 * 60㎡와 81㎡로 갈리고 의자 수가 8개와 17개로 갈렸다. 정확도 이전에 신뢰의 문제다 —
 * 다시 눌러서 값이 바뀌면 사용자는 어느 쪽도 믿지 않는다.
 * 측량은 창작이 아니므로 무작위성을 완전히 끈다.
 */
export const DETERMINISTIC = { temperature: 0, topP: 1, seed: 7 } as const;

/** 모델이 돌려줄 수 있는 객체 종류 — Scene 타입과 1:1로 맞춘다 */
export const OBJECT_TYPES: SceneObject["type"][] = [
  "window",
  "door",
  "sofa",
  "chair",
  "table",
  "cabinet",
  "bed",
  "lamp",
  "plant",
  "rug",
  "tv",
  "appliance",
  "decoration",
];

/** 동적 import 로 불러오는 SDK 의 인스턴스 타입 */
export type GenAI = InstanceType<(typeof import("@google/genai"))["GoogleGenAI"]>;

/**
 * 다음 모델로 넘어가 봐야 소용없는 오류인지.
 *
 * 모델을 바꿔 가며 다시 부르는 것은 "이 모델이 지금 붐빈다"는 문제에만 듣는다.
 * 키가 틀렸거나 하루 한도를 넘긴 것은 프로젝트 전체의 문제라서, 모델을 바꿔도
 * 똑같이 거절당한다 — 다섯 번 거절당하고 끝날 뿐이고 콘솔에는 오류만 다섯 배로
 * 쌓인다. 그런 오류는 첫 번째에서 멈춘다.
 *
 * 호출 하나하나가 사용자 돈이라, 소용없는 재시도는 그냥 낭비다.
 */
export function isFatalApiError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /(401|403|429)|API key|API_KEY_INVALID|PERMISSION_DENIED|RESOURCE_EXHAUSTED|quota/i.test(
    text
  );
}
