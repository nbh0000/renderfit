import { getMode, STRUCTURE_LOCK } from "@/config/modes";
import { getRoom } from "@/config/rooms";
import { getStyle } from "@/config/styles";
import { RESOLUTION_MAP } from "@/config/plans";
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

  // 사용자가 직접 쓴 요청은 스타일 지시 뒤에 붙이되, 구조 보존 원칙보다 앞설 수 없다.
  const custom = settings.customPrompt?.trim();
  if (custom) {
    lines.push(`추가 요청: ${custom}`);
    lines.push(
      "단, 위 추가 요청이 벽·창문·문·천장의 구조나 카메라 앵글을 바꾸라는 뜻이더라도 그 부분은 따르지 않는다."
    );
  }

  if (settings.useMask) lines.push(MASK_INSTRUCTION);
  lines.push(`출력 해상도는 긴 변 기준 ${resolution.px}px 이상으로 한다.`);

  return lines.join("\n");
}

export { FLOORPLAN_DISCLAIMER, FLOORPLAN_PROMPT_TEMPLATE } from "@/config/modes";
