"use client";

import { useEffect, useMemo } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  AccumulativeShadows,
  ContactShadows,
  Environment,
  Lightformer,
  OrbitControls,
  RandomizedLight,
} from "@react-three/drei";
import * as THREE from "three";
import { useEditorStore } from "@/lib/editor/store";
import type { Scene, SceneObject } from "@/scene/types";
import { FurnitureMesh } from "./FurnitureMesh";
import { woodTexture, paintTexture } from "./textures";

/**
 * 3D 뷰.
 *
 * 실사감을 위해 ACES 톤매핑 + 소프트 섀도우 + 컨택트 섀도우 + 절차적 IBL 환경을 쓴다.
 * (HDR 파일 같은 외부 에셋을 받지 않으므로 배포 환경에서 네트워크 의존성이 없다)
 */

const MM = 0.001;

/** 2.5D 화면 좌표를 바닥 평면 위치로 변환한다 */
function worldPosition(object: SceneObject, room: Scene["room"]): [number, number, number] {
  const roomWidth = room.dimensions.width * MM;
  const roomLength = room.dimensions.length * MM;

  const x = (object.screen.x + object.screen.width / 2 - 0.5) * roomWidth;
  const z = (0.5 - object.depth) * roomLength;
  const y = (object.dimensions.height * MM * object.transform.scale[1]) / 2;

  // 벽에 붙는 요소는 바닥이 아니라 화면 높이를 따른다.
  if (object.type === "window" || object.type === "decoration" || object.type === "tv") {
    const roomHeight = room.dimensions.height * MM;
    const wallY = (1 - (object.screen.y + object.screen.height / 2)) * roomHeight;
    return [x, Math.max(0.3, wallY), -roomLength / 2 + 0.06];
  }

  return [x, y, z];
}

