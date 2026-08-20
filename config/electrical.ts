import type { ElectricalKind } from "@/scene/types";

/**
 * 전기·통신 설비 기본값.
 *
 * 설치 높이는 국내 공동주택에서 통용되는 값을 기준으로 한다.
 * 도면 기호는 KS C 0301(전기 제도 통칙) 계열을 단순화해 쓴다.
 */
export interface ElectricalSpec {
  kind: ElectricalKind;
  label: string;
  /** 바닥에서의 기본 설치 높이 (mm) */
  defaultHeight: number;
  /** 평면도 도면 레이어 */
  layer: string;
  /** 평면도에 찍는 짧은 기호 문자 */
  symbol: string;
  /** 목록 설명 */
  note: string;
}

export const ELECTRICAL_SPECS: ElectricalSpec[] = [
  {
    kind: "outlet",
    label: "콘센트",
    defaultHeight: 300,
    layer: "E-POWR",
    symbol: "C",
    note: "일반 2구 콘센트. 바닥에서 300mm.",
  },
  {
    kind: "outlet-aircon",
    label: "에어컨 콘센트",
    defaultHeight: 2000,
    layer: "E-POWR",
    symbol: "AC",
    note: "벽걸이 에어컨 전용. 바닥에서 2000mm, 전용 회로.",
  },
  {
    kind: "switch",
    label: "스위치",
    defaultHeight: 1200,
    layer: "E-LITE",
    symbol: "S",
    note: "일반 점멸기. 바닥에서 1200mm.",
  },
  {
    kind: "switch-3way",
    label: "3로 스위치",
    defaultHeight: 1200,
    layer: "E-LITE",
    symbol: "S3",
    note: "두 곳에서 켜고 끄는 스위치.",
  },
  {
    kind: "ceiling-light",
    label: "천장 조명",
    defaultHeight: 2400,
    layer: "E-LITE",
    symbol: "L",
    note: "천장 매입·직부 조명.",
  },
  {
    kind: "wall-light",
    label: "벽 조명",
    defaultHeight: 1800,
    layer: "E-LITE",
    symbol: "WL",
    note: "브라켓·간접 조명.",
  },
  {
    kind: "data",
    label: "인터넷",
    defaultHeight: 300,
    layer: "E-COMM",
    symbol: "N",
    note: "랜 아울렛.",
  },
  {
    kind: "tv-jack",
    label: "TV 단자",
    defaultHeight: 300,
    layer: "E-COMM",
    symbol: "TV",
    note: "동축 단자. 벽걸이 TV면 900~1200mm.",
  },
  {
    kind: "panel",
    label: "분전반",
    defaultHeight: 1800,
    layer: "E-POWR",
    symbol: "DB",
    note: "세대 분전반.",
  },
];

export const ELECTRICAL_MAP: Record<ElectricalKind, ElectricalSpec> = Object.fromEntries(
  ELECTRICAL_SPECS.map((spec) => [spec.kind, spec])
) as Record<ElectricalKind, ElectricalSpec>;

export function electricalSpec(kind: ElectricalKind): ElectricalSpec {
  return ELECTRICAL_MAP[kind] ?? ELECTRICAL_SPECS[0];
}
