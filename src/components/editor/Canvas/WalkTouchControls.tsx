"use client";

import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { JOYSTICK, joystickInput, joystickKnob } from "@/scene/walk";
import { stopMoving, type WalkInput } from "./walkInput";
import { isCoarsePointer } from "./coarsePointer";

/**
 * 손가락으로 걷기 — 왼쪽 엄지로 이동, 오른쪽 엄지로 시선.
 *
 * Canvas 바깥의 평범한 DOM 이다. 값은 전부 `inputRef` 라는 ref 하나로 흘려보내므로
 * 손가락을 움직이는 내내 리액트는 한 번도 다시 그리지 않는다 — 조이스틱 손잡이만
 * DOM 스타일로 직접 옮긴다.
 *
 * 조이스틱은 **손가락이 닿은 자리에 생긴다.** 고정 위치에 두면 기기 크기와 손 크기에
 * 따라 엄지가 안 닿거나 화면을 가린다. 닿은 자리에 생기면 어떤 기기에서도 맞는다.
 */

/** 손가락 1px 이 도는 각도(라디안). 엄지 이동량이 마우스보다 작아 두 배로 둔다 */
const TOUCH_SENSITIVITY = 0.0045;

/** 이 안에서 손을 떼면 탭으로 본다 — 시선을 돌리지 않는다 */
const TAP = { distance: 10, ms: 200 };

export interface WalkTouchControlsProps {
  inputRef: MutableRefObject<WalkInput>;
  /** 장면이 다 준비됐는지 */
  enabled: boolean;
  /** 첫 손가락이 닿았을 때 — 안내 카드를 접는다 */
  onFirstTouch?: () => void;
}

/** 지금 추적 중인 손가락 하나 */
interface Finger {
  id: number;
  /** 처음 닿은 자리 (조이스틱 베이스 중심이자, 시선 드래그의 기준점) */
  originX: number;
  originY: number;
  /** 직전 위치 — 시선은 프레임 사이의 차이만 쓴다 */
  lastX: number;
  lastY: number;
  startedAt: number;
  moved: number;
}

