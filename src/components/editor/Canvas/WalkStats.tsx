"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

/**
 * 걷는 중의 프레임 상태를 화면에 띄운다. 개발 모드 전용.
 *
 * 끊김은 "느낌"으로 고칠 수 없다. 평균이 12ms 인데 가끔 60ms 가 한 번 끼는 것과,
 * 평균이 25ms 로 고른 것은 원인도 대책도 다르다. 셰이더 재컴파일은 programs 수로,
 * 텍스처 업로드는 memory.textures 로, 드로우콜 폭증은 render.calls 로 드러난다 —
 * 그 숫자를 눈앞에 띄워 두면 어느 순간에 무엇이 튀는지 바로 보인다.
 *
 * 리액트 상태를 쓰지 않는다. 프레임마다 setState 하면 그 자체가 끊김의 원인이 되어
 * 재려는 것을 망가뜨린다. DOM 한 조각의 textContent 만 직접 갈아 끼운다.
 *
 * 프로덕션 번들에는 들어가지 않는다 — 부르는 쪽에서 NODE_ENV 로 가른다.
 */

/** 최근 몇 프레임을 놓고 볼지 — 2초쯤이면 순간적인 튐과 지속적인 느림이 갈린다 */
const SAMPLES = 120;

/** 화면 글자를 얼마나 자주 갈지 — 매 프레임 고치면 읽을 수가 없다 */
const REFRESH_MS = 250;

/** 60Hz 한 프레임 */
const FRAME_MS = 1000 / 60;

/** 이보다 길면 눈에 띄게 걸린다 */
const HITCH_MS = 33;

export function WalkStats() {
  const box = useRef<HTMLDivElement | null>(null);
  const samples = useRef(new Float32Array(SAMPLES));
  const cursor = useRef(0);
  const filled = useRef(0);
  const sinceRefresh = useRef(0);

  const gl = useThree((state) => state.gl);
  const dpr = useThree((state) => state.viewport.dpr);

  /* 캔버스 위에 겹쳐 띄운다 — Canvas 안이 아니라 형제로 붙는다 */
  useEffect(() => {
    const element = document.createElement("div");
    element.style.cssText = [
      "position:fixed",
      "left:8px",
      "bottom:8px",
      "z-index:50",
      "padding:6px 8px",
      "border-radius:6px",
      "background:rgba(0,0,0,0.72)",
      "color:#e8e8e8",
      "font:11px/1.45 ui-monospace,Menlo,monospace",
      "white-space:pre",
      "pointer-events:none",
    ].join(";");

    document.body.appendChild(element);
    box.current = element;

    return () => {
      element.remove();
      box.current = null;
    };
  }, []);

  useFrame((_state, delta) => {
    const ms = delta * 1000;

    samples.current[cursor.current] = ms;
    cursor.current = (cursor.current + 1) % SAMPLES;
    if (filled.current < SAMPLES) filled.current += 1;

    sinceRefresh.current += ms;
    if (sinceRefresh.current < REFRESH_MS) return;
    sinceRefresh.current = 0;

    const element = box.current;
    if (!element) return;

    let total = 0;
    let worst = 0;
    let slow = 0;
    let hitches = 0;

    for (let i = 0; i < filled.current; i += 1) {
      const value = samples.current[i];
      total += value;
      if (value > worst) worst = value;
      if (value > FRAME_MS) slow += 1;
      if (value > HITCH_MS) hitches += 1;
    }

    const average = total / Math.max(1, filled.current);
    const info = gl.info;

    element.textContent = [
      `평균 ${average.toFixed(1)}ms  최대 ${worst.toFixed(1)}ms`,
      `16.7ms 초과 ${((slow / Math.max(1, filled.current)) * 100).toFixed(0)}%  33ms 초과 ${hitches}`,
      `draw ${info.render.calls}  tri ${Math.round(info.render.triangles / 1000)}k`,
      `tex ${info.memory.textures}  geo ${info.memory.geometries}  prog ${info.programs?.length ?? 0}`,
      `dpr ${dpr.toFixed(2)}`,
    ].join("\n");
  });

  return null;
}
