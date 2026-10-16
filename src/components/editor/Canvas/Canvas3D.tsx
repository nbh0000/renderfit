"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Environment, Html, Lightformer, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useEditorStore } from "@/lib/editor/store";
import type { Material, Scene, SceneObject, WallSegment } from "@/scene/types";
import { FurnitureMesh } from "./FurnitureMesh";
import { NavGizmo, type GizmoHandlers } from "./NavGizmo";
import { onTextureReady, woodTexture, paintTexture } from "./textures";
import { useStandardMaterial } from "./materials";
import { AreaFloors } from "./AreaFloors";
import { WalkController } from "./WalkController";
import { WalkOverlay } from "./WalkOverlay";
import { WalkTouchControls } from "./WalkTouchControls";
import { createWalkInput } from "./walkInput";
import { WalkStats } from "./WalkStats";
import {
  ensureRoom,
  isPerimeterWall,
  levelIdOf,
  levelsOf,
  pointAlongWall,
  polygonArea,
  polygonCentroid,
  toSquareMeters,
  wallAngle,
  wallLength,
  wallOutwardNormal,
  wallSpans,
} from "@/scene/geometry";
import { openingObjectIds } from "@/scene/openings";
import { mountHeight, planCenter, worldXZ } from "@/scene/placement";

/**
 * 3D 뷰.
 *
 * - 생성된 AI 이미지를 뒷벽에 배경으로 띄워 3D 배치와 함께 볼 수 있다.
 * - 바닥을 기준으로 객체를 직접 끌어 배치한다 (놓는 순간 Scene operation 하나로 커밋).
 * - 실사감을 위해 ACES 톤매핑 + 그림자 + 절차적 IBL을 사용한다(외부 에셋 다운로드 없음).
 */

const MM = 0.001;
const DPR: [number, number] = [1, 1.5];

/** 렌더러 설정은 참조가 고정돼야 한다 — 매 렌더 새 객체를 주면 WebGL 렌더러가 재생성된다 */
const GL_CONFIG = {
  preserveDrawingBuffer: true, // 렌더 캡처(toDataURL)에 필요
  antialias: true,
  toneMapping: THREE.ACESFilmicToneMapping,
  toneMappingExposure: 1.05,
} as const;

/* ───────────────────── 좌표 변환 (Scene ↔ 3D 월드) ───────────────────── */

export function worldFromScene(
  object: SceneObject,
  room: Scene["room"],
  override?: { x?: number; depth?: number }
): [number, number, number] {
  const screen = { x: override?.x ?? object.screen.x, width: object.screen.width };
  const depth = override?.depth ?? object.depth;

  /*
   * 평면 위치도 높이도 공용 규칙(scene/placement)을 쓴다.
   * 예전에는 벽에 걸리는 것의 z를 뒷벽으로 고정해서 옆벽의 TV가 뒷벽으로 끌려갔고,
   * 천장등은 바닥에 놓여 방 한가운데 상자가 하나 생겼다.
   */
  const [x, z] = worldXZ(planCenter(screen, depth, room), room);
  return [x, mountHeight(object, room) * MM, z];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/* ───────────────────────────── 객체 ───────────────────────────── */

interface DragState {
  id: string;
  x: number;
  depth: number;
}

function ObjectMesh({
  scene,
  object,
  draft,
  onDragStart,
  interactive = true,
}: {
  scene: Scene;
  object: SceneObject;
  draft: DragState | null;
  onDragStart: (event: ThreeEvent<PointerEvent>, object: SceneObject) => void;
  /** 걷기에서는 클릭·드래그를 받지 않는다 — 보는 모드지 고치는 모드가 아니다 */
  interactive?: boolean;
}) {
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const select = useEditorStore((state) => state.select);

  const material = scene.materials.find((m) => m.id === object.materialId);
  const override = draft && draft.id === object.id ? { x: draft.x, depth: draft.depth } : undefined;
  const position = worldFromScene(object, scene.room, override);

  return (
    <group
      position={position}
      rotation={[0, (-object.screen.rotation * Math.PI) / 180, 0]}
      onClick={
        interactive
          ? (event) => {
              event.stopPropagation();
              select([object.id]);
            }
          : undefined
      }
      onPointerDown={
        interactive
          ? (event) => {
              if (object.locked) return;
              event.stopPropagation();
              select([object.id]);
              onDragStart(event, object);
            }
          : undefined
      }
    >
      <FurnitureMesh
        object={object}
        material={material}
        selected={interactive && selectedIds.includes(object.id)}
      />
    </group>
  );
}

/**
 * 다시 그릴 계기를 만들어 준다.
 *
 * frameloop="demand"는 R3F가 "무언가 바뀌었다"고 알 때만 프레임을 그린다. 그런데
 * 텍스처와 모델은 나중에 비동기로 도착하고, 3D 탭으로 막 전환한 순간에는 아직
 * 아무것도 준비돼 있지 않다. 그래서 3D를 열면 빈 화면이 그대로 멈춰 있었다 —
 * 마우스로 한 번 돌려야 비로소 그려졌다.
 *
 * 장면이 바뀔 때와 그 직후 몇 번, 그리고 외부 파일이 도착할 때 다시 그리게 한다.
 */
function RenderPump({ signature }: { signature: string }) {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    invalidate();
    // 텍스처·모델이 도착하는 시점을 미리 알 수 없어 몇 번 나눠 두드린다.
    const timers = [80, 300, 900, 2000, 4000].map((ms) => window.setTimeout(invalidate, ms));
    return () => timers.forEach(window.clearTimeout);
  }, [invalidate, signature]);

  // 사진 텍스처·잘라낸 가구 이미지는 비동기로 도착한다. 도착하면 그때 다시 그린다.
  useEffect(() => onTextureReady(invalidate), [invalidate]);

  useEffect(() => {
    const manager = THREE.DefaultLoadingManager;
    const previous = manager.onLoad;
    manager.onLoad = () => {
      previous?.();
      invalidate();
    };
    return () => {
      manager.onLoad = previous;
    };
  }, [invalidate]);

  return null;
}

/*
 * 텍스처 도착을 세던 useTextureGeneration 은 걷어냈다.
 *
 * 사진 한 장이 올 때마다 이 값이 올라가고, 그것을 의존성으로 삼은 머티리얼이 전부
 * 새로 만들어졌다. 이제는 materials.ts 의 캐시가 같은 객체의 맵만 갈아 끼우므로
 * 다시 계산할 이유가 없다. 다시 그리는 것은 RenderPump 가 invalidate 로 맡는다.
 */

/* ───────────────────────────── 공간 ───────────────────────────── */

/*
 * 뒷벽에 생성 이미지를 붙이던 GeneratedBackdrop 은 걷어냈다.
 *
 * 사진 한 장으로 시작하던 시절에는 뜻이 있었다 — 원본 사진을 뒤에 띄워 두고 3D 배치가
 * 그 사진과 맞는지 견줘 봤다. 그런데 도면으로 시작하면 뒷벽에 도면 그림이 통째로
 * 걸린다. 방 뒤에 흰 격자판이 떠 있는 꼴이라 공간이 어디서 끝나는지 알 수 없고,
 * 걷기에서는 벽 대신 그 판이 보인다.
 *
 * 견주는 일은 이제 평면도·측면도와 갤러리의 전/후 비교가 맡는다.
 */
