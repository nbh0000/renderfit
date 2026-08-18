"use client";

import { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Grid, OrbitControls, useGLTF } from "@react-three/drei";
import { useEditorStore } from "@/lib/editor/store";
import type { Scene, SceneObject } from "@/scene/types";
import { ASSET_MAP } from "@/models/assets";

/**
 * 3D 뷰 (foundation).
 *
 * GLB가 있으면 로드하고, 없으면 primitive geometry로 대체한다.
 * 객체를 클릭하면 2.5D와 동일한 선택 상태를 공유한다.
 */

const MM = 0.001; // mm → m

function materialColor(scene: Scene, object: SceneObject): string {
  if (!object.materialId) return "#b9b2a8";
  return scene.materials.find((m) => m.id === object.materialId)?.baseColor ?? "#b9b2a8";
}

function materialProps(scene: Scene, object: SceneObject) {
  const material = scene.materials.find((m) => m.id === object.materialId);
  return {
    color: materialColor(scene, object),
    roughness: material?.roughness ?? 0.8,
    metalness: material?.metallic ?? 0,
  };
}

/** 2.5D 화면 좌표를 바닥 평면 위치로 변환한다 */
function worldPosition(object: SceneObject, room: Scene["room"]): [number, number, number] {
  const roomWidth = room.dimensions.width * MM;
  const roomLength = room.dimensions.length * MM;

  const x = (object.screen.x + object.screen.width / 2 - 0.5) * roomWidth;
  const z = (0.5 - object.depth) * roomLength;
  const y = (object.dimensions.height * MM) / 2;

  return [x, y, z];
}

function GLBModel({ url, scale }: { url: string; scale: number }) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(), [scene]);
  return <primitive object={cloned} scale={scale} />;
}

function ObjectMesh({ scene, object }: { scene: Scene; object: SceneObject }) {
  const selectedIds = useEditorStore((state) => state.selectedIds);
  const select = useEditorStore((state) => state.select);

  const selected = selectedIds.includes(object.id);
  const asset = object.assetId ? ASSET_MAP[object.assetId] : undefined;
  const primitive = asset?.primitive ?? "box";

  const width = object.dimensions.width * MM * object.transform.scale[0];
  const height = object.dimensions.height * MM * object.transform.scale[1];
  const depth = object.dimensions.depth * MM * object.transform.scale[2];

  const position = worldPosition(object, scene.room);
  const props = materialProps(scene, object);

  return (
    <group
      position={position}
      rotation={[0, (-object.screen.rotation * Math.PI) / 180, 0]}
      onClick={(event) => {
        event.stopPropagation();
        select([object.id]);
      }}
    >
      {asset?.modelUrl ? (
        <Suspense fallback={null}>
          <GLBModel url={asset.modelUrl} scale={object.transform.scale[0]} />
        </Suspense>
      ) : primitive === "cylinder" ? (
        <mesh castShadow receiveShadow>
          <cylinderGeometry args={[width / 2, width / 2, height, 24]} />
          <meshStandardMaterial {...props} />
        </mesh>
      ) : primitive === "sphere" ? (
        <mesh castShadow receiveShadow>
          <sphereGeometry args={[Math.max(width, height) / 2, 24, 16]} />
          <meshStandardMaterial {...props} />
        </mesh>
      ) : primitive === "plane" ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -height / 2 + 0.01, 0]} receiveShadow>
          <planeGeometry args={[width, depth]} />
          <meshStandardMaterial {...props} />
        </mesh>
      ) : (
        <mesh castShadow receiveShadow>
          <boxGeometry args={[width, height, depth]} />
          <meshStandardMaterial {...props} />
        </mesh>
      )}

      {selected && (
        <mesh>
          <boxGeometry args={[width * 1.06, height * 1.06, depth * 1.06]} />
          <meshBasicMaterial color="#bf6242" wireframe />
        </mesh>
      )}
    </group>
  );
}

function RoomShell({ scene }: { scene: Scene }) {
  const width = scene.room.dimensions.width * MM;
  const length = scene.room.dimensions.length * MM;
  const height = scene.room.dimensions.height * MM;

  return (
    <group>
      {/* 바닥 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial color="#c9a173" roughness={0.85} />
      </mesh>
      {/* 뒷벽 */}
      <mesh position={[0, height / 2, -length / 2]} receiveShadow>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color="#efe9e0" roughness={0.95} />
      </mesh>
      {/* 좌측벽 */}
      <mesh position={[-width / 2, height / 2, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[length, height]} />
        <meshStandardMaterial color="#e6e0d6" roughness={0.95} />
      </mesh>
    </group>
  );
}

function SceneLights({ scene }: { scene: Scene }) {
  return (
    <>
      {scene.lights
        .filter((light) => light.enabled)
        .map((light) => {
          if (light.type === "ambient") {
            return (
              <ambientLight key={light.id} intensity={light.intensity} color={light.color} />
            );
          }
          if (light.type === "directional") {
            return (
              <directionalLight
                key={light.id}
                intensity={light.intensity}
                color={light.color}
                position={light.position}
                castShadow
              />
            );
          }
          return (
            <pointLight
              key={light.id}
              intensity={light.intensity * 3}
              color={light.color}
              position={light.position}
              distance={12}
            />
          );
        })}
    </>
  );
}

export function Canvas3D() {
  const scene = useEditorStore((state) => state.scene);
  const select = useEditorStore((state) => state.select);

  if (!scene?.room) return null;

  const objects = scene.objects.filter((object) => object.visibility);

  // 방 크기에 맞춰 전체가 들어오는 초기 카메라 위치를 잡는다.
  const roomLength = scene.room.dimensions.length * MM;
  const target: [number, number, number] = [0, scene.room.dimensions.height * MM * 0.35, 0];
  const cameraPosition: [number, number, number] = [
    0,
    Math.max(1.6, scene.room.dimensions.height * MM * 0.6),
    roomLength / 2 + 3.2,
  ];

  return (
    <div className="h-full w-full bg-[#15140f]">
      <Canvas
        shadows
        camera={{ position: cameraPosition, fov: scene.camera.fov }}
        onCreated={({ camera }) => camera.lookAt(...target)}
        onPointerMissed={() => select([])}
      >
        <SceneLights scene={scene} />
        <RoomShell scene={scene} />
        <Grid
          args={[20, 20]}
          cellColor="#4a453e"
          sectionColor="#6b6560"
          fadeDistance={22}
          position={[0, 0.002, 0]}
        />
        {objects.map((object) => (
          <ObjectMesh key={object.id} scene={scene} object={object} />
        ))}
        <OrbitControls makeDefault target={target} maxPolarAngle={Math.PI / 2.05} />
      </Canvas>

      <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-black/40 px-2 py-1 text-[11px] text-white/60">
        3D · 드래그 회전 · 휠 확대 · 객체 클릭 선택 (GLB 없는 에셋은 프리미티브로 표시)
      </div>
    </div>
  );
}