export function WalkTouchControls({ inputRef, enabled, onFirstTouch }: WalkTouchControlsProps) {
  /* 손가락 기기에서만 띄운다. 한 번 켜면 끄지 않는다 */
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (isCoarsePointer()) {
      setShow(true);
      return;
    }
    const onTouch = () => setShow(true);
    window.addEventListener("touchstart", onTouch, { passive: true, once: true });
    return () => window.removeEventListener("touchstart", onTouch);
  }, []);

  const moveZone = useRef<HTMLDivElement | null>(null);
  const lookZone = useRef<HTMLDivElement | null>(null);
  const base = useRef<HTMLDivElement | null>(null);
  const knob = useRef<HTMLDivElement | null>(null);

  const moveFinger = useRef<Finger | null>(null);
  const lookFinger = useRef<Finger | null>(null);

  /* ────────────────── 페이지가 딸려 움직이지 않게 ────────────────── */

  useEffect(() => {
    if (!show) return;

    /*
     * iOS 는 화면을 쓸면 페이지가 튕기고(바운스), 두 손가락이면 핀치줌으로 본다.
     * 걷는 내내 그 일이 나면 조작이 안 된다. 걷기 화면에 있는 동안만 막고 나갈 때 되돌린다.
     */
    const body = document.body;
    const previousOverscroll = body.style.overscrollBehavior;
    const previousTouchAction = body.style.touchAction;
    body.style.overscrollBehavior = "none";
    body.style.touchAction = "none";

    const block = (event: Event) => event.preventDefault();

    // passive:false 여야 preventDefault 가 먹는다
    document.addEventListener("touchmove", block, { passive: false });
    document.addEventListener("gesturestart", block as EventListener);

    return () => {
      body.style.overscrollBehavior = previousOverscroll;
      body.style.touchAction = previousTouchAction;
      document.removeEventListener("touchmove", block);
      document.removeEventListener("gesturestart", block as EventListener);
    };
  }, [show]);

  /* ────────────────── 손가락 다루기 ────────────────── */

  useEffect(() => {
    if (!show) return;

    const moveEl = moveZone.current;
    const lookEl = lookZone.current;
    if (!moveEl || !lookEl) return;

    /** 조이스틱을 화면에 세운다 */
    const showStick = (x: number, y: number) => {
      const stick = base.current;
      const handle = knob.current;
      if (!stick || !handle) return;

      stick.style.left = `${x}px`;
      stick.style.top = `${y}px`;
      stick.style.opacity = "1";
      handle.style.transform = "translate(-50%, -50%)";
      stick.style.borderColor = "";
    };

    const hideStick = () => {
      const stick = base.current;
      if (stick) stick.style.opacity = "0";
    };

    /** 손잡이를 옮기고 입력을 갱신한다 */
    const dragStick = (dx: number, dy: number) => {
      const handle = knob.current;
      const stick = base.current;
      if (!handle || !stick) return;

      const [kx, ky] = joystickKnob(dx, dy);
      handle.style.transform = `translate(calc(-50% + ${kx}px), calc(-50% + ${ky}px))`;

      const result = joystickInput(dx, dy);
      const input = inputRef.current;
      input.move.x = result.x;
      input.move.y = result.y;
      input.run = result.run;

      // 달릴 때는 테두리로 알려 준다 — 손가락이 화면을 가려 손잡이가 안 보인다
      stick.style.borderColor = result.run ? "var(--color-accent, #2f5d4e)" : "";
    };

    const onDown = (event: PointerEvent, zone: "move" | "look") => {
      if (!enabled) return;

      const slot = zone === "move" ? moveFinger : lookFinger;
      // 이미 그 손으로 잡고 있으면 두 번째 손가락은 무시한다
      if (slot.current) return;

      const element = zone === "move" ? moveEl : lookEl;
      element.setPointerCapture(event.pointerId);

      slot.current = {
        id: event.pointerId,
        originX: event.clientX,
        originY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        startedAt: performance.now(),
        moved: 0,
      };

      if (zone === "move") showStick(event.clientX, event.clientY);
      onFirstTouch?.();
    };

    const onMove = (event: PointerEvent, zone: "move" | "look") => {
      const slot = zone === "move" ? moveFinger : lookFinger;
      const finger = slot.current;
      if (!finger || finger.id !== event.pointerId) return;

      if (zone === "move") {
        dragStick(event.clientX - finger.originX, event.clientY - finger.originY);
        return;
      }

      /* 시선은 직전 위치와의 차이만 쓴다 — 처음 자리에서의 거리로 하면 계속 돌아간다 */
      const dx = event.clientX - finger.lastX;
      const dy = event.clientY - finger.lastY;
      finger.lastX = event.clientX;
      finger.lastY = event.clientY;
      finger.moved += Math.abs(dx) + Math.abs(dy);

      const input = inputRef.current;
      input.look.x += dx * TOUCH_SENSITIVITY;
      input.look.y += dy * TOUCH_SENSITIVITY;
      input.lookFromTouch = true;
    };

    const onUp = (event: PointerEvent, zone: "move" | "look") => {
      const slot = zone === "move" ? moveFinger : lookFinger;
      const finger = slot.current;
      if (!finger || finger.id !== event.pointerId) return;

      slot.current = null;

      if (zone === "move") {
        // 손을 떼면 곧바로 멈춘다. 관성을 주면 벽에 부딪혀야 서게 된다
        stopMoving(inputRef.current);
        hideStick();
        return;
      }

      /*
       * 짧게 두드린 것은 아무 일도 하지 않는다.
       *
       * 데스크톱에서는 클릭이 마우스 잠금이지만 터치에는 잠글 것이 없다. 여기서 무언가
       * 하면 화면을 잘못 건드릴 때마다 시점이 튄다.
       */
      const quick =
        finger.moved < TAP.distance && performance.now() - finger.startedAt < TAP.ms;
      if (quick) {
        inputRef.current.look.x = 0;
        inputRef.current.look.y = 0;
      }
    };

    /** 화면을 돌리면 손가락 추적이 어긋난다 — 전부 놓고 다시 시작한다 */
    const releaseAll = () => {
      moveFinger.current = null;
      lookFinger.current = null;
      stopMoving(inputRef.current);
      hideStick();
    };

    const moveDown = (event: PointerEvent) => onDown(event, "move");
    const moveMove = (event: PointerEvent) => onMove(event, "move");
    const moveUp = (event: PointerEvent) => onUp(event, "move");
    const lookDown = (event: PointerEvent) => onDown(event, "look");
    const lookMove = (event: PointerEvent) => onMove(event, "look");
    const lookUp = (event: PointerEvent) => onUp(event, "look");

    moveEl.addEventListener("pointerdown", moveDown);
    moveEl.addEventListener("pointermove", moveMove);
    moveEl.addEventListener("pointerup", moveUp);
    moveEl.addEventListener("pointercancel", moveUp);
    moveEl.addEventListener("lostpointercapture", moveUp);

    lookEl.addEventListener("pointerdown", lookDown);
    lookEl.addEventListener("pointermove", lookMove);
    lookEl.addEventListener("pointerup", lookUp);
    lookEl.addEventListener("pointercancel", lookUp);
    lookEl.addEventListener("lostpointercapture", lookUp);

    window.addEventListener("orientationchange", releaseAll);
    window.addEventListener("resize", releaseAll);

    return () => {
      moveEl.removeEventListener("pointerdown", moveDown);
      moveEl.removeEventListener("pointermove", moveMove);
      moveEl.removeEventListener("pointerup", moveUp);
      moveEl.removeEventListener("pointercancel", moveUp);
      moveEl.removeEventListener("lostpointercapture", moveUp);

      lookEl.removeEventListener("pointerdown", lookDown);
      lookEl.removeEventListener("pointermove", lookMove);
      lookEl.removeEventListener("pointerup", lookUp);
      lookEl.removeEventListener("pointercancel", lookUp);
      lookEl.removeEventListener("lostpointercapture", lookUp);

      window.removeEventListener("orientationchange", releaseAll);
      window.removeEventListener("resize", releaseAll);

      releaseAll();
    };
  }, [show, enabled, inputRef, onFirstTouch]);

  if (!show) return null;

  return (
    <div className="pointer-events-none absolute inset-0 select-none [touch-action:none] [-webkit-user-select:none]">
      {/*
        시선 영역이 화면 전체를 덮고, 그 위에 이동 영역이 얹힌다.
        이렇게 두면 "나머지 전부가 시선"이 저절로 된다 — 남은 자리를 계산할 필요가 없다.
      */}
      <div ref={lookZone} className="pointer-events-auto absolute inset-0 [touch-action:none]" />

      <div
        ref={moveZone}
        className="pointer-events-auto absolute bottom-0 left-0 h-[60%] w-[45%] [touch-action:none]"
      />

      {/* 조이스틱 — 손가락이 닿은 자리로 옮겨 다닌다 */}
      <div
        ref={base}
        style={{ width: JOYSTICK.radius * 2.8, height: JOYSTICK.radius * 2.8 }}
        className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/40 bg-white/25 opacity-0 backdrop-blur-sm transition-opacity duration-100"
      >
        <div
          ref={knob}
          className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 shadow-sm"
        />
      </div>
    </div>
  );
}