/** 평면 좌표(mm, 좌하단 원점) → 3D 월드 좌표(m, 방 중심 원점) */
function worldFromPlan([x, y]: [number, number], room: Scene["room"]): [number, number] {
  return [(x - room.dimensions.width / 2) * MM, (room.dimensions.length / 2 - y) * MM];
}

/** 마감재에 크기가 안 적혀 있을 때 텍스처 한 장이 덮는 실제 크기 (m) */
const DEFAULT_TILE_M = { floor: 2, wall: 4 };

/**
 * 이 각도보다 위에서 내려다보면 바깥벽을 숨기지 않는다 (라디안).
 *
 * 45도 — 방 중심에서 봤을 때 카메라가 수평보다 위쪽 절반에 있으면 인형집 시점으로 본다.
 */
const TOP_DOWN_ANGLE = Math.PI / 4;

/**
 * 바닥을 방 치수보다 이만큼 넓게 깐다 (m).
 *
 * 벽 중심선 바깥으로 나가는 두께의 절반을 덮고도 남을 만큼이다. 한국 도면의 외벽은
 * 두꺼워야 300mm 이라 0.6m 면 양쪽 모두 넉넉히 들어간다.
 */
const FLOOR_BLEED = 0.6;

function RoomShell({
  scene,
  labels = true,
  cullWalls = true,
}: {
  scene: Scene;
  /** 실 이름표를 띄울지 — 걷기에서는 눈앞을 가려서 끈다 */
  labels?: boolean;
  /** 카메라와 방 사이의 바깥벽을 숨길지 — 걷기에서는 방 안에 있으므로 늘 세워 둔다 */
  cullWalls?: boolean;
}) {
  const room = useMemo(() => ensureRoom(scene.room), [scene.room]);
  const width = room.dimensions.width * MM;
  const length = room.dimensions.length * MM;
  const height = room.dimensions.height * MM;

  /*
   * 바닥·벽·천장 마감.
   *
   * Scene에 사진 텍스처가 붙은 마감재(CC0 PBR)가 들어와 있으면 그것을 쓴다.
   * 텍스처 한 장이 덮는 실제 크기(scale, m)를 알고 있으므로, 면의 실제 치수로 나눠
   * 반복 수를 정한다 — 그래야 6m 거실이든 2m 화장실이든 널 폭이 같아 보인다.
   */
  const finish = (surface: "floor" | "wall" | "ceiling") => {
    const chosen = room.finishes?.[surface];
    if (chosen) return scene.materials.find((m) => m.id === chosen);
    // 예전 프로젝트는 면을 지정하지 않았다 — 태그로 어림잡던 방식을 그대로 남겨 둔다.
    return scene.materials.find((m) => m.tags?.includes(surface));
  };

  const floorFinish = finish("floor");
  const wallFinish = finish("wall");
  const ceilingFinish = finish("ceiling");

  /*
   * 두 축을 따로 센다.
   *
   * 전에는 `Math.max(width, length) / scale` 하나를 가로세로에 똑같이 줬다. 10×4m 방이면
   * 세로로도 열 번을 반복해서 마루널이 한 방향으로 길게 늘어났다. 면의 실제 비율대로
   * 나눠야 타일이 정사각으로 보인다.
   */
  const floorTile = floorFinish?.scale || DEFAULT_TILE_M.floor;
  const wallTile = wallFinish?.scale || DEFAULT_TILE_M.wall;
  const ceilingTile = ceilingFinish?.scale || DEFAULT_TILE_M.floor;

  /*
   * 바닥은 실별 바닥 패치(AreaFloors)가 그 위에 얹힌다. 두 면이 같은 높이에 있으면
   * 깜빡이므로, 기준 바닥을 조금 뒤로 물려 둔다.
   */
  const floorMaterial = useStandardMaterial(floorFinish, {
    variant: "floor",
    repeatX: width / floorTile,
    repeatY: length / floorTile,
    fallbackColor: "#c9a173",
    fallbackTexture: woodTexture("#c9a173", [width / floorTile, length / floorTile]),
    overrides: {
      roughness: floorFinish?.roughness ?? 0.55,
      metalness: floorFinish?.metallic ?? 0.02,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    },
  });

  const ceilingMaterial = useStandardMaterial(ceilingFinish, {
    variant: "ceiling",
    repeatX: width / ceilingTile,
    repeatY: length / ceilingTile,
    // 마감재를 안 고른 천장은 예전처럼 흰색 — 절차적 무늬도 깔지 않는다
    fallbackColor: "#f7f7f7",
    overrides: { roughness: ceilingFinish?.roughness ?? 1 },
  });

  const walls = room.walls ?? [];

  /*
   * 층.
   * 각 층의 벽을 그 층 바닥 높이에 올려 세운다. 층이 하나뿐인 프로젝트는
   * 기준층 하나만 나오므로 예전과 똑같이 보인다.
   */
  const levels = useMemo(() => levelsOf(room), [room]);

  return (
    <group>
      {/*
        바닥은 방보다 조금 넓게 깐다.

        벽은 중심선을 기준으로 두께의 절반씩 바깥으로 나간다. 바닥을 방 치수에 딱
        맞추면 바깥벽 아래 절반에는 바닥이 없어서, 비스듬히 내려다볼 때 벽 밑으로
        배경이 비쳐 흰 선이 그어진다. 벽 두께보다 넉넉히 깔면 그 틈이 없어진다.
      */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow material={floorMaterial}>
        <planeGeometry args={[width + FLOOR_BLEED, length + FLOOR_BLEED]} />
      </mesh>

      {/* 실마다 다른 바닥재 — 기준 바닥 위에 패치로 얹는다 */}
      <AreaFloors scene={scene} room={room} />

      {/*
        뒷벽 판은 그리지 않는다.

        생성 이미지를 붙이던 면이었는데 그 기능을 걷어낸 뒤로는 실제 북측 벽 뒤에
        20mm 떨어져 서 있는 여벌 판일 뿐이다. 바깥벽을 카메라 쪽에서 숨기는 순간
        이 판이 드러나 방이 한 겹 더 있는 것처럼 보였고, 벽과 겹치는 자리에서는
        깊이가 다투어 얼룩이 생겼다.
      */}

      {/* 실측 벽체 — 층마다 바닥 높이에 올려 세운다 */}
      {levels.map((level) => {
        if (level.visible === false) return null;
        const onThisLevel = walls.filter((wall) => levelIdOf(wall, levels) === level.id);
        if (onThisLevel.length === 0) return null;

        return (
          <group key={level.id} position={[0, level.elevation * MM, 0]}>
            {/* 2층부터는 바닥판을 깔아 준다 — 없으면 가구가 허공에 뜬 것처럼 보인다 */}
            {level.elevation > 0 && (
              <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, 0.002, 0]}
                receiveShadow
                material={floorMaterial}
              >
                <planeGeometry args={[width, length]} />
              </mesh>
            )}

            {onThisLevel.map((wall) => (
              <WallMesh
                key={wall.id}
                wall={wall}
                room={room}
                finish={wallFinish}
                tile={wallTile}
                cull={cullWalls}
              />
            ))}
          </group>
        );
      })}

      {/*
        천장.

        그림자는 받지 않는다. 천장에 떨어질 그림자가 없는 데다, 걷기 모드에서
        올려다볼 때 그림자 맵을 한 면 더 계산할 이유가 없다.
      */}
      <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]} material={ceilingMaterial}>
        <planeGeometry args={[width, length]} />
      </mesh>

      {/* 걷기에서는 이름표를 끈다 — 눈앞에 카드가 떠 있으면 공간이 안 보인다 */}
      {labels && <RoomLabels room={room} />}
    </group>
  );
}

