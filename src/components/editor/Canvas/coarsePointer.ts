/**
 * 손가락으로 쓰는 기기인가.
 *
 * 화면 조이스틱을 띄울지, 마우스를 잠글지가 여기서 갈린다.
 *
 * `pointer: coarse` 는 주 입력이 손가락일 때 참이다. 다만 마우스와 터치를 둘 다 가진
 * 노트북에서는 거짓으로 나오므로, 손가락이 화면에 한 번이라도 닿았으면 그 뒤로는 참으로
 * 본다. 한 번 켠 조이스틱은 다시 끄지 않는다 — 마우스를 잠깐 썼다고 조작부가 사라지면
 * 손가락으로 돌아왔을 때 걸을 방법이 없어진다.
 */

let touched = false;

if (typeof window !== "undefined") {
  window.addEventListener(
    "touchstart",
    () => {
      touched = true;
    },
    { passive: true, once: true }
  );
}

export function isCoarsePointer(): boolean {
  if (touched) return true;
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(pointer: coarse)").matches;
}

/** 손가락이 닿은 적이 있는지만 — 안내 문구를 고를 때 쓴다 */
export function hasTouched(): boolean {
  return touched;
}
