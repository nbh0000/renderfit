import { getMode, STRUCTURE_LOCK } from "@/config/modes";
import { getRoom } from "@/config/rooms";
import { getStyle } from "@/config/styles";
import { RESOLUTION_MAP } from "@/config/plans";
import { buildSpaceFragment, describeSpaceSize, sizeFromText } from "./space";
import type { GenerationSettings, MaterialSpec } from "./types";

/**
 * 재질 지정 입력을 프롬프트 문장으로 병합한다.
 * 비어 있으면 빈 문자열을 반환해 템플릿에서 자연스럽게 빠진다.
 */
export function buildMaterialsFragment(materials: MaterialSpec): string {
  const parts: string[] = [];
  if (materials.floor.trim()) parts.push(`바닥 마감은 ${materials.floor.trim()}으로 한다.`);
  if (materials.wall.trim()) parts.push(`벽 마감은 ${materials.wall.trim()}으로 한다.`);
  if (materials.accent.trim()) parts.push(`포인트 요소는 ${materials.accent.trim()}으로 한다.`);
  if (parts.length === 0) return "";
  return `지정된 마감재를 반드시 반영한다. ${parts.join(" ")}`;
}

/** 보존 마스킹이 있을 때 덧붙는 지시문 */
export const MASK_INSTRUCTION =
  "함께 전달된 흑백 마스크 이미지에서 흰색으로 칠해진 영역은 원본 픽셀을 그대로 보존하고 절대 변경하지 않는다. 검은색 영역만 편집한다.";

/**
 * 모드 템플릿 + 방/스타일/재질/해상도를 합쳐 최종 프롬프트를 만든다.
 * 하드코딩된 프롬프트 문장은 config/modes.ts 밖에 두지 않는다.
 */
export function buildPrompt(settings: GenerationSettings): string {
  const mode = getMode(settings.modeId);
  const room = getRoom(settings.roomId);
  const style = getStyle(settings.styleId);
  if (!mode || !room || !style) {
    throw new Error("알 수 없는 모드/방/스타일 조합입니다.");
  }

  const resolution = RESOLUTION_MAP[settings.resolution];

  const filled = mode.promptTemplate
    .replaceAll("{{structureLock}}", STRUCTURE_LOCK)
    .replaceAll("{{room}}", room.promptFragment)
    .replaceAll("{{style}}", style.label)
    .replaceAll("{{styleFragment}}", style.promptFragment)
    .replaceAll("{{materials}}", buildMaterialsFragment(settings.materials));

  const lines = filled
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  /*
   * 공간 크기는 가구를 새로 놓는 모드에서만 의미가 있다.
   *
   * "공간 비우기"에 이 문단을 붙이면 "가구를 모두 제거한다"와
   * "공간이 비어 보이지 않게 채운다"가 한 프롬프트 안에서 충돌한다.
   */
  /*
   * 직접 지시에 평수가 적혀 있으면 그쪽을 쓴다.
   *
   * "8평에 맞게 해줘"라고 써 놓고 공간 크기 입력은 45평이 남아 있는 경우가 많다.
   * 그대로 두면 한 프롬프트에 45평과 8평이 같이 들어가 모델이 어느 쪽도 못 따른다.
   * 방금 쓴 문장이 최신 의도라고 보고 그 값을 채택하되, 무엇을 골랐는지 밝혀 둔다.
   */
  const written = sizeFromText(settings.customPrompt);
  const effectiveSize = written ?? settings.size;

  const space = mode.placesFurniture ? buildSpaceFragment(effectiveSize) : "";
  if (space) lines.push(...space.split("\n"));

  if (written && settings.size) {
    lines.push(
      `요청 문장에 적힌 ${describeSpaceSize(written)}을(를) 기준으로 한다. 다른 면적이 언급되더라도 이 값을 따른다.`
    );
  }

  /*
   * 사용자가 직접 쓴 요청은 맨 앞(구조 보존 원칙 바로 다음)에 놓는다.
   *
   * 뒤에 붙이면 앞에서 여러 줄에 걸쳐 반복된 방 종류·스타일 지시에 묻힌다.
   * "여기는 매장이다"라고 써도 앞줄의 "대상 공간: 아파트 거실"이 이겨서
   * 거실 가구가 나오던 문제가 있었다. 우선순위를 문장으로 못박는다.
   */
  const custom = settings.customPrompt?.trim();
  if (custom) {
    lines.splice(
      1,
      0,
      "아래 사용자 요청은 이 작업에서 가장 중요한 조건이다. 스타일·가구의 기본 제안과 충돌하면 사용자 요청을 따른다.",
      `사용자 요청: ${custom}`,
      "사용자 요청에 공간의 용도나 종류(원룸, 매장, 사무실, 작업실, 아이 방 등)가 적혀 있으면 아래 '대상 공간' 기본값 대신 그 쪽을 따라 가구와 집기를 배치한다.",
      "단, 벽·창문·문·천장의 구조와 카메라 앵글만은 사용자 요청보다 구조 보존 원칙이 우선한다."
    );
  }

  if (settings.useMask) lines.push(MASK_INSTRUCTION);

  // 프롬프트가 길어질수록 앞뒤가 묻힌다. 꼭 지켜야 할 두 가지는 마지막에 한 번 더 못박는다.
  lines.push(`마지막으로 다시 확인한다. ${STRUCTURE_LOCK} 방의 크기와 형태도 원본 그대로다.`);
  if (custom) lines.push(`그리고 사용자 요청 "${custom}"이(가) 결과에 분명히 드러나야 한다.`);
  lines.push(`출력 해상도는 긴 변 기준 ${resolution.px}px 이상으로 한다.`);

  return lines.join("\n");
}

export { FLOORPLAN_DISCLAIMER, FLOORPLAN_PROMPT_TEMPLATE } from "@/config/modes";

/**
 * 저장된 프롬프트에서 사용자가 직접 쓴 요청만 뽑아낸다.
 *
 * 사용자 입력을 따로 컬럼에 담아 두지 않았지만, buildPrompt가 "사용자 요청: "이라는
 * 고정된 머리말로 넣기 때문에 프롬프트 문자열에서 되찾을 수 있다.
 * 이렇게 하면 마이그레이션 없이 예전 작업에서도 보인다.
 */
export function extractUserRequest(prompt: string | null | undefined): string | null {
  if (!prompt) return null;

  for (const marker of ["사용자 요청: ", "추가 요청: "]) {
    const line = prompt.split("\n").find((item) => item.startsWith(marker));
    if (line) {
      const text = line.slice(marker.length).trim();
      if (text) return text;
    }
  }

  return null;
}
