"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Environment, Html, Lightformer, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useEditorStore } from "@/lib/editor/store";
import type { Scene, SceneObject, WallSegment } from "@/scene/types";
import { FurnitureMesh } from "./FurnitureMesh";
import { NavGizmo, type GizmoHandlers } from "./NavGizmo";
import { imageTexture, onTextureReady, woodTexture, paintTexture } from "./textures";
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
}: {
  scene: Scene;
  object: SceneObject;
  draft: DragState | null;
  onDragStart: (event: ThreeEvent<PointerEvent>, object: SceneObject) => void;
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
      onClick={(event) => {
        event.stopPropagation();
        select([object.id]);
      }}
      onPointerDown={(event) => {
        if (object.locked) return;
        event.stopPropagation();
        select([object.id]);
        onDragStart(event, object);
      }}
    >
      <FurnitureMesh
        object={object}
        material={material}
        selected={selectedIds.includes(object.id)}
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

/** 텍스처가 하나 도착할 때마다 올라가는 값 — 이 값을 의존성에 넣어 다시 계산한다 */
function useTextureGeneration(): number {
  const [generation, setGeneration] = useState(0);
  useEffect(() => onTextureReady(() => setGeneration((value) => value + 1)), []);
  return generation;
}

/* ───────────────────────────── 공간 ───────────────────────────── */

/** 생성된 AI 이미지를 뒷벽에 붙인다 */
function GeneratedBackdrop({ scene, url }: { scene: Scene; url: string }) {
  // three의 TextureLoader가 이 경로에서 이미지를 못 물어 오는 경우가 있어
  // 이미지 엘리먼트로 직접 받은 뒤 텍스처로 감싼다.
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onerror = () => console.warn("[backdrop] 배경 이미지를 불러오지 못했습니다:", url);
    image.onload = () => {
      if (cancelled) return;
      const created = new THREE.Texture(image);
      created.colorSpace = THREE.SRGBColorSpace;
      created.needsUpdate = true;
      setTexture(created);
    };
    image.src = url;

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!texture) return null;

  const width = scene.room.dimensions.width * MM;
  const height = scene.room.dimensions.height * MM;
  const length = scene.room.dimensions.length * MM;

  return (
    <mesh position={[0, height / 2, -length / 2 + 0.03]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

/** 평면 좌표(mm, 좌하단 원점) → 3D 월드 좌표(m, 방 중심 원점) */
function worldFromPlan([x, y]: [number, number], room: Scene["room"]): [number, number] {
  return [(x - room.dimensions.width / 2) * MM, (room.dimensions.length / 2 - y) * MM];
}

function RoomShell({ scene }: { scene: Scene }) {
  const room = useMemo(() => ensureRoom(scene.room), [scene.room]);
  // 사진이 도착하면 절차적 텍스처에서 사진으로 바꿔 단다.
  const textureGeneration = useTextureGeneration();
  const width = room.dimensions.width * MM;
  const length = room.dimensions.length * MM;
  const height = room.dimensions.height * MM;

  /*
   * 바닥·벽 마감.
   *
   * Scene에 사진 텍스처가 붙은 마감재(CC0 PBR)가 들어와 있으면 그것을 쓴다.
   * 텍스처 한 장이 덮는 실제 크기(scale, m)를 알고 있으므로, 방 크기로 나눠
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

  const floorColor = floorFinish?.baseColor ?? "#c9a173";
  const wallColor = wallFinish?.baseColor ?? "#efe9e0";

  const floorMap = useMemo(() => {
    const tiles = Math.max(1, Math.round(Math.max(width, length) / (floorFinish?.scale || 2)));
    return floorFinish?.textureUrl
      ? imageTexture(floorFinish.textureUrl, { repeat: tiles })
      : woodTexture(floorColor, 4);
  }, [floorFinish, floorColor, width, length, textureGeneration]);

  const wallMap = useMemo(() => {
    const tiles = Math.max(1, Math.round(Math.max(width, height) / (wallFinish?.scale || 4)));
    return wallFinish?.textureUrl
      ? imageTexture(wallFinish.textureUrl, { repeat: tiles })
      : paintTexture(wallColor, 2);
  }, [wallFinish, wallColor, width, height, textureGeneration]);

  const walls = room.walls ?? [];

  /*
   * 층.
   * 각 층의 벽을 그 층 바닥 높이에 올려 세운다. 층이 하나뿐인 프로젝트는
   * 기준층 하나만 나오므로 예전과 똑같이 보인다.
   */
  const levels = useMemo(() => levelsOf(room), [room]);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial map={floorMap} color={floorColor} roughness={0.55} metalness={0.02} />
      </mesh>

      {/* 뒷벽 — 생성 이미지 배경이 붙는 면. 벽 편집과 무관하게 항상 둔다. */}
      <mesh position={[0, height / 2, -length / 2 - 0.02]} receiveShadow>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial map={wallMap} color={wallColor} roughness={0.95} />
      </mesh>

      {/* 실측 벽체 — 층마다 바닥 높이에 올려 세운다 */}
      {levels.map((level) => {
        if (level.visible === false) return null;
        const onThisLevel = walls.filter((wall) => levelIdOf(wall, levels) === level.id);
        if (onThisLevel.length === 0) return null;

        return (
          <group key={level.id} position={[0, level.elevation * MM, 0]}>
            {/* 2층부터는 바닥판을 깔아 준다 — 없으면 가구가 허공에 뜬 것처럼 보인다 */}
            {level.elevation > 0 && (
              <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} receiveShadow>
                <planeGeometry args={[width, length]} />
                <meshStandardMaterial map={floorMap} color={floorColor} roughness={0.6} />
              </mesh>
            )}

            {onThisLevel.map((wall) => (
              <WallMesh key={wall.id} wall={wall} room={room} color={wallColor} map={wallMap} />
            ))}
          </group>
        );
      })}

      <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial color="#f7f7f7" roughness={1} />
      </mesh>

      <RoomLabels room={room} />
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

/** 벽 하나 — 개구부를 제외한 조각들 + 문틀/창틀/유리 */
function WallMesh({
  wall,
  room,
  color,
  map,
}: {
  wall: WallSegment;
  room: Scene["room"];
  color: string;
  map?: THREE.Texture;
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
   * 카메라와 방 사이를 가로막는 바깥벽은 숨긴다.
   * (방 밖에서 볼 때 앞벽이 시야를 막지 않도록 — 인테리어 3D 뷰의 일반적인 동작)
   * 안쪽 칸막이는 그 방의 형태 자체라 늘 세워 둔다.
   */
  useFrame(({ camera }) => {
    const group = groupRef.current;
    if (!group) return;

    if (!perimeter) {
      group.visible = true;
      return;
    }

    const [mx, mz] = midpoint;
    const scale = Math.hypot(mx, mz) || 1;
    const outward = ((camera.position.x - mx) * mx + (camera.position.z - mz) * mz) / scale;
    group.visible = outward < 0.05;
  });

  return (
    <group ref={groupRef}>
      {spans.map((span, index) => {
        const [x, z] = at((span.from + span.to) / 2);
        const spanLength = (span.to - span.from) * MM;
        const spanHeight = (span.top - span.bottom) * MM;
        return (
          <mesh
            key={`${wall.id}_${index}`}
            position={[x, span.bottom * MM + spanHeight / 2, z]}
            rotation={[0, angle, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[spanLength, spanHeight, thickness]} />
            <meshStandardMaterial map={map} color={color} roughness={0.95} />
          </mesh>
        );
      })}

      {/* 걸레받이 — 개구부가 없는 구간에만 */}
      {spans
        .filter((span) => span.bottom === 0)
        .map((span, index) => {
          const [x, z] = at((span.from + span.to) / 2);
          return (
            <mesh key={`${wall.id}_base_${index}`} position={[x, 0.05, z]} rotation={[0, angle, 0]}>
              <boxGeometry args={[(span.to - span.from) * MM, 0.1, thickness + 0.02]} />
              <meshStandardMaterial color="#f2f2f2" roughness={0.7} />
            </mesh>
          );
        })}

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
                shadow-mapSize={[1024, 1024]}
                shadow-bias={-0.0004}
              >
                <orthographicCamera attach="shadow-camera" args={[-6, 6, 6, -6, 0.1, 24]} />
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

export function Canvas3D() {
  const scene = useEditorStore((state) => state.scene);
  const select = useEditorStore((state) => state.select);
  const showBackdrop = useEditorStore((state) => state.showBackdrop);
  const toggleBackdrop = useEditorStore((state) => state.toggleBackdrop);

  const [draft, setDraft] = useState<DragState | null>(null);
  const [gizmo, setGizmo] = useState<GizmoHandlers | null>(null);

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

  /*
   * 장면이 자리를 잡는 동안은 매 프레임 그린다.
   *
   * frameloop="demand"는 GPU를 아끼지만, 3D를 여는 순간에는 아직 아무것도 준비돼
   * 있지 않다. 특히 마감재 사진은 한 장에 700KB씩이라 늦게 도착하는데, 그 전에
   * 그린 프레임은 map이 비어 있어 벽이 새까맣게 나온다 — 마우스로 한 번 돌려야
   * 비로소 제대로 보였다.
   *
   * 그래서 텍스처가 하나 도착할 때마다 이 창을 다시 연장하고, 더 이상 도착하지
   * 않으면 그때 요청 기반으로 돌아간다. 다 받고 나면 평소처럼 조용해진다.
   */
  const [settling, setSettling] = useState(true);
  const settleUntil = useRef(0);

  useEffect(() => {
    let timer = 0;

    const extend = () => {
      settleUntil.current = Date.now() + 1500;
      setSettling(true);

      window.clearTimeout(timer);
      timer = window.setTimeout(function check() {
        if (Date.now() >= settleUntil.current) setSettling(false);
        else timer = window.setTimeout(check, 300);
      }, 1500);
    };

    extend();
    const stop = onTextureReady(extend);

    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, [scene?.sceneId, scene?.room?.dimensions.width, scene?.room?.dimensions.length]);

  if (!scene?.room) return null;

  /*
   * 벽 개구부가 된 창·문은 벽이 이미 그리고 있다 (WallMesh의 창틀·유리).
   * 객체로 또 그리면 같은 창문이 두 개로 보인다. 평면도(toPlanData)와 같은 기준으로 뺀다.
   */
  const converted = openingObjectIds(scene.room);
  const objects = scene.objects.filter(
    (object) => object.visibility && !converted.has(object.id)
  );

  /*
   * 그림자를 다시 구워야 하는 시점을 판단하는 값.
   * 물체의 위치·크기·개수와 방 치수가 바뀔 때만 달라진다 (카메라 이동은 포함하지 않는다).
   */
  const shadowSignature = objects
    .map((object) => `${object.id}:${object.screen.x}:${object.depth}:${object.transform.scale[1]}`)
    .join("|")
    .concat(`#${scene.room.dimensions.width}x${scene.room.dimensions.length}`);
  const backdropUrl = scene.source.generatedImageUrl ?? scene.source.imageUrl;
  const backdropOn = showBackdrop && Boolean(backdropUrl);

  return (
    <div className="h-full w-full bg-[linear-gradient(#e9e8e5,#cfcdc8)]">
      <Canvas
        shadows
        // 가만히 두면 프레임을 그리지 않는다. 카메라 조작·드래그·상태 변경 때만 렌더한다.
        frameloop={settling ? "always" : "demand"}
        dpr={DPR}
        gl={GL_CONFIG}
        camera={cameraConfig}
        onCreated={({ camera }) => camera.lookAt(...target)}
        onPointerMissed={() => select([])}
      >
        <CanvasBridge />
        <RenderPump signature={shadowSignature} />

        <SceneLights scene={scene} />
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

        <RoomShell scene={scene} />
        {backdropOn && backdropUrl && <GeneratedBackdrop scene={scene} url={backdropUrl} />}

        {objects.map((object) => (
          <group
            key={object.id}
            // 가구는 자기 층 바닥 위에 놓인다.
            position={[
              0,
              (levelsOf(scene.room).find((level) => level.id === object.levelId)?.elevation ?? 0) *
                MM,
              0,
            ]}
          >
            <ObjectMesh
              scene={scene}
              object={object}
              draft={draft}
              onDragStart={onDragStart}
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
        <ShadowUpdater signature={shadowSignature} />
        <AdaptiveResolution />
        <GizmoBridge target={target} onReady={setGizmo} />
        <ResizeRedraw />
        <PlacementController scene={scene} draft={draft} setDraft={setDraft} />
      </Canvas>

      <NavGizmo handlers={gizmo} />

      <div className="absolute bottom-3 left-[172px] flex flex-wrap gap-2">
        <span className="rounded border border-line bg-surface/90 px-2 py-1 text-[11px] text-muted shadow-sm">
          객체를 끌어서 배치 · 빈 곳 드래그로 회전 · 휠 확대
        </span>
        <button
          type="button"
          onClick={toggleBackdrop}
          disabled={!backdropUrl}
          className={[
            "rounded px-2 py-1 text-[11px] transition-colors disabled:opacity-50",
            backdropOn ? "bg-accent text-white" : "border border-line bg-surface/90 text-muted hover:text-ink",
          ].join(" ")}
        >
          {backdropUrl
            ? backdropOn
              ? "생성 이미지 켜짐"
              : "생성 이미지 꺼짐"
            : "생성 이미지 없음"}
        </button>
      </div>
    </div>
  );
}