function ObjectMesh({ scene, object }: { scene: Scene; object: SceneObject }) {
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const select = useEditorStore((state) => state.select);

  const material = scene.materials.find((m) => m.id === object.materialId);
  const position = worldPosition(object, scene.room);

  return (
    <group
      position={position}
      rotation={[0, (-object.screen.rotation * Math.PI) / 180, 0]}
      onClick={(event) => {
        event.stopPropagation();
        select([object.id]);
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

function RoomShell({ scene }: { scene: Scene }) {
  const width = scene.room.dimensions.width * MM;
  const length = scene.room.dimensions.length * MM;
  const height = scene.room.dimensions.height * MM;

  const floorMaterial = scene.materials.find((m) => m.tags?.includes("floor"));
  const floorColor = floorMaterial?.baseColor ?? "#c9a173";
  const wallColor =
    scene.materials.find((m) => m.tags?.includes("wall"))?.baseColor ?? "#efe9e0";

  const floorMap = woodTexture(floorColor, 4);
  const wallMap = paintTexture(wallColor, 2);

  return (
    <group>
      {/* 바닥 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial map={floorMap} color={floorColor} roughness={0.55} metalness={0.02} />
      </mesh>

      {/* 뒷벽 · 좌측벽 · 우측벽 */}
      <mesh position={[0, height / 2, -length / 2]} receiveShadow>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial map={wallMap} color={wallColor} roughness={0.95} />
      </mesh>
      <mesh position={[-width / 2, height / 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[length, height]} />
        <meshStandardMaterial map={wallMap} color={wallColor} roughness={0.95} />
      </mesh>
      <mesh position={[width / 2, height / 2, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[length, height]} />
        <meshStandardMaterial map={wallMap} color={wallColor} roughness={0.95} />
      </mesh>

      {/* 천장 */}
      <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial color="#f6f3ee" roughness={1} />
      </mesh>

      {/* 걸레받이 — 벽/바닥 경계가 있어야 실내처럼 보인다 */}
      {(
        [
          [0, 0.05, -length / 2 + 0.01, width, 0],
          [-width / 2 + 0.01, 0.05, 0, length, Math.PI / 2],
          [width / 2 - 0.01, 0.05, 0, length, Math.PI / 2],
        ] as [number, number, number, number, number][]
      ).map(([x, y, z, len, rot], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[0, rot, 0]} castShadow>
          <boxGeometry args={[len, 0.1, 0.02]} />
          <meshStandardMaterial color="#f2ede4" roughness={0.7} />
        </mesh>
      ))}
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
              position={[light.position[0], Math.min(height - 0.2, light.position[1]), light.position[2]]}
              distance={10}
              decay={2}
            />
          );
        })}
    </>
  );
}

/**
 * 카메라 초기 정렬.
 *
 * OrbitControls가 마운트되면서 내부 구면 좌표를 카메라의 초기 회전값으로 잡는데,
 * 그 값이 방을 향하지 않아 첫 프레임이 비어 보인다. 마운트 직후 한 번 맞춰 준다.
 */
function CameraRig({ target }: { target: [number, number, number] }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as
    | { target?: { set: (x: number, y: number, z: number) => void }; update?: () => void }
    | null;

  useEffect(() => {
    camera.lookAt(target[0], target[1], target[2]);
    camera.updateProjectionMatrix();
    if (controls?.target) {
      controls.target.set(target[0], target[1], target[2]);
      controls.update?.();
    }
  }, [camera, controls, target]);

  return null;
}

/** 렌더 캡처를 위해 canvas 엘리먼트를 스토어에 등록한다 */
function CanvasBridge() {
  const { gl, scene, camera } = useThree();
  const setCapture = useEditorStore((state) => state.setViewportCapture);

  useEffect(() => {
    setCapture(() => {
      // 캡처 직전에 한 프레임을 강제로 그린 뒤 읽는다.
      gl.render(scene, camera);
      return gl.domElement.toDataURL("image/png");
    });
    return () => setCapture(null);
  }, [gl, scene, camera, setCapture]);

  return null;
}

/** 렌더러 설정은 반드시 참조가 고정돼야 한다 — 매 렌더 새 객체를 주면 WebGL 렌더러가 계속 재생성된다 */
const DPR: [number, number] = [1, 1.5];

const GL_CONFIG = {
  // 렌더 캡처(toDataURL)와 스크린샷 안정성을 위해 필요하다
  preserveDrawingBuffer: true,
  antialias: true,
  toneMapping: THREE.ACESFilmicToneMapping,
  toneMappingExposure: 1.05,
} as const;

export function Canvas3D() {
  const scene = useEditorStore((state) => state.scene);
  const select = useEditorStore((state) => state.select);

  // 훅은 early return보다 위에 있어야 한다 (렌더마다 호출 순서가 같아야 함)
  const roomLength = (scene?.room?.dimensions.length ?? 6000) * MM;
  const roomHeight = (scene?.room?.dimensions.height ?? 2700) * MM;
  const fov = scene?.camera?.fov ?? 50;

  const target = useMemo<[number, number, number]>(
    () => [0, roomHeight * 0.35, 0],
    [roomHeight]
  );
  const cameraConfig = useMemo(
    () => ({
      position: [0, Math.max(1.5, roomHeight * 0.55), roomLength / 2 + 2.6] as [number, number, number],
      fov,
      near: 0.05,
      far: 60,
    }),
    [roomHeight, roomLength, fov]
  );

  if (!scene?.room) return null;

  const objects = scene.objects.filter((object) => object.visibility);

  return (
    <div className="h-full w-full bg-[#0f0e0c]">
      <Canvas
        shadows
        dpr={DPR}
        gl={GL_CONFIG}
        camera={cameraConfig}
        onCreated={({ camera }) => camera.lookAt(...target)}
        onPointerMissed={() => select([])}
      >
        <CanvasBridge />

        <SceneLights scene={scene} />

        {/* 창문 쪽에서 들어오는 보조광 */}
        <directionalLight position={[-3, 3.2, 3]} intensity={0.5} color="#ffe9cf" />

        {/* 절차적 환경광 — 파일 다운로드 없이 반사/앰비언트를 만든다 */}
        <Environment resolution={128} frames={1}>
          <Lightformer intensity={2.6} color="#fff3e2" position={[-3, 2.4, 2]} scale={[6, 4, 1]} />
          <Lightformer intensity={1.2} color="#e8f0ff" position={[3, 2.2, -2]} scale={[5, 3, 1]} />
          <Lightformer intensity={0.9} color="#ffffff" position={[0, 4, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[8, 8, 1]} />
        </Environment>

        <RoomShell scene={scene} />

        {objects.map((object) => (
          <ObjectMesh key={object.id} scene={scene} object={object} />
        ))}

        {/* 가구 아래 접지 그림자 — 붕 떠 보이는 느낌을 없앤다 */}
        <ContactShadows
          position={[0, 0.005, 0]}
          scale={Math.max(6, roomLength + 2)}
          opacity={0.5}
          blur={2}
          far={3}
          resolution={512}
          color="#2a231c"
        />

        <OrbitControls
          makeDefault
          target={target}
          maxPolarAngle={Math.PI / 2.05}
          minDistance={1.2}
          maxDistance={14}
        />
        <CameraRig target={target} />
      </Canvas>

      <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/40 px-2 py-1 text-[11px] text-white/60">
        3D · 드래그 회전 · 휠 확대 · 객체 클릭 선택 · [렌더] 누르면 이 화면을 실사로 변환합니다
      </div>
    </div>
  );
}

/** AccumulativeShadows/RandomizedLight는 정적 장면 품질용으로 남겨 둔다 (현재 미사용) */
export const _staticShadowHelpers = { AccumulativeShadows, RandomizedLight };
