import {
  DEFAULT_CEILING_MM,
  PYEONG_TO_M2,
  SPACE_LIMITS,
  SPACE_PROMPT_TEMPLATE,
} from "@/config/space";
import type { SpaceSize } from "./types";

/**
 * 공간 크기 값 처리.
 *
 * 사용자는 평수 또는 실측 치수(mm) 중 하나로 입력하고,
 * 두 경우 모두 면적(㎡)과 평수로 환산해 프롬프트와 화면 표시에 함께 쓴다.
 */

export function pyeongToM2(pyeong: number): number {
  return pyeong * PYEONG_TO_M2;
}

export function m2ToPyeong(m2: number): number {
  return m2 / PYEONG_TO_M2;
}

/** 면적(㎡). 값이 부족하면 null */
export function spaceAreaM2(size: SpaceSize): number | null {
  if (size.unit === "pyeong") {
    return size.pyeong && size.pyeong > 0 ? pyeongToM2(size.pyeong) : null;
  }
  if (size.width && size.length) return (size.width / 1000) * (size.length / 1000);
  return null;
}

/**
 * 사용자 입력(또는 API로 들어온 값)을 신뢰할 수 있는 형태로 정리한다.
 * 범위를 벗어나거나 비어 있으면 null — 크기 지정 없이 생성한다.
 */
export function normalizeSpaceSize(input: unknown): SpaceSize | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<SpaceSize>;

  const inRange = (value: unknown, min: number, max: number): number | undefined => {
    const num = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(num) || num < min || num > max) return undefined;
    return Math.round(num * 100) / 100;
  };

  if (raw.unit === "pyeong") {
    const pyeong = inRange(raw.pyeong, SPACE_LIMITS.minPyeong, SPACE_LIMITS.maxPyeong);
    if (pyeong === undefined) return null;
    const height = inRange(raw.height, SPACE_LIMITS.minHeight, SPACE_LIMITS.maxHeight);
    return { unit: "pyeong", pyeong, ...(height === undefined ? {} : { height }) };
  }

  if (raw.unit === "mm") {
    const width = inRange(raw.width, SPACE_LIMITS.minSide, SPACE_LIMITS.maxSide);
    const length = inRange(raw.length, SPACE_LIMITS.minSide, SPACE_LIMITS.maxSide);
    if (width === undefined || length === undefined) return null;
    const height = inRange(raw.height, SPACE_LIMITS.minHeight, SPACE_LIMITS.maxHeight);
    return { unit: "mm", width, length, ...(height === undefined ? {} : { height }) };
  }

  return null;
}

/** "약 24평(79.3㎡)" / "가로 3600 × 세로 4200mm (15.1㎡ · 4.6평)" */
export function describeSpaceSize(size: SpaceSize): string {
  const area = spaceAreaM2(size);
  const height = size.height ?? null;
  const heightText = height ? `, 천장 높이 ${Math.round(height)}mm` : "";

  if (size.unit === "pyeong") {
    const pyeong = size.pyeong ?? 0;
    const areaText = area ? `${area.toFixed(1)}㎡` : "";
    return `약 ${trimNumber(pyeong)}평(${areaText})${heightText}`;
  }

  const width = Math.round(size.width ?? 0);
  const length = Math.round(size.length ?? 0);
  const areaText = area ? ` (${area.toFixed(1)}㎡ · ${m2ToPyeong(area).toFixed(1)}평)` : "";
  return `가로 ${width} × 세로 ${length}mm${areaText}${heightText}`;
}

/** 화면 표시용 짧은 요약 */
export function summarizeSpaceSize(size: SpaceSize): string {
  const area = spaceAreaM2(size);
  if (!area) return "";
  return `${area.toFixed(1)}㎡ · ${m2ToPyeong(area).toFixed(1)}평`;
}

/** 프롬프트에 붙일 문단. 크기 정보가 없으면 빈 문자열 */
export function buildSpaceFragment(size: SpaceSize | null | undefined): string {
  const normalized = normalizeSpaceSize(size);
  if (!normalized) return "";
  return SPACE_PROMPT_TEMPLATE.replaceAll("{{size}}", describeSpaceSize(normalized));
}

/**
 * 평수만 받은 경우에도 도면·3D가 쓸 수 있도록 방 치수(mm)를 추정한다.
 * 실측이 아니므로 가로:세로를 4:5로 두고 면적만 맞춘다.
 */
export function toRoomDimensions(size: SpaceSize): {
  width: number;
  length: number;
  height: number;
} | null {
  const normalized = normalizeSpaceSize(size);
  if (!normalized) return null;

  const height = normalized.height ?? DEFAULT_CEILING_MM;

  if (normalized.unit === "mm") {
    return { width: normalized.width!, length: normalized.length!, height };
  }

  const area = spaceAreaM2(normalized);
  if (!area) return null;

  const width = Math.round(Math.sqrt((area * 4) / 5) * 1000);
  const length = Math.round((area * 1_000_000) / width);
  return { width, length, height };
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