/**
 * 실 이름표.
 *
 * 실이 하나일 때는 필요 없었지만, 아파트 도면을 세우면 방이 열 개 넘게 생긴다.
 * 어느 칸이 거실이고 어느 칸이 욕실인지 3D에서 구분할 방법이 없으면 못 쓴다.
 *
 * 한글 때문에 3D 텍스트(폰트 파일이 필요하다) 대신 DOM 오버레이를 쓴다.
 */
function RoomLabels({ room }: { room: Scene["room"] }) {
  const areas = room.areas ?? [];
  // 실이 하나뿐이면 방 이름이 화면을 가리기만 한다.
  if (areas.length < 2) return null;

  return (
    <>
      {areas.map((area) => {
        const [cx, cy] = polygonCentroid(area.points);
        const [x, z] = worldFromPlan([cx, cy], room);
        const squareMeters = toSquareMeters(polygonArea(area.points));

        return (
          <Html
            key={area.id}
            position={[x, 0.05, z]}
            center
            distanceFactor={10}
            occlude={false}
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            <div className="whitespace-nowrap rounded bg-white/85 px-1.5 py-0.5 text-center shadow-sm">
              <p className="text-[11px] font-medium leading-tight text-ink">{area.name}</p>
              <p className="text-[9.5px] leading-tight text-muted">{squareMeters.toFixed(1)}㎡</p>
            </div>
          </Html>
        );
      })}
    </>
  );
}

/**
 * 벽 조각 하나.
 *
 * 조각마다 자기 길이·높이에 맞춰 반복 수를 정한다. 예전에는 벽 전체에 하나의 반복을
 * 줘서 짧은 벽에서는 무늬가 늘어지고 긴 벽에서는 잘게 눌렸다.
 *
 * 오프셋이 중요하다. 조각은 문 때문에 벽 중간에서 시작하는데, 그때마다 무늬가 0에서
 * 다시 시작하면 문 왼쪽과 오른쪽 벽지 줄이 어긋난다. 조각이 벽의 어디서 시작하는지를
 * 넘겨 주면 한 장의 벽지를 문이 가린 것처럼 이어진다.
 *
 * 조각을 컴포넌트로 뺀 이유는 훅 때문이다 — 조각마다 머티리얼이 다르므로 map 안에서
 * useStandardMaterial 을 부를 수 없다.
 */
function WallSpanMesh({
  span,
  at,
  angle,
  thickness,
  finish,
  tile,
}: {
  span: { from: number; to: number; bottom: number; top: number };
  at: (distance: number) => [number, number];
  angle: number;
  thickness: number;
  finish?: Material;
  tile: number;
}) {
  const [x, z] = at((span.from + span.to) / 2);
  const spanLength = (span.to - span.from) * MM;
  const spanHeight = (span.top - span.bottom) * MM;

  const material = useStandardMaterial(finish, {
    variant: "wall",
    repeatX: spanLength / tile,
    repeatY: spanHeight / tile,
    offsetX: (span.from * MM) / tile,
    offsetY: (span.bottom * MM) / tile,
    fallbackColor: "#efe9e0",
    fallbackTexture: paintTexture("#efe9e0", 2),
    overrides: { roughness: finish?.roughness ?? 0.95 },
  });

  return (
    <mesh
      position={[x, span.bottom * MM + spanHeight / 2, z]}
      rotation={[0, angle, 0]}
      material={material}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[spanLength, spanHeight, thickness]} />
    </mesh>
  );
}

