"use client";

import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { levelsOf } from "@/scene/geometry";
import { planFromWorld, worldXZ } from "@/scene/placement";
import {
  EYE_HEIGHT_MM,
  PLAYER_RADIUS_MM,
  RUN_SPEED_MM_S,
  WALK_SPEED_MM_S,
  resolveWalk,
  roomNameAt,
  walkBlockers,
  walkSpawn,
} from "@/scene/walk";
import type { Scene } from "@/scene/types";
import { stopMoving, type WalkInput } from "./walkInput";
import { isCoarsePointer } from "./coarsePointer";
import { flushTextures, hasPendingTextures, setTextureDeferred } from "./materials";

/**
 * 걷기 모드의 카메라.
 *
 * 눈높이에서 마우스로 둘러보고 WASD 로 걷는다. 화면에는 아무것도 그리지 않는다 —
 * 하는 일은 매 프레임 카메라를 옳은 자리에 놓는 것뿐이다.
 *
 * drei 의 PointerLockControls 를 쓰지 않는다. 그쪽은 자기 mousemove 로 카메라를 직접
 * 돌려 버려서 우리가 yaw·pitch 를 손에 쥘 수 없고, 4단계의 터치 조작이 같은 값을 써야
 * 하는데 그 통로가 없다. 어차피 필요한 코드는 몇 줄이라 직접 든다.
 *
 * ── 좌표 ──
 * 충돌 계산은 전부 평면 좌표(mm)에서 한다(scene/walk.ts). 3D(m) 와의 변환은
 * `worldXZ` / `planFromWorld` 만 쓴다 — 부호를 손으로 다시 쓰면 반드시 어긋난다.
 */

const MM = 0.001;

/** 마우스 한 픽셀에 도는 각도(라디안). 이보다 크면 예민해서 조준이 안 된다 */
const SENSITIVITY = 0.0022;

/** 위아래로 볼 수 있는 한계 — 넘어가면 뒤집힌 것처럼 보인다 */
const PITCH_LIMIT = (80 * Math.PI) / 180;

/**
 * 한 번에 이만큼 넘게 움직인 마우스 입력은 버린다.
 *
 * 창 포커스가 돌아오는 순간이나 브라우저 버그로 수백 px 짜리 movement 가 한 번에 온다.
 * 그대로 반영하면 시선이 홱 돌아가 방향을 잃는다.
 */
const MAX_MOVEMENT = 300;

/** 속도가 목표에 따라붙는 빠르기 — 클수록 급출발·급정지에 가깝다 */
const ACCEL = 14;

/** 이보다 느리면 멈춘 것으로 본다 (mm/s) */
const STOP_SPEED = 5;

/** 떠오르는 속도 (mm/초). 걷는 속도와 비슷해야 조작감이 한 덩어리로 느껴진다 */
const LIFT_SPEED_MM_S = 1600;

/** 천장에서 이만큼은 띄운다 (mm) — 천장을 뚫고 나가면 방이 통째로 사라진다 */
const CEILING_GAP_MM = 150;

/** 걷기 화각. 조감보다 넓혀야 좁은 방에서 답답하지 않다 */
const WALK_FOV = 68;

/**
 * 손가락으로 쌓은 시선을 한 프레임에 얼마나 쓸지.
 *
 * 1 이면 터치의 거친 샘플링이 그대로 드러나 시선이 계단처럼 돈다. 너무 작으면
 * 손가락을 멈춘 뒤에도 한참 미끄러진다. 0.6 이면 두세 프레임에 다 소진돼 지연은
 * 느껴지지 않으면서 계단만 사라진다.
 */
const TOUCH_LOOK_SHARE = 0.6;

/* ── 해상도 거버너 ── */

/** 이 창만큼 모아서 평균을 낸다 (초) */
const GOVERNOR_WINDOW_S = 1;
/** 평균이 이보다 길면 내린다 (ms) — 50fps 아래 */
const SLOW_MS = 20;
/** 평균이 이보다 짧아야 올린다 (ms) — 80fps 위. 넉넉히 남을 때만 올린다 */
const FAST_MS = 12;
/** 빠른 상태가 이만큼 이어져야 올린다 (초) */
const FAST_HOLD_S = 3;
/** 한 번 바꾼 뒤 이만큼은 다시 판단하지 않는다 (초) */
const GOVERNOR_COOLDOWN_S = 2;
const DPR_STEP = 0.25;
const MIN_DPR = 0.75;

