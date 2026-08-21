"use client";

/**
 * 편집기 아이콘.
 *
 * 리본 버튼은 손이 자주 가는 자리라, 글자만 있으면 매번 읽어야 한다.
 * 도형으로 먼저 알아보고 글자로 확인하는 게 빠르다.
 *
 * 외부 아이콘 패키지를 붙이지 않고 필요한 것만 직접 그린다 — 20개 남짓이라
 * 의존성을 늘릴 이유가 없고, 선 굵기를 도면 느낌에 맞출 수 있다.
 */

export type IconName =
  | "save"
  | "export"
  | "wall"
  | "room"
  | "polyline"
  | "arrange"
  | "undo"
  | "redo"
  | "select"
  | "dimension"
  | "text"
  | "image"
  | "plan"
  | "elevation"
  | "cube"
  | "split"
  | "grid"
  | "preview"
  | "render";

const PATHS: Record<IconName, React.ReactNode> = {
  save: (
    <>
      <path d="M3 3h8l2 2v8H3z" />
      <path d="M5 3v4h5V3" />
    </>
  ),
  export: (
    <>
      <path d="M8 2v8" />
      <path d="M5 6l3-4 3 4" />
      <path d="M3 11v2h10v-2" />
    </>
  ),
  wall: (
    <>
      <path d="M2 5h12" />
      <path d="M2 11h12" />
      <path d="M2 5v6" />
      <path d="M14 5v6" />
    </>
  ),
  room: (
    <>
      <path d="M2 3h7l5 4v6H2z" />
    </>
  ),
  polyline: (
    <>
      <path d="M2 12l4-6 3 3 5-6" />
      <circle cx="2" cy="12" r="1.2" />
      <circle cx="14" cy="3" r="1.2" />
    </>
  ),
  arrange: (
    <>
      <rect x="2" y="2" width="5" height="5" />
      <rect x="9" y="2" width="5" height="5" />
      <rect x="2" y="9" width="12" height="5" />
    </>
  ),
  undo: (
    <>
      <path d="M6 4L3 7l3 3" />
      <path d="M3 7h6a4 4 0 010 8H6" />
    </>
  ),
  redo: (
    <>
      <path d="M10 4l3 3-3 3" />
      <path d="M13 7H7a4 4 0 000 8h3" />
    </>
  ),
  select: (
    <>
      <path d="M3 2l9 6-4 1-1 4z" />
    </>
  ),
  dimension: (
    <>
      <path d="M2 8h12" />
      <path d="M2 5v6" />
      <path d="M14 5v6" />
    </>
  ),
  text: (
    <>
      <path d="M3 4V3h10v1" />
      <path d="M8 3v10" />
      <path d="M6 13h4" />
    </>
  ),
  image: (
    <>
      <rect x="2" y="3" width="12" height="10" />
      <path d="M2 10l3-3 3 3 2-2 4 4" />
    </>
  ),
  plan: (
    <>
      <rect x="2" y="2" width="12" height="12" />
      <path d="M2 9h5V2" />
    </>
  ),
  elevation: (
    <>
      <path d="M2 13h12" />
      <path d="M3 13V5h10v8" />
      <rect x="6" y="7" width="4" height="4" />
    </>
  ),
  cube: (
    <>
      <path d="M8 2l6 3v6l-6 3-6-3V5z" />
      <path d="M2 5l6 3 6-3" />
      <path d="M8 8v6" />
    </>
  ),
  split: (
    <>
      <rect x="2" y="2" width="12" height="5" />
      <rect x="2" y="9" width="12" height="5" />
    </>
  ),
  grid: (
    <>
      <path d="M2 6h12M2 10h12M6 2v12M10 2v12" />
    </>
  ),
  preview: (
    <>
      <path d="M1 8s2.5-4 7-4 7 4 7 4-2.5 4-7 4-7-4-7-4z" />
      <circle cx="8" cy="8" r="1.8" />
    </>
  ),
  render: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.5 1.5M11 11l1.5 1.5M12.5 3.5L11 5M5 11l-1.5 1.5" />
    </>
  ),
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
