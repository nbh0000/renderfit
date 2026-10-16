"use client";

import { useEffect, useState } from "react";
import type { Underlay } from "@/scene/types";
import type { ImageSize } from "@/scene/underlay";

/**
 * 평면 편집기 뒤에 깔리는 원본 도면.
 *
 * 우리가 읽어 낸 도면이 원본과 다를 때, 사용자가 눈으로 대 보고 벽을 끌어 맞출 수
 * 있어야 한다. 모든 CAD 가 스캔 도면을 이렇게 다룬다 — 뒤에 깔고, 두 점으로 축척을
 * 맞추고, 그 위에 그린다.
 *
 * 이 파일에는 그리기만 있다. 좌표 계산은 전부 scene/underlay.ts 에 있다.
 */

/**
 * 이미지가 실제로 몇 픽셀인지 알아낸다.
 *
 * 축척은 "픽셀당 몇 mm" 라서 원본 픽셀 크기를 알아야 화면에 몇 mm 로 그릴지 정해진다.
 * 업로드할 때 재어 둔 scene.source.width 가 있지만, 예전에 올린 프로젝트는 기본값
 * 1280×960 이 그대로 들어 있다. 브라우저가 실제로 읽은 값이 언제나 옳다.
 */
export function useUnderlayImage(url: string | null): ImageSize | null {
  /*
   * 어느 주소를 재고 온 값인지 함께 들고 있는다.
   *
   * 주소만 바뀌고 아직 새 이미지가 안 실렸을 때 예전 크기를 그대로 쓰면, 다른 도면의
   * 픽셀 수로 축척을 계산해 밑그림이 엉뚱한 크기로 한 번 깜빡인다.
   */
  const [loaded, setLoaded] = useState<{ url: string; size: ImageSize } | null>(null);

  useEffect(() => {
    if (!url) return;

    let alive = true;
    const image = new Image();
    image.onload = () => {
      if (alive && image.naturalWidth > 0) {
        setLoaded({ url, size: { width: image.naturalWidth, height: image.naturalHeight } });
      }
    };
    image.src = url;

    return () => {
      alive = false;
    };
  }, [url]);

  return url && loaded?.url === url ? loaded.size : null;
}

export interface UnderlayImageProps {
  url: string;
  underlay: Underlay;
  image: ImageSize;
  /** 평면 mm → 화면 px */
  toScreen: (x: number, y: number) => [number, number];
  /** 1mm 가 화면에서 차지하는 px */
  scale: number;
  /** 드래그로 잡을 수 있는 상태인지 */
  grabbable: boolean;
}

export function UnderlayImage({
  url,
  underlay,
  image,
  toScreen,
  scale,
  grabbable,
}: UnderlayImageProps) {
  /* originMm 은 이미지 왼쪽 위가 놓이는 평면 좌표다 — 화면에서도 왼쪽 위가 된다 */
  const [x, y] = toScreen(underlay.originMm[0], underlay.originMm[1]);
  const width = image.width * underlay.mmPerPixel * scale;
  const height = image.height * underlay.mmPerPixel * scale;

  if (!(width > 0) || !(height > 0)) return null;

  const degrees = (underlay.rotation * 180) / Math.PI;

  return (
    <image
      href={url}
      x={x}
      y={y}
      width={width}
      height={height}
      opacity={underlay.opacity}
      /* 기울어진 스캔은 왼쪽 위를 축으로 돌린다 — 좌표 계산과 축이 같아야 어긋나지 않는다 */
      transform={degrees ? `rotate(${degrees} ${x} ${y})` : undefined}
      /*
       * 클릭을 먹지 않는다.
       *
       * 밑그림 위에서 벽을 그리고 개구부를 찍어야 하는데, 이미지가 포인터를 가로채면
       * 그 위에서는 아무것도 그릴 수 없다. 밑그림을 끄는 드래그는 PlanEditor 가
       * "아무것도 안 잡혔을 때"의 마지막 폴백으로 처리한다.
       */
      pointerEvents="none"
      style={grabbable ? undefined : { userSelect: "none" }}
      preserveAspectRatio="none"
    />
  );
}

/** 축척을 맞추는 동안 찍은 점과 그 사이 선 */
export function CalibrationMarks({
  points,
  cursor,
  toScreen,
}: {
  points: [number, number][];
  cursor: [number, number] | null;
  toScreen: (x: number, y: number) => [number, number];
}) {
  const screen = points.map(([x, y]) => toScreen(x, y));
  const end = points.length === 1 && cursor ? toScreen(cursor[0], cursor[1]) : screen[1];

  return (
    <g pointerEvents="none">
      {screen[0] && end && (
        <line
          x1={screen[0][0]}
          y1={screen[0][1]}
          x2={end[0]}
          y2={end[1]}
          stroke="#c2410c"
          strokeWidth={1.5}
          strokeDasharray="5 3"
        />
      )}
      {screen.map(([x, y], index) => (
        <g key={index}>
          <circle cx={x} cy={y} r={5} fill="#ffffff" stroke="#c2410c" strokeWidth={2} />
          <circle cx={x} cy={y} r={1.5} fill="#c2410c" />
        </g>
      ))}
    </g>
  );
}

/** 격자선에 붙었을 때 그 선을 보여 준다 — 붙은 줄 모르면 붙는 것이 방해로만 느껴진다 */
export function SnapGuides({
  guide,
  toScreen,
  width,
  length,
}: {
  guide: { x?: number; y?: number };
  toScreen: (x: number, y: number) => [number, number];
  width: number;
  length: number;
}) {
  /* 도면 전체를 가로지르는 선이면 어느 격자선에 붙었는지 한눈에 보인다 */
  const span = Math.max(width, length) * 2;

  return (
    <g pointerEvents="none" stroke="#0f766e" strokeWidth={1} strokeDasharray="4 3">
      {guide.x !== undefined && (
        <line
          x1={toScreen(guide.x, -span)[0]}
          y1={toScreen(guide.x, -span)[1]}
          x2={toScreen(guide.x, span)[0]}
          y2={toScreen(guide.x, span)[1]}
        />
      )}
      {guide.y !== undefined && (
        <line
          x1={toScreen(-span, guide.y)[0]}
          y1={toScreen(-span, guide.y)[1]}
          x2={toScreen(span, guide.y)[0]}
          y2={toScreen(span, guide.y)[1]}
        />
      )}
    </g>
  );
}