/** 멈춘 뒤 이만큼 지나야 미뤄 둔 텍스처를 붙인다 (초) */
const SETTLE_S = 0.3;

/** 현재 실 이름을 다시 재는 주기(초) — 매 프레임 셀 이유가 없다 */
const ROOM_CHECK_S = 0.2;

export interface WalkControllerProps {
  scene: Scene;
  /** 키보드·마우스·손가락이 함께 쓰는 입력 그릇 */
  inputRef: MutableRefObject<WalkInput>;
  /** 걸어 다닐 층 */
  levelId: string;
  /** 장면이 다 준비됐는지 — 텍스처가 오는 중에 걸으면 첫 몇 초가 끊긴다 */
  enabled: boolean;
  onLockChange: (locked: boolean) => void;
  /** 마우스 잠금을 못 걸어 드래그로 둘러봐야 하는 상황 */
  onFallback: (fallback: boolean) => void;
  /** 잠금을 지금 걸 수 없다 — 브라우저가 해제 직후 잠깐 막는다 */
  onCooldown?: (waiting: boolean) => void;
  onRoomChange: (name: string | null) => void;
}

export function WalkController({
  scene,
  inputRef,
  levelId,
  enabled,
  onLockChange,
  onFallback,
  onCooldown,
  onRoomChange,
}: WalkControllerProps) {
  /*
   * 카메라·렌더러는 게터로 꺼낸다.
   *
   * useThree 가 돌려준 값을 그대로 고치면 리액트가 "훅이 준 값을 바깥에서 바꿨다"고
   * 본다. R3F 에서 카메라를 명령형으로 모는 것은 정상이지만, 규칙을 우회하려고
   * 주석으로 끄기보다 게터를 통해 그때그때 꺼내 쓰는 편이 뜻도 분명하다.
   */
  const three = useThree((state) => state.get);
  const setDpr = useThree((state) => state.setDpr);

  const room = scene.room;

  /*
   * 막는 것들.
   *
   * scene 객체 참조가 아니라 서명으로 기억한다 — 걷는 중에 편집은 없지만 백그라운드
   * 잡이 끝나면 store 가 scene 을 새 객체로 갈아끼운다. 참조로 걸어 두면 그때마다
   * 벽과 가구를 전부 다시 재게 된다.
   */
  const signature = useMemo(() => {
    const walls = (room.walls ?? [])
      .map((wall) => `${wall.id}:${wall.start}:${wall.end}:${wall.thickness}:${(wall.openings ?? []).length}`)
      .join("|");
    const objects = scene.objects
      .map(
        (object) =>
          `${object.id}:${object.screen.x}:${object.depth}:${object.screen.rotation}:${object.transform.scale.join(",")}`
      )
      .join("|");
    return `${levelId}#${walls}#${objects}`;
  }, [room, scene.objects, levelId]);

  const blockers = useMemo(
    () => walkBlockers(scene, levelId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature]
  );

  /* ── 매 프레임 바뀌는 값들. 리액트에 두면 프레임마다 리렌더가 난다 ── */
  const yaw = useRef(0);
  const pitch = useRef(0);
  const locked = useRef(false);
  const dragging = useRef(false);
  /** 지금 눌려 있는 키. 이걸로 move 를 다시 계산해 inputRef 에 적는다 */
  const held = useRef({ forward: false, back: false, left: false, right: false, run: false, up: false, down: false });
  /** 현재 속도 — x·y 는 평면(mm/s), z 는 위아래(mm/s) */
  const velocity = useRef({ x: 0, y: 0, z: 0 });
  const roomTimer = useRef(0);
  const currentRoom = useRef<string | null>(null);
  /** 가만히 있은 시간(초) — 미뤄 둔 텍스처를 붙일 때를 고른다 */
  const stillFor = useRef(0);
  /** 잠금 오류를 한 번 겪었는지 — 두 번째부터는 드래그로 물러난다 */
  const retried = useRef(false);

  /*
   * 해상도 거버너의 상태.
   *
   * 3단계에서는 잠금 여부로 1.25 / 1.5 를 오갔다. 그건 기기가 얼마나 버티는지와
   * 아무 상관이 없는 값이라, 느린 기기에서는 여전히 느리고 빠른 기기에서는 괜히 흐렸다.
   * 실제 프레임 시간을 보고 정한다.
   */
  const governor = useRef({ elapsed: 0, total: 0, frames: 0, fast: 0, cooldown: 0, dpr: 1.25 });

  /**
   * 올릴 수 있는 최대 해상도.
   *
   * 손가락 기기는 화면이 작고 GPU 도 약하다. 같은 1.5 를 주면 픽셀 수가 훨씬 많아져
   * 먼저 무너진다 — 낮게 시작하고 낮게 끝낸다.
   */
  const maxDpr = useMemo(() => (isCoarsePointer() ? 1.25 : 1.5), []);

  /* 재사용하는 벡터 — useFrame 안에서 new 를 하지 않으려고 미리 만든다 */
  const forwardVec = useRef(new THREE.Vector3());
  const rightVec = useRef(new THREE.Vector3());

  /** 이 층의 바닥 높이 (mm) */
  const elevation = useMemo(() => {
    const levels = levelsOf(room);
    return (levels.find((level) => level.id === levelId) ?? levels[0])?.elevation ?? 0;
  }, [room, levelId]);

  /* ────────────────── 카메라 세우기 ────────────────── */

  useEffect(() => {
    const { camera } = three();
    const previousFov = camera instanceof THREE.PerspectiveCamera ? camera.fov : null;
    const previousOrder = camera.rotation.order;

    /*
     * 오일러 순서를 YXZ 로 바꾼다.
     *
     * 기본 XYZ 로 yaw·pitch 를 같이 넣으면 롤(고개 갸웃)이 섞여 수평선이 기울어진다.
     * YXZ 는 "먼저 좌우로 돌고 그다음 위아래" 라 1인칭 시점에 맞는다.
     */
    camera.rotation.order = "YXZ";

    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = WALK_FOV;
      camera.near = 0.05;
      camera.updateProjectionMatrix();
    }

    return () => {
      camera.rotation.order = previousOrder;
      if (camera instanceof THREE.PerspectiveCamera && previousFov !== null) {
        camera.fov = previousFov;
        camera.updateProjectionMatrix();
      }
    };
  }, [three]);

  /* 시작 위치와 시작 방향 */
  useEffect(() => {
    const { camera } = three();
    const spawnPlan = walkSpawn(scene, levelId, PLAYER_RADIUS_MM);
    const [x, z] = worldXZ({ cx: spawnPlan[0], cy: spawnPlan[1] }, room);

    camera.position.set(x, (elevation + EYE_HEIGHT_MM) * MM, z);

    /*
     * 시작 방향은 방 한가운데를 보게 한다. 벽을 마주 보고 시작하면 아무것도 안 보인다.
     *
     * 각도를 손으로 계산하지 않는다. lookAt 을 한 번 부르고 그 결과에서 yaw·pitch 를
     * 읽어 오는 편이 부호를 틀릴 여지가 없다 — 평면 각도에서 3D yaw 로 옮기는 식은
     * 축이 뒤집혀 있어 매번 헷갈린다.
     */
    camera.lookAt(0, camera.position.y, 0);
    yaw.current = camera.rotation.y;
    pitch.current = camera.rotation.x;

    velocity.current.x = 0;
    velocity.current.y = 0;
    velocity.current.z = 0;

    currentRoom.current = roomNameAt(scene, levelId, spawnPlan);
    onRoomChange(currentRoom.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.sceneId, levelId, three]);

  /* ────────────────── 걷는 동안의 렌더 정책 ────────────────── */

  useEffect(() => {
    /*
     * 걷는 동안 도착한 텍스처는 바로 붙이지 않는다. GPU 업로드가 프레임을 통째로
     * 먹는데, 눈높이에서 움직이는 중이면 그게 곧바로 멀미가 된다. 멈춰 섰을 때 붙인다.
     */
    setTextureDeferred(true);

    governor.current.dpr = isCoarsePointer() ? 1 : 1.25;
    setDpr(governor.current.dpr);

    return () => {
      // 나갈 때는 미뤄 둔 것을 전부 붙이고 조감의 기본 해상도로 되돌린다
      setTextureDeferred(false);
      setDpr(1.5);
    };
  }, [setDpr]);

  /* ────────────────── 마우스 ────────────────── */

  useEffect(() => {
    if (!enabled) return;

    const canvas = three().gl.domElement;

    const onClick = () => {
      if (locked.current || dragging.current) return;

      /*
       * 손가락으로 하는 기기에서는 잠그려 들지 않는다.
       *
       * 터치에는 잠글 마우스가 없다. 그런데도 부르면 브라우저가 권한 안내를 띄우거나
       * 조용히 실패하고, 그 사이 화면 조이스틱이 먹통이 된다. 화면을 한 번 두드리는
       * 것만으로 그 일이 나면 무엇 때문인지 알 길이 없다.
       */
      if (isCoarsePointer()) return;

      /*
       * 마우스 잠금은 여러 이유로 실패한다 — iframe 안, 권한 거부, iOS Safari.
       * 브라우저에 따라 throw 하기도 하고 거절된 Promise 를 주기도 해서 둘 다 받는다.
       * 실패하면 드래그로 둘러보게 물러난다. 못 쓰는 것보다 낫다.
       */
      /*
       * 잠금을 푼 직후 1초쯤은 브라우저가 재요청을 거부한다(크롬). Esc 를 누르고 바로
       * 다시 클릭하면 아무 일도 안 일어나는데, 그게 고장으로 보인다. 거부된 경우와
       * 아예 못 쓰는 경우를 갈라서, 앞의 것은 "잠시 후"라고 알려 준다.
       */
      const failed = (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error ?? "");
        if (/security|gesture|recently|denied/i.test(message)) {
          onCooldown?.(true);
          window.setTimeout(() => onCooldown?.(false), 1200);
          return;
        }
        onFallback(true);
      };

      try {
        const result = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        if (result && typeof result.catch === "function") {
          result.catch(failed);
        }
      } catch (error) {
        failed(error);
      }
    };

    const onLockChanged = () => {
      locked.current = document.pointerLockElement === canvas;
      onLockChange(locked.current);
    };

    const onLockError = () => {
      locked.current = false;
      onLockChange(false);
      /*
       * pointerlockerror 는 이유를 알려 주지 않는다. 해제 직후의 거부일 수도 있고
       * 아예 못 쓰는 환경일 수도 있어서, 일단 잠시 기다리라고 안내한다. 정말 못 쓰는
       * 환경이면 다시 눌러도 같은 오류가 나고 그때 드래그로 물러난다.
       */
      if (retried.current) onFallback(true);
      else {
        retried.current = true;
        onCooldown?.(true);
        window.setTimeout(() => onCooldown?.(false), 1200);
      }
    };

    const onMouseMove = (event: MouseEvent) => {
      if (!locked.current && !dragging.current) return;

      const dx = event.movementX;
      const dy = event.movementY;
      // 포커스가 돌아오는 순간 수백 px 짜리 입력이 한 번에 온다 — 그대로 반영하면 홱 돈다
      if (Math.abs(dx) > MAX_MOVEMENT || Math.abs(dy) > MAX_MOVEMENT) return;

      /*
       * 여기서 카메라를 돌리지 않고 쌓아만 둔다. 적용은 프레임에서 한 번 — 한 프레임에
       * mousemove 가 여러 번 와도 결과는 같고, 터치와 같은 길을 쓰게 된다.
       */
      const input = inputRef.current;
      input.look.x += dx * SENSITIVITY;
      input.look.y += dy * SENSITIVITY;
      // 마우스에는 스무딩을 넣지 않는다 — 지연이 생기면 곧바로 "무겁다"고 느낀다
      input.lookFromTouch = false;
    };

    /* 잠금을 못 걸었을 때의 물러남 — 왼쪽 버튼을 누른 채 움직인다 */
    const onPointerDown = (event: PointerEvent) => {
      if (locked.current || event.button !== 0) return;
      dragging.current = true;
    };
    const onPointerUp = () => {
      dragging.current = false;
    };

    canvas.addEventListener("click", onClick);
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointerlockchange", onLockChanged);
    document.addEventListener("pointerlockerror", onLockError);
    document.addEventListener("mousemove", onMouseMove);

    return () => {
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointerlockchange", onLockChanged);
      document.removeEventListener("pointerlockerror", onLockError);
      document.removeEventListener("mousemove", onMouseMove);

      if (document.pointerLockElement === canvas) document.exitPointerLock();
      locked.current = false;
      dragging.current = false;
    };
  }, [enabled, three, onFallback, onLockChange, onCooldown, inputRef]);

  /* ────────────────── 키보드 ────────────────── */

  useEffect(() => {
    if (!enabled) return;

    const typing = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;
      return Boolean(
        element &&
          (element.tagName === "INPUT" ||
            element.tagName === "TEXTAREA" ||
            element.tagName === "SELECT" ||
            element.isContentEditable)
      );
    };

    /**
     * 눌린 키들을 이동 입력으로 옮긴다.
     *
     * 키보드는 -1/0/1 만 낼 수 있다. 조이스틱이 그 사이 값을 채우는데, 둘이 같은
     * 자리에 쓰므로 마지막에 손댄 쪽이 이긴다 — 한 기기에서 둘을 동시에 쓰는 일은
     * 없으니 그걸로 충분하다.
     */
    const publish = () => {
      const keys = held.current;
      const input = inputRef.current;
      input.move.x = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      input.move.y = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
      input.run = keys.run;
      input.lift = (keys.up ? 1 : 0) - (keys.down ? 1 : 0);
    };

    /** 물리 키 위치로 읽는다 — 한글·독일어 자판에서도 같은 자리가 앞으로 간다 */
    const set = (code: string, down: boolean) => {
      const input = held.current;
      switch (code) {
        case "KeyW":
        case "ArrowUp":
          input.forward = down;
          break;
        case "KeyS":
        case "ArrowDown":
          input.back = down;
          break;
        case "KeyA":
        case "ArrowLeft":
          input.left = down;
          break;
        case "KeyD":
        case "ArrowRight":
          input.right = down;
          break;
        case "ShiftLeft":
        case "ShiftRight":
          input.run = down;
          break;
        case "Space":
          input.up = down;
          break;
        /* 내려오는 키도 함께 둔다 — 뜨기만 하고 못 내려오면 갇힌다 */
        case "KeyC":
        case "ControlLeft":
        case "ControlRight":
          input.down = down;
          break;
        default:
          break;
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || typing(event.target)) return;
      // 스페이스바는 브라우저 기본 동작이 "한 화면 스크롤"이다 — 걷는 중에는 막는다
      if (event.code === "Space") event.preventDefault();
      set(event.code, true);
      publish();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      set(event.code, false);
      publish();
    };

    /** 탭을 옮기면 keyup 이 오지 않는다 — 돌아왔을 때 혼자 걷고 있게 된다 */
    const release = () => {
      const keys = held.current;
      keys.forward = keys.back = keys.left = keys.right = keys.run = false;
      keys.up = keys.down = false;
      stopMoving(inputRef.current);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") release();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", onVisibility);
      release();
    };
  }, [enabled, inputRef]);

  /* ────────────────── 매 프레임 ────────────────── */

  useFrame((state, delta) => {
    const camera = state.camera;

    /*
     * 쌓인 시선 입력을 적용한다.
     *
     * 마우스는 그대로 다 쓴다 — 한 픽셀이라도 지연되면 곧바로 "무겁다"고 느낀다.
     * 손가락은 이번 프레임에 60% 만 쓰고 나머지는 남긴다. 터치는 샘플링이 거칠어
     * 그대로 적용하면 시선이 계단처럼 뚝뚝 도는데, 두세 프레임에 나눠 흘리면 그 계단이
     * 사라진다. 남은 양이 곧 소진되므로 손가락을 멈추면 시선도 곧 멈춘다.
     */
    const look = inputRef.current.look;
    const share = inputRef.current.lookFromTouch ? TOUCH_LOOK_SHARE : 1;

    if (look.x !== 0 || look.y !== 0) {
      const dx = look.x * share;
      const dy = look.y * share;

      yaw.current -= dx;
      pitch.current = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch.current - dy));

      look.x -= dx;
      look.y -= dy;

      // 소수점 찌꺼기가 남아 영원히 미세하게 돌지 않도록 끊어 준다
      if (Math.abs(look.x) < 1e-5) look.x = 0;
      if (Math.abs(look.y) < 1e-5) look.y = 0;
    }

    // 시선은 언제나 따라온다 — 아직 준비 중이어도 둘러는 볼 수 있게 한다
    camera.rotation.set(pitch.current, yaw.current, 0, "YXZ");

    if (!enabled) return;

    /*
     * 한 프레임이 아주 길어졌을 때(탭 전환 직후, GC) 그만큼을 한 번에 이동하면
     * 벽을 지나칠 수 있다. 20fps 분량으로 자른다.
     */
    const dt = Math.min(delta, 1 / 20);

    const input = inputRef.current;
    const strafe = input.move.x;
    const ahead = input.move.y;

    /* 목표 속도를 카메라가 보는 방향 기준으로 만든다 */
    let targetX = 0;
    let targetZ = 0;

    if (strafe !== 0 || ahead !== 0) {
      /*
       * 길이로 나눠 대각선이 빨라지지 않게 한다.
       *
       * 키보드는 (1,1) 로 들어와 길이가 √2 가 되므로 이 나눗셈이 꼭 필요하다.
       * 조이스틱은 이미 크기가 0~1 로 들어오는데, 그때는 나눈 뒤 다시 크기를 곱해
       * "살짝 밀면 천천히"가 살아 있어야 한다.
       */
      const length = Math.hypot(strafe, ahead);
      const throttle = Math.min(1, length);
      const speed = (input.run ? RUN_SPEED_MM_S : WALK_SPEED_MM_S) * throttle;

      /*
       * 앞 방향은 카메라에서 뽑아 y 를 눌러 없앤다. 위를 보고 걸어도 수평으로 가야
       * 한다 — 안 그러면 천장을 보는 순간 바닥으로 파고든다.
       */
      camera.getWorldDirection(forwardVec.current);
      forwardVec.current.y = 0;
      forwardVec.current.normalize();

      /*
       * 오른쪽 = 앞 × 위.
       *
       * (fx, 0, fz) × (0, 1, 0) = (-fz, 0, fx) 다. 부호를 뒤집으면 D 가 왼쪽으로 간다 —
       * 기본 카메라(앞이 -Z)에 넣어 확인하면 (-(-1), 0, 0) = +X, 즉 오른쪽이 맞다.
       */
      rightVec.current.set(-forwardVec.current.z, 0, forwardVec.current.x);

      targetX = ((forwardVec.current.x * ahead + rightVec.current.x * strafe) / length) * speed;
      targetZ = ((forwardVec.current.z * ahead + rightVec.current.z * strafe) / length) * speed;
    }

    /* 가속·감속 — 급출발과 급정지는 걷는 느낌이 아니다 */
    velocity.current.x = THREE.MathUtils.damp(velocity.current.x, targetX, ACCEL, dt);
    velocity.current.y = THREE.MathUtils.damp(velocity.current.y, targetZ, ACCEL, dt);

    if (
      targetX === 0 &&
      targetZ === 0 &&
      Math.hypot(velocity.current.x, velocity.current.y) < STOP_SPEED
    ) {
      velocity.current.x = 0;
      velocity.current.y = 0;
    }

    const dispX = velocity.current.x * dt * MM;
    const dispZ = velocity.current.y * dt * MM;

    if (Math.hypot(dispX, dispZ) > 0.00005) {
      /*
       * 이동은 3D 에서 만들고 평면으로 옮긴다.
       *
       * 평면에서 더하면 z 부호를 손으로 뒤집어야 하는데 그 자리에서 꼭 틀린다.
       * planFromWorld 가 그 일을 하도록 맡긴다.
       */
      const from = planFromWorld([camera.position.x, camera.position.z], room);
      const to = planFromWorld([camera.position.x + dispX, camera.position.z + dispZ], room);

      const moved = resolveWalk(
        [from.cx, from.cy],
        [to.cx, to.cy],
        PLAYER_RADIUS_MM,
        blockers
      );

      const [wx, wz] = worldXZ({ cx: moved[0], cy: moved[1] }, room);
      camera.position.x = wx;
      camera.position.z = wz;

      /*
       * 벽에 막혀 목표만큼 못 갔으면 속도도 그만큼 줄인다.
       *
       * 안 그러면 벽을 미는 동안 속도가 벽 안쪽으로 계속 쌓여, 옆으로 방향을 틀 때
       * 쌓인 속도가 한 번에 풀려 튕겨 나간다.
       */
      if (Math.hypot(moved[0] - to.cx, moved[1] - to.cy) > 1) {
        velocity.current.x = (moved[0] - from.cx) / dt;
        velocity.current.y = -(moved[1] - from.cy) / dt;
      }
    }

    /*
     * 위아래로 뜨기.
     *
     * 눈높이에만 매여 있으면 못 보는 것이 있다 — 우물천장 단, 상부장 위, 붙박이장
     * 윗면. 스페이스바로 떠올라 위에서 내려다보면 그게 다 보인다.
     *
     * 중력을 넣지 않는다. 떨어지는 재미를 주는 화면이 아니라 원하는 높이에 머물러
     * 살펴보는 화면이라, 손을 떼면 그 높이에 그대로 선다. 대신 눈높이(바닥)를 밑으로
     * 뚫지 못하게 하고, 천장 바로 아래에서 멈춘다 — 천장을 뚫고 나가면 방이 사라진다.
     */
    const floorY = (elevation + EYE_HEIGHT_MM) * MM;
    const ceilingY = (elevation + room.dimensions.height) * MM - CEILING_GAP_MM * MM;

    const targetLift = input.lift * LIFT_SPEED_MM_S;
    velocity.current.z = THREE.MathUtils.damp(velocity.current.z, targetLift, ACCEL, dt);

    if (input.lift === 0 && Math.abs(velocity.current.z) < STOP_SPEED) velocity.current.z = 0;

    let nextY = camera.position.y + velocity.current.z * dt * MM;

    if (nextY <= floorY) {
      nextY = floorY;
      if (velocity.current.z < 0) velocity.current.z = 0;
    } else if (nextY >= ceilingY) {
      nextY = Math.max(floorY, ceilingY);
      if (velocity.current.z > 0) velocity.current.z = 0;
    }

    camera.position.y = nextY;

    /* 현재 실 이름 — 바뀔 때만 위로 알린다 */
    roomTimer.current += dt;
    if (roomTimer.current >= ROOM_CHECK_S) {
      roomTimer.current = 0;
      const here = planFromWorld([camera.position.x, camera.position.z], room);
      const name = roomNameAt(scene, levelId, [here.cx, here.cy]);
      if (name !== currentRoom.current) {
        currentRoom.current = name;
        onRoomChange(name);
      }
    }

    /* ── 미뤄 둔 텍스처를 멈췄을 때 붙인다 ── */
    const moving =
      Math.hypot(velocity.current.x, velocity.current.y) >= STOP_SPEED ||
      look.x !== 0 ||
      look.y !== 0;

    if (moving) {
      stillFor.current = 0;
    } else {
      stillFor.current += dt;
      if (stillFor.current >= SETTLE_S && hasPendingTextures()) flushTextures();
    }

    /* ── 해상도 거버너 ── */
    governor.current.elapsed += dt;
    governor.current.total += dt;
    governor.current.frames += 1;
    governor.current.cooldown = Math.max(0, governor.current.cooldown - dt);

    if (governor.current.elapsed >= GOVERNOR_WINDOW_S) {
      const average = (governor.current.total / governor.current.frames) * 1000;
      governor.current.elapsed = 0;
      governor.current.total = 0;
      governor.current.frames = 0;

      if (governor.current.cooldown === 0) {
        /*
         * 느리면 곧바로 내리고, 빠를 때는 한참 지켜본 뒤에 올린다.
         *
         * setDpr 은 캔버스를 다시 잡게 해서 그 자체가 한 프레임을 먹는다. 오르내리기를
         * 되풀이하면 거버너가 끊김의 원인이 된다 — 그래서 올릴 때만 조건을 빡빡하게 두고,
         * 바꾼 뒤에는 얼마간 판단을 쉰다.
         */
        if (average > SLOW_MS && governor.current.dpr > MIN_DPR) {
          governor.current.dpr = Math.max(MIN_DPR, governor.current.dpr - DPR_STEP);
          governor.current.fast = 0;
          governor.current.cooldown = GOVERNOR_COOLDOWN_S;
          setDpr(governor.current.dpr);
        } else if (average < FAST_MS) {
          governor.current.fast += GOVERNOR_WINDOW_S;
          if (governor.current.fast >= FAST_HOLD_S && governor.current.dpr < maxDpr) {
            governor.current.dpr = Math.min(maxDpr, governor.current.dpr + DPR_STEP);
            governor.current.fast = 0;
            governor.current.cooldown = GOVERNOR_COOLDOWN_S;
            setDpr(governor.current.dpr);
          }
        } else {
          governor.current.fast = 0;
        }
      }
    }
  });

  return null;
}