/** 벽 하나 — 개구부를 제외한 조각들 + 문틀/창틀/유리 */
function WallMesh({
  wall,
  room,
  finish,
  tile,
  cull = true,
}: {
  wall: WallSegment;
  room: Scene["room"];
  /** 벽 마감재. 없으면 기본 도장으로 그린다 */
  finish?: Material;
  /** 텍스처 한 장이 덮는 실제 크기 (m) */
  tile: number;
  /** 카메라 앞을 가리는 바깥벽을 숨길지 */
  cull?: boolean;
}) {
  const spans = useMemo(() => wallSpans(wall), [wall]);
  const length = wallLength(wall);
  const thickness = wall.thickness * MM;
  const angle = (wallAngle(wall) * Math.PI) / 180;
  const groupRef = useRef<THREE.Group>(null);

  /** 벽 시작점 기준 거리 → 월드 XZ */
  const at = (distance: number): [number, number] =>
    worldFromPlan(pointAlongWall(wall, distance), room);

  const midpoint = useMemo(
    () => worldFromPlan(pointAlongWall(wall, wallLength(wall) / 2), room),
    [wall, room]
  );

  const perimeter = useMemo(() => isPerimeterWall(wall, room), [wall, room]);

  /**
   * 이 벽이 바깥을 보는 방향 (월드 XZ).
   *
   * 평면 좌표의 법선을 그대로 쓰면 안 된다 — 월드는 y 가 커지는 쪽이 -z 라 부호가
   * 뒤집힌다. 여기서 한 번만 뒤집고, 아래 판정은 월드 좌표로만 한다.
   */
  const outwardNormal = useMemo<[number, number]>(() => {
    const [nx, ny] = wallOutwardNormal(wall, room);
    return [nx, -ny];
  }, [wall, room]);

  /**
   * 카메라와 방 사이를 가로막는 바깥벽은 숨긴다.
   * (방 밖에서 볼 때 앞벽이 시야를 막지 않도록 — 인테리어 3D 뷰의 일반적인 동작)
   * 안쪽 칸막이는 그 방의 형태 자체라 늘 세워 둔다.
   */
  useFrame(({ camera }) => {
    const group = groupRef.current;
    if (!group) return;

    /*
     * 걷기에서는 숨기지 않는다.
     *
     * 방 안에서 눈높이로 보고 있으므로 바깥벽이 사라지면 벽 너머가 뚫려 보인다.
     * 훅 자체는 늘 등록해 둔다 — 조건으로 훅을 걸었다 뺐다 하면 호출 순서가 어긋난다.
     */
    if (!cull) {
      group.visible = true;
      return;
    }

    if (!perimeter) {
      group.visible = true;
      return;
    }

    /*
     * 위에서 내려다볼 때는 아무것도 숨기지 않는다.
     *
     * 인형집처럼 내려다보는 각도에서는 앞 바깥벽이 실제로 가리는 것이 거의 없다.
     * 그런데도 숨기면 바닥만 덩그러니 남아 도면이 부서진 것처럼 보인다. 벽을 치워야
     * 안이 보이는 것은 눈높이에 가까운 낮은 각도에서다.
     *
     * 방 중심에서 카메라를 봤을 때의 올려본각으로 가른다. 위쪽 절반(45도)을 넘어가면
     * 내려다보는 것으로 치고 전부 세워 둔다.
     */
    const horizontal = Math.hypot(camera.position.x, camera.position.z);
    const elevation = Math.atan2(camera.position.y, horizontal || 1e-6);
    if (elevation > TOP_DOWN_ANGLE) {
      group.visible = true;
      return;
    }

    /*
     * 카메라가 이 벽의 바깥쪽에 있으면 숨긴다.
     *
     * 벽 중점에서 카메라로 향하는 벡터를 벽 자신의 바깥 법선에 투영한다. 양수면
     * 카메라가 벽 너머(바깥)에 있다는 뜻이고, 그때 이 벽은 시야를 가로막는다.
     */
    const [mx, mz] = midpoint;
    const [nx, nz] = outwardNormal;
    const outward = (camera.position.x - mx) * nx + (camera.position.z - mz) * nz;
    group.visible = outward < 0.05;
  });

  return (
    <group ref={groupRef}>
      {spans.map((span, index) => (
        <WallSpanMesh
          key={`${wall.id}_${index}`}
          span={span}
          at={at}
          angle={angle}
          thickness={thickness}
          finish={finish}
          tile={tile}
        />
      ))}

      {/*
        걸레받이는 그리지 않는다.

        예전에는 벽 밑동마다 100mm 짜리 흰색(#f2f2f2) 띠를 벽보다 20mm 두껍게 둘렀다.
        벽 마감이 무엇이든 흰색이라, 바닥과 벽이 만나는 자리에 흰 줄이 한 바퀴 그어졌다 —
        걸레받이로 보이지 않고 "접합부가 뜬 것"으로 보인다. 벽보다 튀어나와 있어 빛까지
        받으니 더 도드라졌다.

        진짜 걸레받이는 마감의 일부라 벽·바닥 재질을 따라야 한다. 그 정보가 생기기
        전까지는 벽이 바닥에 그대로 닿는 편이 실제 렌더에 가깝다.
      */}

      {(wall.openings ?? []).map((opening) => {
        const center = Math.min(length, opening.offset + opening.width / 2);
        const [x, z] = at(center);
        const openWidth = opening.width * MM;
        const openHeight = opening.height * MM;
        const y = (opening.sillHeight + opening.height / 2) * MM;

        const frameColor = opening.type === "door" ? "#3d3d3d" : "#f2f2f2";
        const jamb = 0.05; // 문선·창틀 폭 50mm
        const depth = thickness * 0.7;

        return (
          <group key={opening.id} position={[x, y, z]} rotation={[0, angle, 0]}>
            {/* 좌·우 선틀 */}
            {[-1, 1].map((side) => (
              <mesh key={side} position={[side * (openWidth / 2 + jamb / 2), 0, 0]}>
                <boxGeometry args={[jamb, openHeight + jamb * 2, depth]} />
                <meshStandardMaterial color={frameColor} roughness={0.6} />
              </mesh>
            ))}
            {/* 상인방(문틀 위) — 창은 하부 틀도 함께 */}
            {(opening.type === "window" ? [1, -1] : [1]).map((side) => (
              <mesh key={`h${side}`} position={[0, side * (openHeight / 2 + jamb / 2), 0]}>
                <boxGeometry args={[openWidth + jamb * 2, jamb, depth]} />
                <meshStandardMaterial color={frameColor} roughness={0.6} />
              </mesh>
            ))}
            {/* 창유리 — 문은 열린 개구부로 둔다.
                transmission은 유리 1장마다 장면을 한 번 더 렌더하므로 쓰지 않는다. */}
            {opening.type === "window" && (
              <mesh>
                <planeGeometry args={[openWidth, openHeight]} />
                <meshStandardMaterial
                  color="#e8eaec"
                  transparent
                  opacity={0.22}
                  roughness={0.08}
                  metalness={0.1}
                  side={THREE.DoubleSide}
                />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

function SceneLights({ scene }: { scene: Scene }) {
  const height = scene.room.dimensions.height * MM;

  /*
   * 그림자 카메라를 방 크기에 맞춘다.
   *
   * 여태 [-6, 6, 6, -6] 로 박혀 있었다. 12m 를 넘는 평면에서는 그 바깥의 그림자가
   * 통째로 잘려 나가는데, 조감에서는 눈에 잘 안 띄다가 눈높이에서 걸어 보면 방 절반은
   * 그림자가 있고 절반은 없는 것이 바로 보인다.
   *
   * 맵 크기는 2048 에서 멈춘다. 더 키우면 선명해지기는 하지만 굽는 비용과 메모리가
   * 네 배가 되어 중급 휴대폰에서 감당이 안 된다.
   */
  const extent = Math.max(
    6,
    Math.hypot(scene.room.dimensions.width, scene.room.dimensions.length) * MM / 2 + 1
  );
  const shadowSize = extent > 9 ? 2048 : 1024;

  return (
    <>
      {scene.lights
        .filter((light) => light.enabled)
        .map((light) => {
          if (light.type === "ambient") {
            return (
              <ambientLight key={light.id} intensity={light.intensity * 0.5} color={light.color} />
            );
          }
          if (light.type === "directional") {
            return (
              <directionalLight
                key={light.id}
                intensity={light.intensity * 2.2}
                color={light.color}
                position={[light.position[0], Math.max(2.4, light.position[1]), light.position[2]]}
                castShadow
                shadow-mapSize={[shadowSize, shadowSize]}
                shadow-bias={-0.0004}
              >
                <orthographicCamera
                  attach="shadow-camera"
                  args={[-extent, extent, extent, -extent, 0.1, Math.max(24, extent * 3)]}
                />
              </directionalLight>
            );
          }
          return (
            <pointLight
              key={light.id}
              intensity={light.intensity * 6}
              color={light.color}
              position={[
                light.position[0],
                Math.min(height - 0.2, light.position[1]),
                light.position[2],
              ]}
              distance={10}
              decay={2}
            />
          );
        })}
    </>
  );
}

/* ────────────────────── 배치(드래그) 컨트롤러 ────────────────────── */

/**
 * 바닥 평면과의 교차점을 계산해 객체를 끌어 옮긴다.
 * 드래그 중에는 로컬 draft로 즉시 반응하고, 놓는 순간 operation 하나로 커밋한다.
 */
function PlacementController({
  scene,
  draft,
  setDraft,
}: {
  scene: Scene;
  draft: DragState | null;
  setDraft: (draft: DragState | null) => void;
}) {
  const { camera, raycaster, gl } = useThree();
  const getThree = useThree((state) => state.get);
  const runTool = useEditorStore((state) => state.runTool);
  const setViewportRaycast = useEditorStore((state) => state.setViewportRaycast);

  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const point = useMemo(() => new THREE.Vector3(), []);
  const pointer = useMemo(() => new THREE.Vector2(), []);
  const draftRef = useRef<DragState | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const roomWidth = scene.room.dimensions.width * MM;
  const roomLength = scene.room.dimensions.length * MM;

  /** 화면 좌표 → 바닥 평면 위의 Scene 좌표 */
  const raycastFloor = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gl.domElement.getBoundingClientRect();
      pointer.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(pointer, camera);
      if (!raycaster.ray.intersectPlane(plane, point)) return null;

      return {
        x: clamp01(point.x / roomWidth + 0.5),
        depth: clamp01(0.5 - point.z / roomLength),
      };
    },
    [camera, gl, plane, point, pointer, raycaster, roomWidth, roomLength]
  );

  // 좌측 패널에서 캔버스로 끌어다 놓을 때 쓰도록 스토어에 등록한다.
  useEffect(() => {
    setViewportRaycast(raycastFloor);
    return () => setViewportRaycast(null);
  }, [raycastFloor, setViewportRaycast]);

  // 드래그 중에는 카메라 회전을 막는다.
  useEffect(() => {
    const orbit = getThree().controls as { enabled?: boolean } | null;
    if (orbit) orbit.enabled = !draft;
  }, [draft, getThree]);

  useEffect(() => {
    if (!draft) return;

    const canvas = gl.domElement;

    const onMove = (event: PointerEvent) => {
      const current = draftRef.current;
      if (!current) return;
      const hit = raycastFloor(event.clientX, event.clientY);
      if (!hit) return;

      const object = scene.objects.find((o) => o.id === current.id);
      const halfWidth = object ? object.screen.width / 2 : 0;
      setDraft({
        id: current.id,
        x: clamp01(hit.x - halfWidth),
        depth: hit.depth,
      });
    };

    const onUp = async () => {
      const current = draftRef.current;
      setDraft(null);
      if (!current) return;

      const object = scene.objects.find((o) => o.id === current.id);
      if (!object) return;

      const moved =
        Math.abs(current.x - object.screen.x) > 0.002 ||
        Math.abs(current.depth - object.depth) > 0.002;
      if (!moved) return;

      await runTool("move_object", {
        objectId: current.id,
        x: current.x,
        depth: current.depth,
        snap: true,
      });
    };

    canvas.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      canvas.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [draft, gl, raycastFloor, runTool, scene.objects, setDraft]);

  return null;
}

/**
 * 카메라 초기 배치.
 *
 * <Canvas camera={...}>는 마운트할 때 한 번만 반영된다. 그런데 편집기는 장면을 받기 전에
 * 캔버스를 먼저 띄우므로, 그 순간의 카메라는 "기본 방 크기(5×6m)" 기준으로 잡힌다.
 * 그 뒤 10m짜리 아파트 평면이 들어와도 카메라는 그대로라 벽 안에 갇히고, 화면은
 * 새까맣게 남았다 — 마우스로 한 번 돌려야 비로소 방이 보였다.
 *
 * 그래서 방 크기가 정해지면 여기서 카메라를 직접 옮긴다.
 * OrbitControls는 나중에 붙기 때문에, 붙고 난 뒤 한 번 더 맞춰 준다.
 */
function CameraRig({
  target,
  position,
}: {
  target: [number, number, number];
  position: [number, number, number];
}) {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const controls = useThree((state) => state.controls) as {
    target?: { set: (x: number, y: number, z: number) => void };
    update?: () => void;
  } | null;

  useEffect(() => {
    camera.position.set(position[0], position[1], position[2]);
    camera.lookAt(target[0], target[1], target[2]);
    camera.updateProjectionMatrix();

    if (controls?.target) {
      controls.target.set(target[0], target[1], target[2]);
      controls.update?.();
    }
    // frameloop="demand"라 카메라를 옮긴 뒤 직접 한 프레임을 요청해야 한다.
    invalidate();
    (window as unknown as { __cam?: unknown }).__cam = camera;
  }, [camera, controls, invalidate, position, target]);

  return null;
}

/**
 * 그림자 맵 갱신 제어.
 *
 * 기본값은 매 프레임 그림자를 다시 굽는다. 카메라를 돌리는 동안에도 계속 다시 구워서
 * 회전이 끊겨 보였다. 그림자는 조명·물체가 움직일 때만 바뀌므로, 자동 갱신을 끄고
 * 장면이 실제로 달라졌을 때만 한 프레임 갱신한다.
 */
/* three.js 렌더러 상태는 React 값이 아니라 명령형으로 설정한다 */
function setShadowAutoUpdate(renderer: THREE.WebGLRenderer, value: boolean): void {
  renderer.shadowMap.autoUpdate = value;
}

function requestShadowUpdate(renderer: THREE.WebGLRenderer): void {
  renderer.shadowMap.needsUpdate = true;
}

function ShadowUpdater({ signature }: { signature: string }) {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    setShadowAutoUpdate(gl, false);
    return () => setShadowAutoUpdate(gl, true);
  }, [gl]);

  useEffect(() => {
    requestShadowUpdate(gl);
    invalidate();
  }, [gl, invalidate, signature]);

  return null;
}

/**
 * 카메라를 조작하는 동안에는 해상도를 낮춘다.
 *
 * 조작이 끝나면 원래 해상도로 한 프레임 더 그린다 — 움직일 때는 부드럽게,
 * 멈추면 선명하게.
 */
/**
 * 크기 변경 시 한 프레임 다시 그린다.
 *
 * frameloop="demand"라 캔버스 크기만 바뀌면 아무도 프레임을 요청하지 않아
 * 화면이 까맣게 남는다 (평면+3D 분할로 전환할 때).
 */
function ResizeRedraw() {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const element = gl.domElement.parentElement;
    if (!element) {
      invalidate();
      return;
    }

    const observer = new ResizeObserver(() => invalidate());
    observer.observe(element);
    invalidate();

    return () => observer.disconnect();
  }, [gl, invalidate]);

  return null;
}

/**
 * 기즈모 연결.
 *
 * OrbitControls는 Canvas 안에만 있고 기즈모는 바깥 HTML이라, 조작 함수를
 * 만들어 부모에게 올려 준다. 구면 좌표를 직접 돌려야 카메라가 대상 주위를
 * 자연스럽게 도는데, OrbitControls의 내부 각도를 그대로 읽어 쓴다.
 */
function GizmoBridge({
  target,
  onReady,
}: {
  target: [number, number, number];
  onReady: (handlers: GizmoHandlers | null) => void;
}) {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const controls = useThree((state) => state.controls) as
    | { target: THREE.Vector3; update: () => void }
    | null;

  useEffect(() => {
    if (!controls) return;

    const center = () => controls.target ?? new THREE.Vector3(...target);

    const apply = (change: (spherical: THREE.Spherical) => void) => {
      const focus = center();
      const offset = camera.position.clone().sub(focus);
      const spherical = new THREE.Spherical().setFromVector3(offset);

      change(spherical);

      // 바닥 아래로 내려가거나 정수리를 넘지 않게 막는다.
      spherical.phi = Math.min(Math.PI / 2.05, Math.max(0.12, spherical.phi));
      spherical.radius = Math.min(14, Math.max(1.2, spherical.radius));

      camera.position.copy(focus.clone().add(new THREE.Vector3().setFromSpherical(spherical)));
      camera.lookAt(focus);
      controls.update();
      invalidate();
    };

    const handlers: GizmoHandlers = {
      orbit: (dTheta, dPhi) =>
        apply((spherical) => {
          spherical.theta += dTheta;
          spherical.phi += dPhi;
        }),
      dolly: (delta) => apply((spherical) => (spherical.radius *= 1 - delta)),
      reset: () =>
        apply((spherical) => {
          spherical.theta = 0;
          spherical.phi = Math.PI / 2.6;
        }),
    };

    onReady(handlers);
    return () => onReady(null);
  }, [camera, controls, invalidate, onReady, target]);

  return null;
}

function AdaptiveResolution() {
  const setDpr = useThree((state) => state.setDpr);
  const controls = useThree((state) => state.controls) as
    | { addEventListener: (type: string, fn: () => void) => void; removeEventListener: (type: string, fn: () => void) => void }
    | null;

  useEffect(() => {
    if (!controls) return;

    const onStart = () => setDpr(DPR[0]);
    const onEnd = () => setDpr(DPR[1]);

    controls.addEventListener("start", onStart);
    controls.addEventListener("end", onEnd);
    return () => {
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
    };
  }, [controls, setDpr]);

  return null;
}

/** 렌더 캡처 · GLB 내보내기를 위해 3D 컨텍스트를 스토어에 등록한다 */
/**
 * WebGL 컨텍스트가 날아갔을 때.
 *
 * 휴대폰에서 다른 앱에 갔다 오면 브라우저가 GPU 자원을 회수한다. 아무 처리도 없으면
 * 캔버스가 검게 굳고 콘솔에 오류만 쌓이는데, 사용자에게는 그냥 먹통이다.
 *
 * 기본 동작은 컨텍스트를 잃으면 브라우저가 복구를 시도하지 않는 것이다. preventDefault
 * 를 불러야 복구 이벤트를 받을 수 있다. 받으면 다시 그리게 두드린다.
 */
function ContextGuard() {
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);
  /** 우리가 일부러 놓는 중인가 — 그때는 복구를 요청하지 않는다 */
  const releasing = useRef(false);

  /*
   * 떠날 때 GPU 컨텍스트를 놓아 준다.
   *
   * 브라우저는 살려 두는 WebGL 컨텍스트 수에 한계가 있다(크롬은 16개쯤). 캔버스를
   * 헐어도 컨텍스트는 가비지 컬렉션이 돌 때까지 남아 있어서, 보기를 몇 번 오가면
   * 한도를 넘고 브라우저가 **가장 오래된 것부터 강제로 죽인다.** 그러면 지금 보고 있는
   * 화면이 아니라 예전 것이 죽는 것처럼 보이는데, 실제로는 지금 것이 죽어 화면이
   * 멈춘다 — 콘솔에는 우리 경고 없이 three.js 의 "Context Lost." 만 남는다.
   *
   * dispose() 만으로는 컨텍스트가 안 풀린다. forceContextLoss() 를 함께 불러야 한다.
   */
  useEffect(() => {
    return () => {
      releasing.current = true;
      try {
        gl.dispose();
        gl.forceContextLoss();
      } catch {
        /* 이미 놓인 컨텍스트면 더 할 일이 없다 */
      }
    };
  }, [gl]);

  useEffect(() => {
    const canvas = gl.domElement;

    const onLost = (event: Event) => {
      /* 우리가 떠나면서 놓는 중이면 복구를 부탁하지 않는다 — 되살려 봐야 버려질 캔버스다 */
      if (releasing.current) return;

      // 이걸 불러야 브라우저가 복구를 시도한다
      event.preventDefault();
      console.warn("[3d] WebGL 컨텍스트를 잃었습니다 — 복구를 기다립니다.");
    };

    const onRestored = () => {
      console.warn("[3d] WebGL 컨텍스트가 복구됐습니다.");
      invalidate();
    };

    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [gl, invalidate]);

  return null;
}

function CanvasBridge() {
  const { gl, scene, camera } = useThree();
  const setCapture = useEditorStore((state) => state.setViewportCapture);
  const setExport = useEditorStore((state) => state.setViewportExport);

  useEffect(() => {
    setCapture(() => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL("image/png");
    });

    setExport(async () => {
      const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
      const exporter = new GLTFExporter();
      const result = await exporter.parseAsync(scene, {
        binary: true,
        onlyVisible: true,
      });
      return new Blob([result as ArrayBuffer], { type: "model/gltf-binary" });
    });

    return () => {
      setCapture(null);
      setExport(null);
    };
  }, [gl, scene, camera, setCapture, setExport]);

  return null;
}

/* ───────────────────────────── 메인 ───────────────────────────── */

/**
 * 3D 뷰 — 조감(orbit)과 걷기(walk) 두 가지.
 *
 * 걷기는 같은 장면을 눈높이에서 보는 것뿐이라 방·가구·조명·재질을 그대로 쓴다.
 * 달라지는 것은 카메라를 누가 모느냐와, 편집 UI 를 붙이느냐뿐이다. 그래서 조감 경로는
 * 한 줄도 옮기지 않고 조건부 렌더링만 더한다 — 잘 돌던 것을 건드리면 둘 다 잃는다.
 */
export function Canvas3D({ mode = "orbit" }: { mode?: "orbit" | "walk" }) {
  const scene = useEditorStore((state) => state.scene);
  const select = useEditorStore((state) => state.select);
  const setViewMode = useEditorStore((state) => state.setViewMode);
  const activeLevelId = useEditorStore((state) => state.activeLevelId);

  const walking = mode === "walk";

  const [draft, setDraft] = useState<DragState | null>(null);
  const [gizmo, setGizmo] = useState<GizmoHandlers | null>(null);

  /* 걷기 상태 — 드물게 바뀌는 값만 리액트에 둔다. 매 프레임 값은 ref 로 WalkController 안에 있다 */
  const [locked, setLocked] = useState(false);
  const [fallbackDrag, setFallbackDrag] = useState(false);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [cooldown, setCooldown] = useState(false);

  /*
   * 프레임 계기판.
   *
   * 끊김은 느낌으로 못 고친다. 평균이 12ms 인데 가끔 60ms 가 끼는 것과 평균이 25ms 로
   * 고른 것은 원인도 대책도 다르다. 개발 모드에서 ?stats=1 을 붙였을 때만 띄운다 —
   * 프로덕션 번들에는 아예 들어가지 않도록 상수로 가른다.
   */
  const showStats =
    process.env.NODE_ENV !== "production" &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("stats") === "1";

  /*
   * 키보드·마우스·손가락이 함께 쓰는 입력 그릇.
   *
   * ref 하나를 컨트롤러와 화면 조작부가 나눠 쓴다. store 나 context 에 두면 값이
   * 바뀔 때마다 구독자가 리렌더되는데, 이건 손가락을 움직이는 내내 바뀌는 값이다.
   */
  const walkInput = useRef(createWalkInput());

  const roomWidth = (scene?.room?.dimensions.width ?? 5000) * MM;
  const roomLength = (scene?.room?.dimensions.length ?? 6000) * MM;
  const roomHeight = (scene?.room?.dimensions.height ?? 2700) * MM;
  const fov = scene?.camera?.fov ?? 50;

  const target = useMemo<[number, number, number]>(() => [0, roomHeight * 0.35, 0], [roomHeight]);

  /*
   * 처음 보이는 시점.
   *
   * 예전에는 앞벽에서 2.6m 뒤에 눈높이로 고정돼 있었다. 방 하나짜리에는 맞지만
   * 가로 10m가 넘는 아파트 평면에서는 벽 한 장이 화면을 다 덮어 아무것도 안 보였다
   * (3D를 열면 새까만 화면이 나오던 것이 이것이다).
   *
   * 바닥 전체가 화각에 들어올 만큼 물러서고, 넓을수록 높이 올라가 내려다본다.
   */
  const cameraConfig = useMemo(() => {
    const radius = Math.hypot(roomWidth, roomLength) / 2;
    const fit = radius / Math.tan((fov * Math.PI) / 360);

    const distance = Math.max(roomLength / 2 + 2.6, fit * 0.85);
    const elevation = Math.max(roomHeight * 0.55, distance * 0.55);

    return {
      position: [0, elevation, distance] as [number, number, number],
      fov,
      near: 0.05,
      // 넓은 평면에서는 뒤로 많이 물러서므로 먼 클리핑도 함께 늘린다.
      far: Math.max(60, distance * 4),
    };
  }, [roomWidth, roomLength, roomHeight, fov]);

  const onDragStart = useCallback((_event: ThreeEvent<PointerEvent>, object: SceneObject) => {
    setDraft({ id: object.id, x: object.screen.x, depth: object.depth });
  }, []);


  // 마감재·모델이 다 올 때까지 덮개를 씌운다 (빈 회색 화면은 고장으로 보인다)
  const { ready, onDrawn } = useSceneReady(scene.sceneId);
  const host = useRef<HTMLDivElement | null>(null);
  useCanvasSize(host);

  /*
   * 걷는 동안 장면을 붙잡아 둔다.
   *
   * store 의 scene 은 참조가 바뀔 때마다 이 컴포넌트를 통째로 다시 그리게 한다. 그런데
   * 걷는 중에도 백그라운드 잡(렌더·분석) 폴링이 끝나면 store 가 scene 을 새 객체로
   * 갈아끼운다 — 내용이 같아도 참조가 달라서, 걷다가 갑자기 방 전체가 다시 계산되고
   * ContactShadows 는 key 가 바뀌어 리마운트되며 한 프레임이 통째로 튄다.
   *
   * 걷기에서는 편집이 없으므로 진입 시점의 장면을 그대로 써도 안전하다. 나가면 다시
   * 최신 장면을 본다.
   *
   * 의존성으로 쓰는 값이 조금 특이하다. 걷지 않을 때는 scene 자체라 바뀔 때마다 새로
   * 집고, 걷는 동안에는 고정된 문자열이라 그때 집은 것을 그대로 들고 있는다.
   */
  const holdKey = walking ? "walking" : scene;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shownScene = useMemo(() => scene, [holdKey]);

  /*
   * 벽 개구부가 된 창·문은 벽이 이미 그리고 있다 (WallMesh의 창틀·유리).
   * 객체로 또 그리면 같은 창문이 두 개로 보인다. 평면도(toPlanData)와 같은 기준으로 뺀다.
   *
   * 조기 반환보다 위에 둔다 — 훅은 어떤 렌더에서도 같은 순서로 불려야 한다.
   */
  const objects = useMemo(() => {
    if (!shownScene?.room) return [];
    const converted = openingObjectIds(shownScene.room);
    return shownScene.objects.filter((object) => object.visibility && !converted.has(object.id));
  }, [shownScene]);

  /*
   * 그림자를 다시 구워야 하는 시점을 판단하는 값.
   * 물체의 위치·크기·개수와 방 치수가 바뀔 때만 달라진다 (카메라 이동은 포함하지 않는다).
   */
  const shadowSignature = useMemo(
    () =>
      objects
        .map((object) => `${object.id}:${object.screen.x}:${object.depth}:${object.transform.scale[1]}`)
        .join("|")
        .concat(`#${roomWidth}x${roomLength}`),
    [objects, roomWidth, roomLength]
  );

  /** 걷기가 쓸 층 — 층 탭에서 고른 것이 있으면 그것, 없으면 기준층 */
  const levelId = useMemo(() => {
    if (!shownScene?.room) return null;
    return activeLevelId ?? levelsOf(shownScene.room)[0]?.id ?? null;
  }, [shownScene, activeLevelId]);


  if (!scene?.room) return null;


  return (
    <div ref={host} className="relative h-full w-full bg-[linear-gradient(#e9e8e5,#cfcdc8)]">
      {!ready && <LoadingVeil />}
      <Canvas
        shadows
        // 가만히 두면 프레임을 그리지 않는다. 카메라 조작·드래그·상태 변경 때만 렌더한다.
        /*
         * 매 프레임 그린다.
         *
         * 예전에는 frameloop="demand"로 GPU를 아꼈는데, 그 대가가 너무 컸다 —
         * 3D를 열면 첫 프레임을 그릴 계기를 놓쳐 빈 화면이 그대로 멈춰 있었고,
         * 마우스로 한 번 돌려야 비로소 방이 나타났다. 카메라·컨트롤·텍스처·모델이
         * 저마다 다른 시점에 준비되는 탓이라, 어디서 invalidate를 걸어도 새는 구멍이
         * 남았다. 편집기 뷰포트는 계속 보고 있는 화면이니 그냥 계속 그린다.
         */
        frameloop="always"
        dpr={DPR}
        gl={GL_CONFIG}
        camera={cameraConfig}
        onCreated={({ camera }) => camera.lookAt(...target)}
        // 걷기에서 빈 곳 클릭은 마우스 잠금을 거는 동작이다 — 선택 해제가 아니다
        onPointerMissed={walking ? undefined : () => select([])}
      >
        <CanvasBridge />
        <ContextGuard />
        <FirstFrames onDrawn={onDrawn} />
        <RenderPump signature={shadowSignature} />

        <SceneLights scene={shownScene} />
        <directionalLight position={[-3, 3.2, 3]} intensity={0.5} color="#ffe9cf" />

        <Environment resolution={128} frames={1}>
          <Lightformer intensity={2.6} color="#fff3e2" position={[-3, 2.4, 2]} scale={[6, 4, 1]} />
          <Lightformer intensity={1.2} color="#e8f0ff" position={[3, 2.2, -2]} scale={[5, 3, 1]} />
          <Lightformer
            intensity={0.9}
            color="#ffffff"
            position={[0, 4, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            scale={[8, 8, 1]}
          />
        </Environment>

        <RoomShell scene={shownScene} labels={!walking} cullWalls={!walking} />

        {objects.map((object) => (
          <group
            key={object.id}
            // 가구는 자기 층 바닥 위에 놓인다.
            position={[
              0,
              (levelsOf(shownScene.room).find((level) => level.id === object.levelId)?.elevation ?? 0) *
                MM,
              0,
            ]}
          >
            <ObjectMesh
              scene={shownScene}
              object={object}
              draft={draft}
              onDragStart={onDragStart}
              interactive={!walking}
            />
          </group>
        ))}

        {/*
          접지 그림자. frames를 주지 않으면 매 프레임 렌더 타깃을 다시 그려서
          카메라를 돌릴 때 가장 크게 끊긴다. 장면이 바뀔 때만 다시 굽도록 key로 묶는다.
        */}
        <ContactShadows
          key={shadowSignature}
          frames={1}
          position={[0, 0.005, 0]}
          scale={Math.max(6, roomLength + 2)}
          opacity={0.5}
          blur={2}
          far={3}
          resolution={256}
          color="#2a231c"
        />

        {/*
          카메라를 누가 모느냐만 다르다.

          조감은 OrbitControls 가, 걷기는 WalkController 가 카메라를 잡는다. 둘을 같이
          띄우면 서로 카메라를 되돌려 화면이 떨린다. 기즈모·배치 컨트롤러·해상도 거버너는
          전부 조감의 조작을 전제로 만들어진 것이라 걷기에서는 달지 않는다.
        */}
        {!walking && (
          <>
            <OrbitControls
              makeDefault
              target={target}
              maxPolarAngle={Math.PI / 2.05}
              minDistance={1.2}
              maxDistance={14}
              // 관성을 주면 프레임이 조금 건너뛰어도 움직임이 끊겨 보이지 않는다.
              enableDamping
              dampingFactor={0.12}
              rotateSpeed={0.75}
              zoomSpeed={0.8}
            />
            <CameraRig target={target} position={cameraConfig.position} />
            <AdaptiveResolution />
            <GizmoBridge target={target} onReady={setGizmo} />
            <PlacementController scene={scene} draft={draft} setDraft={setDraft} />
          </>
        )}

        {walking && levelId && (
          <WalkController
            scene={shownScene}
            levelId={levelId}
            enabled={ready}
            inputRef={walkInput}
            onLockChange={setLocked}
            onFallback={setFallbackDrag}
            onCooldown={setCooldown}
            onRoomChange={setRoomName}
          />
        )}
        {walking && showStats && <WalkStats />}

        <ShadowUpdater signature={shadowSignature} />
        <ResizeRedraw />
      </Canvas>

      {walking ? (
        <>
          <WalkTouchControls
            inputRef={walkInput}
            enabled={ready}
            onFirstTouch={() => setTouched(true)}
          />
          <WalkOverlay
            locked={locked}
            fallbackDrag={fallbackDrag}
            roomName={roomName}
            touched={touched}
            cooldown={cooldown}
            onExit={() => setViewMode("3d")}
          />
        </>
      ) : (
        <NavGizmo handlers={gizmo} />
      )}

      <div
        className={[
          "absolute bottom-3 left-[172px] flex flex-wrap gap-2",
          // 걷기에서는 조작 안내가 필요 없다
          walking ? "hidden" : "",
        ].join(" ")}
      >
        <span className="rounded border border-line bg-surface/90 px-2 py-1 text-[11px] text-muted shadow-sm">
          객체를 끌어서 배치 · 빈 곳 드래그로 회전 · 휠 확대
        </span>
      </div>
    </div>
  );
}


/**
 * 장면이 다 준비됐는지.
 *
 * 3D를 처음 열면 마감재 사진과 가구 메시를 받아오느라 한참 걸린다 — 개발 서버에서는
 * 30초 가까이 걸렸다. 그동안 빈 회색 화면만 있으면 고장 난 것처럼 보이므로 덮개를
 * 씌워 둔다.
 *
 * 텍스처가 하나 도착할 때마다 기다림을 다시 연장하고, 더 이상 도착하지 않으면 그때
 * 준비된 것으로 본다. 몇 장이 올지는 미리 알 수 없어서 개수로는 셀 수 없다.
 */
function useSceneReady(sceneId: string) {
  const [quiet, setQuiet] = useState(false);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    setQuiet(false);
    setDrawn(false);

    let timer = window.setTimeout(() => setQuiet(true), SETTLE_MS);
    const stop = onTextureReady(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setQuiet(true), SETTLE_MS);
    });

    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, [sceneId]);

  /*
   * 텍스처가 조용해졌다고 화면에 그려진 것은 아니다.
   *
   * 두 번째 열 때는 텍스처가 이미 캐시에 있어 아무 소식도 오지 않는다. 그러면 덮개가
   * 0.9초 만에 걷히는데 캔버스는 아직 첫 프레임을 그리기 전이라, 가리려던 회색 화면이
   * 그대로 드러난다. 그래서 실제로 몇 프레임 그려진 것까지 확인한 다음에 걷는다.
   */
  return { ready: quiet && drawn, onDrawn: useCallback(() => setDrawn(true), []) };
}

/** 캔버스가 실제로 그리기 시작했는지 알린다 */
function FirstFrames({ onDrawn }: { onDrawn: () => void }) {
  const count = useRef(0);
  const compiled = useRef(false);

  useFrame(({ gl, scene, camera }) => {
    count.current += 1;

    /*
     * 덮개를 걷기 직전에 셰이더를 미리 굽는다.
     *
     * three 는 물체가 화면에 처음 들어올 때 그 머티리얼의 셰이더를 컴파일한다. 그래서
     * 걷다가 고개를 돌리는 순간, 그제야 보이는 벽이나 가구 때문에 프레임이 툭 끊긴다 —
     * 눈높이에서 도는 중에 이게 나면 멀미가 난다.
     *
     * compile 은 아직 안 보이는 각도의 것까지 한 번에 굽는다. 덮개가 덮여 있는 동안
     * 끝내면 사용자는 그 비용을 못 느낀다.
     */
    if (!compiled.current && count.current === 2) {
      compiled.current = true;
      gl.compile(scene, camera);
    }

    if (count.current === 3) onDrawn();
  });

  return null;
}


/**
 * 캔버스가 제 크기를 못 잡고 멈추는 것을 푼다.
 *
 * 3D를 열면 캔버스가 300×150(기본값) 그대로 멈춰 있는 일이 있다. 그러면 아무것도
 * 그려지지 않아 회색 화면만 남는데, 마우스로 창을 흔들거나 resize 이벤트가 한 번
 * 오면 그제야 제 크기를 잡고 방이 나타난다. 이 세션에서 "3D가 빈 화면"으로 보였던
 * 일들이 대부분 이것이었다.
 *
 * react-use-measure의 관찰자가 첫 측정을 놓치는 것이라, 우리가 크기를 직접 견줘 보고
 * 어긋나 있으면 resize를 한 번 흘려 준다. 맞으면 바로 멈춘다.
 */
function useCanvasSize(host: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    let tries = 0;

    const timer = window.setInterval(() => {
      const box = host.current;
      const canvas = box?.querySelector("canvas");
      if (!box || !canvas) return;

      const wanted = box.clientWidth;
      if (wanted <= 0) return;

      // 폭이 얼추 맞으면 제대로 잡은 것이다
      if (Math.abs(canvas.clientWidth - wanted) <= 2 || tries >= 20) {
        window.clearInterval(timer);
        return;
      }

      tries += 1;
      window.dispatchEvent(new Event("resize"));
    }, 120);

    return () => window.clearInterval(timer);
  }, [host]);
}

/** 마지막 텍스처가 도착하고 이만큼 조용하면 다 온 것으로 본다 */
const SETTLE_MS = 900;

/** 3D를 여는 동안 덮어 두는 화면 */
function LoadingVeil() {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 6000);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-[linear-gradient(#e9e8e5,#cfcdc8)]">
      <div className="flex flex-col items-center gap-3">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-line-strong border-t-transparent" />
        <p className="text-[12.5px] text-ink-soft">3D 장면을 준비하고 있습니다</p>
        {slow && (
          <p className="max-w-[260px] text-center text-[11.5px] leading-relaxed text-muted">
            마감재 사진과 가구 모델을 받아오는 중입니다. 처음 여는 장면은 시간이 좀 걸립니다.
          </p>
        )}
      </div>
    </div>
  );
}
