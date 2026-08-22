import type { PlanId } from "./plans";

export type ModeId =
  | "redesign"
  | "keep-style"
  | "staging"
  | "empty";

/**
 * 업로드 입력의 성격 — 업로더 안내 문구에 쓴다.
 *
 * 스튜디오는 사진만 받는다.
 *
 * 스케치·평면도 모드는 AI가 그림을 보고 투시도를 "그려 주는" 것이라 치수가 보장되지 않았다.
 * 도면에서 실제 치수대로 세우는 일은 편집기(도면 → 벽·개구부 → 3D)가 맡는다.
 */
export type InputType = "photo";

export interface Mode {
  id: ModeId;
  label: string;
  description: string;
  inputType: InputType;
  /**
   * 프롬프트 템플릿. 다음 토큰이 치환된다.
   * {{structureLock}} {{room}} {{style}} {{styleFragment}} {{materials}} {{resolution}}
   */
  promptTemplate: string;
  requiredPlan: PlanId;
  /**
   * 가구를 새로 놓는 모드인지.
   * false인 모드(화질 개선, 공간 비우기)에 평수 지시를 붙이면
   * "가구를 모두 제거한다"와 "면적에 맞게 채운다"가 정면으로 충돌한다.
   */
  placesFurniture: boolean;
  /** 스타일 선택이 프롬프트에 반영되는 모드인지 ({{style}} 사용 여부와 일치해야 한다) */
  usesStyle: boolean;
}

/**
 * 모든 모드에 공통으로 삽입되는 구조 보존 원칙.
 * 이 문장은 어떤 모드에서도 빠지면 안 된다.
 */
export const STRUCTURE_LOCK =
  "벽·창문·문·천장의 위치와 구조는 절대 변경하지 않는다. 원본의 카메라 앵글과 원근을 유지한다.";

export const MODES: Mode[] = [
  {
    id: "redesign",
    label: "리디자인",
    description: "사진 속 공간의 구조는 그대로 두고 가구와 스타일만 새로 제안합니다.",
    inputType: "photo",
    promptTemplate: [
      "{{structureLock}}",
      "대상 공간: {{room}}",
      "입력 사진의 이 공간을 {{style}} 스타일로 리디자인한다.",
      "{{styleFragment}}",
      "가구, 조명, 러그, 소품, 커튼, 컬러 팔레트는 자유롭게 교체할 수 있다.",
      "붙박이 구조물(창틀, 문틀, 기둥, 천장 몰딩)의 형태와 위치는 원본 그대로 유지한다.",
      "{{materials}}",
      "결과물은 실제 촬영한 인테리어 사진처럼 자연스러운 광원과 그림자를 가진 포토리얼 이미지여야 한다.",
    ].join("\n"),
    requiredPlan: "free",
    placesFurniture: true,
    usesStyle: true,
  },
  {
    id: "keep-style",
    label: "화질·조명 개선",
    description: "지금 스타일과 가구는 그대로 두고 화질과 조명만 전문 촬영본처럼 다듬습니다.",
    inputType: "photo",
    promptTemplate: [
      "{{structureLock}}",
      "대상 공간: {{room}}",
      "입력 사진에서 기존 가구, 배치, 마감재, 스타일을 절대 바꾸지 않는다.",
      "오직 화질, 노출, 화이트밸런스, 조명의 균형, 선명도만 개선한다.",
      "새로운 오브젝트를 추가하거나 기존 오브젝트를 제거하지 않는다.",
      "{{materials}}",
      "부동산 매물 촬영 전문가가 찍은 사진처럼 밝고 깨끗한 톤으로 마무리한다.",
    ].join("\n"),
    requiredPlan: "free",
    placesFurniture: false,
    usesStyle: false,
  },
  {
    id: "staging",
    label: "가상 스테이징",
    description: "빈 방 사진에 가구를 채워 실제로 살고 있는 공간처럼 연출합니다.",
    inputType: "photo",
    promptTemplate: [
      "{{structureLock}}",
      "대상 공간: {{room}}",
      "입력 사진은 가구가 없는 빈 상태다.",
      "이 공간에 {{style}} 스타일의 가구와 소품을 배치해 실제 사용 중인 공간처럼 연출한다.",
      "{{styleFragment}}",
      "가구는 바닥 평면과 원근에 정확히 정합되도록 놓고, 벽 안쪽으로 파고들지 않게 한다.",
      "동선을 막지 않는 현실적인 가구 배치를 사용한다.",
      "{{materials}}",
      "바닥재와 벽 마감은 원본을 유지하며, 조명 방향과 그림자는 원본 광원과 일치시킨다.",
    ].join("\n"),
    requiredPlan: "free",
    placesFurniture: true,
    usesStyle: true,
  },
  {
    id: "empty",
    label: "공간 비우기",
    description: "가구와 짐을 지우고 마감재만 남은 빈 공간으로 되돌립니다.",
    inputType: "photo",
    promptTemplate: [
      "{{structureLock}}",
      "대상 공간: {{room}}",
      "입력 사진에서 가구, 가전, 러그, 커튼, 액자, 화분과 식물, 조명 기구, 생활 잡화를 모두 제거한다.",
      "제거된 자리의 바닥, 벽, 천장은 주변 마감재를 자연스럽게 이어 붙여 복원한다.",
      "붙박이장, 싱크대, 욕실 위생도기처럼 구조에 고정된 요소는 남긴다.",
      "{{materials}}",
      "사람이 살지 않는 깨끗한 공실 상태의 사진으로 마무리한다.",
    ].join("\n"),
    requiredPlan: "free",
    placesFurniture: false,
    usesStyle: false,
  },
];

/* ─────────────────── 참고용 배치도 (모드 목록에는 넣지 않는다) ─────────────────── */

/**
 * 결과 이미지 위/아래와 다운로드 파일에 반드시 고정으로 붙는 고지 문구.
 * 이 문구 없이 배치도를 노출하거나 내려받게 해서는 안 된다.
 */
export const FLOORPLAN_DISCLAIMER =
  "AI 추정 배치도 — 실제 치수와 다를 수 있으며 시공용 도면이 아닙니다.";

/** 생성된 시안을 입력으로 받아 탑뷰 배치도 1장을 만드는 프롬프트 */
export const FLOORPLAN_PROMPT_TEMPLATE = [
  "입력 이미지는 완성된 실내 인테리어 시안이다.",
  "이 시안에 보이는 가구 배치를 위에서 내려다본 탑뷰 배치도 한 장으로 그린다.",
  "벽과 개구부의 상대적인 위치, 가구의 종류와 배치 관계를 시안과 동일하게 유지한다.",
  "선과 면으로 단순화한 평면 다이어그램 스타일로 그린다. 원근이나 입체 표현은 쓰지 않는다.",
  "가구에는 한국어로 짧은 이름만 표기한다.",
  "치수, 길이, 면적, 축척, 숫자 표기는 어떤 형태로도 넣지 않는다.",
  "도면 기호(치수선, 지시선, 그리드, 스케일 바)도 넣지 않는다.",
  "배경은 흰색, 선은 짙은 회색으로 한다.",
].join("\n");

export const MODE_MAP: Record<ModeId, Mode> = Object.fromEntries(
  MODES.map((m) => [m.id, m])
) as Record<ModeId, Mode>;

export function getMode(id: string): Mode | undefined {
  return MODE_MAP[id as ModeId];
}
