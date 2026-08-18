"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useEditorStore } from "@/lib/editor/store";
import type { Scene, SceneObject } from "@/scene/types";
import { FurnitureMesh } from "./FurnitureMesh";
import { woodTexture, paintTexture } from "./textures";

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
  const roomWidth = room.dimensions.width * MM;
  const roomLength = room.dimensions.length * MM;
  const screenX = override?.x ?? object.screen.x;
  const depth = override?.depth ?? object.depth;

  const x = (screenX + object.screen.width / 2 - 0.5) * roomWidth;
  const z = (0.5 - depth) * roomLength;
  const y = (object.dimensions.height * MM * object.transform.scale[1]) / 2;

  // 벽에 붙는 요소는 바닥이 아니라 화면 높이를 따른다.
  if (object.type === "window" || object.type === "decoration" || object.type === "tv") {
    const roomHeight = room.dimensions.height * MM;
    const wallY = (1 - (object.screen.y + object.screen.height / 2)) * roomHeight;
    return [x, Math.max(0.3, wallY), -roomLength / 2 + 0.06];
  }

  return [x, y, z];
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

function RoomShell({ scene }: { scene: Scene }) {
  const width = scene.room.dimensions.width * MM;
  const length = scene.room.dimensions.length * MM;
  const height = scene.room.dimensions.height * MM;

  const floorColor =
    scene.materials.find((m) => m.tags?.includes("floor"))?.baseColor ?? "#c9a173";
  const wallColor = scene.materials.find((m) => m.tags?.includes("wall"))?.baseColor ?? "#efe9e0";

  const floorMap = useMemo(() => woodTexture(floorColor, 4), [floorColor]);
  const wallMap = useMemo(() => paintTexture(wallColor, 2), [wallColor]);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial map={floorMap} color={floorColor} roughness={0.55} metalness={0.02} />
      </mesh>

      {/* 뒷벽 — 생성 이미지는 이 벽 앞에 겹쳐 그린다 */}
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

      <mesh position={[0, height, 0]} rotation={[Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width, length]} />
        <meshStandardMaterial color="#f6f3ee" roughness={1} />
      </mesh>

      {/* 걸레받이 */}
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
      setDraft({ id: current.id, x: clamp01(hit.x - halfWidth), depth: hit.depth });
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

/** 카메라 초기 정렬 — OrbitControls가 첫 프레임에 엉뚱한 방향을 보는 문제 보정 */
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
      const result = await exporter.parseAsync(scene, { binary: true, onlyVisible: true });
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

  const roomLength = (scene?.room?.dimensions.length ?? 6000) * MM;
  const roomHeight = (scene?.room?.dimensions.height ?? 2700) * MM;
  const fov = scene?.camera?.fov ?? 50;

  const target = useMemo<[number, number, number]>(() => [0, roomHeight * 0.35, 0], [roomHeight]);
  const cameraConfig = useMemo(
    () => ({
      position: [0, Math.max(1.5, roomHeight * 0.55), roomLength / 2 + 2.6] as [
        number,
        number,
        number,
      ],
      fov,
      near: 0.05,
      far: 60,
    }),
    [roomHeight, roomLength, fov]
  );

  const onDragStart = useCallback((_event: ThreeEvent<PointerEvent>, object: SceneObject) => {
    setDraft({ id: object.id, x: object.screen.x, depth: object.depth });
  }, []);

  if (!scene?.room) return null;

  const objects = scene.objects.filter((object) => object.visibility);
  const backdropUrl = scene.source.generatedImageUrl ?? scene.source.imageUrl;
  const backdropOn = showBackdrop && Boolean(backdropUrl);

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
          <ObjectMesh
            key={object.id}
            scene={scene}
            object={object}
            draft={draft}
            onDragStart={onDragStart}
          />
        ))}

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
        <PlacementController scene={scene} draft={draft} setDraft={setDraft} />
      </Canvas>

      <div className="absolute bottom-3 left-3 flex flex-wrap gap-2">
        <span className="rounded bg-black/45 px-2 py-1 text-[11px] text-white/70">
          객체를 끌어서 배치 · 빈 곳 드래그로 회전 · 휠 확대
        </span>
        <button
          type="button"
          onClick={toggleBackdrop}
          disabled={!backdropUrl}
          className={[
            "rounded px-2 py-1 text-[11px] transition-colors disabled:opacity-50",
            backdropOn ? "bg-accent text-white" : "bg-black/45 text-white/70 hover:bg-black/60",
          ].join(" ")}
        >
          {backdropUrl ? (backdropOn ? "생성 이미지 켜짐" : "생성 이미지 꺼짐") : "생성 이미지 없음"}
        </button>
      </div>
    </div>
  );
}
