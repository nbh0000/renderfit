"use client";

import { Component, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { RoundedBox, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { Material, SceneObject } from "@/scene/types";
import {
  cutoutShape,
  cutoutTexture,
  imageTexture,
  onTextureReady,
  textureForMaterial,
} from "./textures";

/**
 * 가구 지오메트리.
 *
 * GLB 에셋이 없어도 실내처럼 보이도록 타입별로 형태를 조립한다.
 * (박스 하나로 그리면 3D 뷰가 블록 쌓기처럼 보인다 — 여기서 실사감의 절반이 결정된다)
 */

const MM = 0.001;

export interface MeshProps {
  object: SceneObject;
  material?: Material;
  selected: boolean;
}

/**
 * 재질 → three 머티리얼.
 *
 * 사진 텍스처(CC0 PBR)가 붙어 있으면 그것을 쓰고, 없으면 예전처럼 절차적으로 그린다.
 * ARM 맵은 R=AO, G=거칠기, B=금속감이 한 장에 들어 있는 형식이라 세 채널을 나눠 물린다.
 */
export function useStandardMaterial(material?: Material) {
  // 사진이 늦게 도착해도 검게 보이지 않도록, 도착하면 다시 만든다.
  const [generation, setGeneration] = useState(0);
  useEffect(() => onTextureReady(() => setGeneration((value) => value + 1)), []);

  return useMemo(() => {
    const color = material?.baseColor ?? "#b9b2a8";
    const photo = material?.textureUrl
      ? imageTexture(material.textureUrl, { repeat: 1 })
      : undefined;

    const normal = material?.normalMapUrl
      ? imageTexture(material.normalMapUrl, { srgb: false })
      : undefined;
    const arm = material?.armMapUrl ? imageTexture(material.armMapUrl, { srgb: false }) : undefined;

    return new THREE.MeshStandardMaterial({
      color: photo ? "#ffffff" : color,
      roughness: material?.roughness ?? 0.75,
      metalness: material?.metallic ?? 0,
      map: photo ?? textureForMaterial(color, material?.tags ?? []),
      normalMap: normal ?? null,
      aoMap: arm ?? null,
      roughnessMap: arm ?? null,
      metalnessMap: arm ?? null,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [material, generation]);
}

/** 다리 4개 */
function Legs({
  width,
  depth,
  height,
  radius = 0.022,
  color = "#5b4632",
}: {
  width: number;
  depth: number;
  height: number;
  radius?: number;
  color?: string;
}) {
  const positions: [number, number, number][] = [
    [width / 2 - radius * 2.5, -height / 2, depth / 2 - radius * 2.5],
    [-(width / 2 - radius * 2.5), -height / 2, depth / 2 - radius * 2.5],
    [width / 2 - radius * 2.5, -height / 2, -(depth / 2 - radius * 2.5)],
    [-(width / 2 - radius * 2.5), -height / 2, -(depth / 2 - radius * 2.5)],
  ];

  return (
    <>
      {positions.map((position, i) => (
        <mesh key={i} position={position} castShadow>
          <cylinderGeometry args={[radius, radius * 0.85, height, 12]} />
          <meshStandardMaterial color={color} roughness={0.55} />
        </mesh>
      ))}
    </>
  );
}

/**
 * 모델을 못 불러왔을 때 primitive로 물러난다.
 *
 * 메시는 public/models 아래에 있고 빌드 때 받아 온다(scripts/assets/polyhaven.mjs).
 * 그 단계가 실패했거나 파일 하나가 깨져도 3D 뷰 전체가 죽으면 안 된다 —
 * useGLTF는 실패하면 렌더 중에 throw하므로 경계가 없으면 캔버스가 통째로 내려간다.
 */
class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[3d] 모델을 불러오지 못해 기본 형태로 그립니다:", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * 외부 glTF 모델.
 *
 * 무료 소스(Poly Haven CC0)에서 받은 모델은 크기가 제각각이라, 불러온 뒤
 * 바운딩 박스를 재서 Scene에 적힌 실제 치수(mm)에 맞춰 균일 축소·확대한다.
 * 이렇게 해야 도면의 치수와 3D의 크기가 어긋나지 않는다.
 */
function ExternalModel({
  url,
  width,
  height,
  depth,
}: {
  url: string;
  width: number;
  height: number;
  depth: number;
}) {
  const { scene } = useGLTF(url);

  const model = useMemo(() => {
    const clone = scene.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());

    // 세 축 중 가장 빡빡한 비율에 맞춰 원형을 유지한 채 넣는다.
    const factor = Math.min(
      size.x > 0 ? width / size.x : 1,
      size.y > 0 ? height / size.y : 1,
      size.z > 0 ? depth / size.z : 1
    );
    clone.scale.setScalar(Number.isFinite(factor) && factor > 0 ? factor : 1);

    /*
     * 경계 상자의 한가운데를 원점에 맞춘다.
     *
     * primitive는 전부 원점을 중심으로 그려지고, 바깥에서 이 그룹을 물체 중심 높이
     * (mountHeight = 바닥에서 h/2)에 올려 놓는다. 그런데 여기서 바닥(min.y)을 원점에
     * 맞춰 버리면 모델만 딱 반 키만큼 공중에 뜬다 — 실제로 그렇게 떠 있었다.
     */
    const scaled = new THREE.Box3().setFromObject(clone);
    const center = scaled.getCenter(new THREE.Vector3());
    clone.position.set(-center.x, -center.y, -center.z);

    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    return clone;
  }, [scene, width, height, depth]);

  return <primitive object={model} />;
}

/**
 * AI가 만든 가구 이미지를 세운다.
 *
 * 메시가 아니라 잘라낸 판이다. 한 장만 세우면 옆에서 볼 때 종잇장처럼 사라지므로,
 * 가로·세로로 한 장씩 교차해 세운다(십자). 어느 각도에서 봐도 실루엣이 남고,
 * 옆에서 보면 그 가구의 실제 안길이만큼 폭을 차지한다.
 *
 * 평면도의 발자국과 치수는 정확하고, 마지막 실사 렌더가 이 판을 사진으로 바꿔 준다.
 */
/**
 * 메시가 없는 가구를 사진으로 세운다.
 *
 * 판 한 장으로 세우면 옆에서 볼 때 종이처럼 얇아 방이 우스워진다. 그래서 실루엣이
 * 자기 사각형을 얼마나 채우는지 재서 두 가지로 나눈다.
 *
 *  - 침대·붙박이장·냉장고처럼 꽉 찬 것: 사진에서 뽑은 색으로 덩어리를 세우고 앞면에만
 *    사진을 붙인다. 어느 각도에서 봐도 부피가 있고, 평면도의 발자국과도 맞는다.
 *  - 화분·조명처럼 뚫린 것: 덩어리로 만들면 통나무가 되므로 판을 십자로 교차시킨다.
 *
 * 사진이 아직 안 왔으면 판 하나로 시작하고, 다 읽히면 위 둘 중 하나로 바뀐다.
 */
/** 실루엣이 외접 사각형의 이만큼을 채우면 속이 꽉 찬 가구로 본다 */
const SOLID_FILL = 0.6;

function ImageBillboard({
  url,
  width,
  height,
  depth,
}: {
  url: string;
  width: number;
  height: number;
  depth: number;
}) {
  const texture = cutoutTexture(url);
  const [shape, setShape] = useState(() => cutoutShape(url));

  useEffect(() => {
    if (shape) return;
    return onTextureReady(() => setShape(cutoutShape(url)));
  }, [url, shape]);

  if (!texture) return null;

  const face = (
    <meshStandardMaterial
      map={texture}
      transparent
      alphaTest={0.35}
      side={THREE.DoubleSide}
      roughness={0.9}
    />
  );

  if (shape && shape.fill >= SOLID_FILL) {
    return (
      <group>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[width * 0.98, height * 0.98, depth * 0.98]} />
          <meshStandardMaterial color={shape.color} roughness={0.85} metalness={0.02} />
        </mesh>
        {/* 앞면 사진 — 덩어리보다 아주 살짝 앞에 둬야 z-파이팅이 없다 */}
        <mesh position={[0, 0, depth / 2 + 0.002]} castShadow>
          <planeGeometry args={[width, height]} />
          {face}
        </mesh>
      </group>
    );
  }

  return (
    <group>
      <mesh castShadow>
        <planeGeometry args={[width, height]} />
        {face}
      </mesh>
      {/* 교차판 — 가운데를 지나게 세워야 십자가 되고, 옆에서도 안길이만큼 보인다 */}
      <mesh rotation={[0, Math.PI / 2, 0]} castShadow>
        <planeGeometry args={[depth, height]} />
        {face}
      </mesh>
    </group>
  );
}

/**
 * 가구 하나.
 *
 * 실제 메시 > AI 생성 이미지 > 타입별 primitive 순으로 그린다.
 */
export function FurnitureMesh(props: MeshProps) {
  const { object, material, selected } = props;
  const mat = useStandardMaterial(material);

  const w = object.dimensions.width * MM * object.transform.scale[0];
  const h = object.dimensions.height * MM * object.transform.scale[1];
  const d = object.dimensions.depth * MM * object.transform.scale[2];

  if (!object.modelUrl && object.imageUrl) {
    return (
      <group>
        <ImageBillboard url={object.imageUrl} width={w} height={h} depth={d} />
        {selected && (
          <mesh>
            <boxGeometry args={[w * 1.04, h * 1.04, d * 1.04]} />
            <meshBasicMaterial color="#000000" wireframe />
          </mesh>
        )}
      </group>
    );
  }

  if (!object.modelUrl) return <PrimitiveMesh {...props} />;

  return (
    <group>
      <ModelBoundary fallback={<PrimitiveMesh {...props} />}>
        <Suspense
          fallback={
            <mesh>
              <boxGeometry args={[w, h, d]} />
              <primitive object={mat} attach="material" />
            </mesh>
          }
        >
          <ExternalModel url={object.modelUrl} width={w} height={h} depth={d} />
        </Suspense>
      </ModelBoundary>
      {selected && (
        <mesh>
          <boxGeometry args={[w * 1.04, h * 1.04, d * 1.04]} />
          <meshBasicMaterial color="#000000" wireframe />
        </mesh>
      )}
    </group>
  );
}

function PrimitiveMesh({ object, material, selected }: MeshProps) {
  const w = object.dimensions.width * MM * object.transform.scale[0];
  const h = object.dimensions.height * MM * object.transform.scale[1];
  const d = object.dimensions.depth * MM * object.transform.scale[2];

  const mat = useStandardMaterial(material);
  const accent = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#3a332c", roughness: 0.5 }),
    []
  );

  const outline = selected ? (
    <mesh>
      <boxGeometry args={[w * 1.04, h * 1.04, d * 1.04]} />
      <meshBasicMaterial color="#000000" wireframe />
    </mesh>
  ) : null;

  switch (object.type) {
    case "sofa": {
      const seatH = h * 0.42;
      const backH = h * 0.58;
      const armW = w * 0.1;
      return (
        <group>
          <RoundedBox
            args={[w, seatH, d]}
            radius={0.05}
            smoothness={3}
            position={[0, -h / 2 + seatH / 2 + 0.12, 0]}
            material={mat}
            castShadow
            receiveShadow
          />
          <RoundedBox
            args={[w, backH, d * 0.22]}
            radius={0.05}
            smoothness={3}
            position={[0, -h / 2 + seatH + backH / 2 + 0.05, -d / 2 + d * 0.11]}
            material={mat}
            castShadow
          />
          <RoundedBox
            args={[armW, h * 0.55, d * 0.92]}
            radius={0.04}
            smoothness={3}
            position={[w / 2 - armW / 2, -h / 2 + h * 0.38, 0]}
            material={mat}
            castShadow
          />
          <RoundedBox
            args={[armW, h * 0.55, d * 0.92]}
            radius={0.04}
            smoothness={3}
            position={[-(w / 2 - armW / 2), -h / 2 + h * 0.38, 0]}
            material={mat}
            castShadow
          />
          {[-1, 0, 1].map((i) => (
            <RoundedBox
              key={i}
              args={[w * 0.26, h * 0.12, d * 0.6]}
              radius={0.03}
              smoothness={3}
              position={[i * w * 0.28, -h / 2 + seatH + 0.16, d * 0.04]}
              material={mat}
              castShadow
            />
          ))}
          <Legs width={w * 0.86} depth={d * 0.8} height={0.12} />
          {outline}
        </group>
      );
    }

    case "chair": {
      const seatH = h * 0.1;
      return (
        <group>
          <RoundedBox
            args={[w, seatH, d]}
            radius={0.03}
            smoothness={3}
            position={[0, -h / 2 + h * 0.45, 0]}
            material={mat}
            castShadow
            receiveShadow
          />
          <RoundedBox
            args={[w * 0.94, h * 0.45, d * 0.12]}
            radius={0.03}
            smoothness={3}
            position={[0, -h / 2 + h * 0.72, -d / 2 + d * 0.08]}
            material={mat}
            castShadow
          />
          <Legs width={w * 0.86} depth={d * 0.86} height={h * 0.45} radius={0.018} />
          {outline}
        </group>
      );
    }

    case "table": {
      const topH = Math.max(0.03, h * 0.1);
      return (
        <group>
          <RoundedBox
            args={[w, topH, d]}
            radius={0.012}
            smoothness={3}
            position={[0, h / 2 - topH / 2, 0]}
            material={mat}
            castShadow
            receiveShadow
          />
          <Legs width={w * 0.9} depth={d * 0.86} height={h - topH} radius={0.02} />
          {outline}
        </group>
      );
    }

    case "cabinet": {
      const drawers = Math.max(2, Math.min(4, Math.round(h / 0.45)));
      return (
        <group>
          <RoundedBox
            args={[w, h, d]}
            radius={0.015}
            smoothness={3}
            material={mat}
            castShadow
            receiveShadow
          />
          {Array.from({ length: drawers }, (_, i) => {
            const y = -h / 2 + (h / drawers) * (i + 0.5);
            return (
              <group key={i}>
                <mesh position={[0, y, d / 2 + 0.004]}>
                  <planeGeometry args={[w * 0.94, (h / drawers) * 0.86]} />
                  <meshStandardMaterial
                    color={material?.baseColor ?? "#b9b2a8"}
                    roughness={0.6}
                  />
                </mesh>
                <mesh
                  position={[0, y, d / 2 + 0.02]}
                  rotation={[0, 0, Math.PI / 2]}
                  material={accent}
                  castShadow
                >
                  <cylinderGeometry args={[0.008, 0.008, w * 0.24, 8]} />
                </mesh>
              </group>
            );
          })}
          {outline}
        </group>
      );
    }

    case "bed": {
      const baseH = h * 0.45;
      return (
        <group>
          <RoundedBox
            args={[w, baseH, d]}
            radius={0.02}
            smoothness={3}
            position={[0, -h / 2 + baseH / 2, 0]}
            castShadow
            receiveShadow
          >
            <meshStandardMaterial color="#6b5844" roughness={0.7} />
          </RoundedBox>
          <RoundedBox
            args={[w * 0.97, h * 0.3, d * 0.94]}
            radius={0.05}
            smoothness={3}
            position={[0, -h / 2 + baseH + h * 0.15, 0]}
            material={mat}
            castShadow
          />
          {[-1, 1].map((i) => (
            <RoundedBox
              key={i}
              args={[w * 0.36, h * 0.12, d * 0.16]}
              radius={0.04}
              smoothness={3}
              position={[i * w * 0.22, -h / 2 + baseH + h * 0.34, -d / 2 + d * 0.14]}
              material={mat}
              castShadow
            />
          ))}
          <RoundedBox
            args={[w, h * 0.62, 0.06]}
            radius={0.02}
            smoothness={3}
            position={[0, -h / 2 + h * 0.5, -d / 2 - 0.02]}
            material={mat}
            castShadow
          />
          {outline}
        </group>
      );
    }

    case "lamp": {
      const shadeH = h * 0.24;
      return (
        <group>
          <mesh position={[0, -h / 2 + 0.01, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[w * 0.38, w * 0.42, 0.03, 24]} />
            <meshStandardMaterial color="#2f2d2b" roughness={0.4} metalness={0.6} />
          </mesh>
          <mesh castShadow>
            <cylinderGeometry args={[0.012, 0.012, h * 0.9, 12]} />
            <meshStandardMaterial color="#2f2d2b" roughness={0.35} metalness={0.7} />
          </mesh>
          <mesh position={[0, h / 2 - shadeH / 2, 0]} castShadow>
            <cylinderGeometry args={[w * 0.42, w * 0.52, shadeH, 24, 1, true]} />
            <meshStandardMaterial
              color="#f3ece0"
              roughness={0.9}
              side={THREE.DoubleSide}
              emissive="#ffdca8"
              emissiveIntensity={0.55}
            />
          </mesh>
          <pointLight
            position={[0, h / 2 - shadeH, 0]}
            intensity={2.2}
            distance={3.4}
            color="#ffd9a0"
          />
          {outline}
        </group>
      );
    }

    case "plant": {
      const potH = h * 0.28;
      return (
        <group>
          <mesh position={[0, -h / 2 + potH / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[w * 0.34, w * 0.26, potH, 20]} />
            <meshStandardMaterial color="#b4643f" roughness={0.85} />
          </mesh>
          {Array.from({ length: 7 }, (_, i) => {
            const angle = (i / 7) * Math.PI * 2;
            const radius = w * (0.16 + (i % 3) * 0.09);
            const y = -h / 2 + potH + h * (0.28 + (i % 4) * 0.13);
            return (
              <mesh
                key={i}
                position={[Math.cos(angle) * radius, y, Math.sin(angle) * radius]}
                scale={[1, 0.72, 1]}
                castShadow
              >
                <sphereGeometry args={[w * 0.2, 12, 10]} />
                <meshStandardMaterial color={i % 2 ? "#4f7247" : "#5c7a52"} roughness={0.9} />
              </mesh>
            );
          })}
          {outline}
        </group>
      );
    }

    case "rug":
      return (
        <group>
          <RoundedBox
            args={[w, 0.014, d]}
            radius={0.006}
            smoothness={2}
            position={[0, -h / 2, 0]}
            material={mat}
            receiveShadow
          />
          {outline}
        </group>
      );

    case "tv":
      return (
        <group>
          <RoundedBox args={[w, h, Math.max(0.03, d)]} radius={0.008} smoothness={2} castShadow>
            <meshStandardMaterial color="#17181a" roughness={0.28} metalness={0.5} />
          </RoundedBox>
          <mesh position={[0, 0, Math.max(0.03, d) / 2 + 0.002]}>
            <planeGeometry args={[w * 0.95, h * 0.92]} />
            <meshStandardMaterial
              color="#0d1013"
              roughness={0.12}
              metalness={0.2}
              emissive="#0a1a24"
              emissiveIntensity={0.35}
            />
          </mesh>
          {outline}
        </group>
      );

    case "window":
      return (
        <group>
          {/* 밝은 개구부 — 실내에 자연광이 들어오는 느낌을 만든다 */}
          <mesh>
            <planeGeometry args={[w, h]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive="#eaf3ff"
              emissiveIntensity={1.6}
              toneMapped={false}
            />
          </mesh>
          {(
            [
              [-w / 2, 0, w * 0.04, h],
              [w / 2, 0, w * 0.04, h],
              [0, h / 2, w, h * 0.04],
              [0, -h / 2, w, h * 0.04],
              [0, 0, w * 0.025, h],
            ] as [number, number, number, number][]
          ).map(([x, y, fw, fh], i) => (
            <mesh key={i} position={[x, y, 0.01]} material={accent}>
              <boxGeometry args={[fw, fh, 0.04]} />
            </mesh>
          ))}
          {outline}
        </group>
      );

    case "decoration":
      return (
        <group>
          <RoundedBox
            args={[w, h, Math.max(0.02, d)]}
            radius={0.01}
            smoothness={2}
            material={mat}
            castShadow
          />
          <mesh position={[0, 0, Math.max(0.02, d) / 2 + 0.003]}>
            <planeGeometry args={[w * 0.86, h * 0.86]} />
            <meshStandardMaterial color="#efeae1" roughness={0.9} />
          </mesh>
          {outline}
        </group>
      );

    case "appliance":
      return (
        <group>
          <RoundedBox args={[w, h, d]} radius={0.02} smoothness={3} castShadow receiveShadow>
            <meshStandardMaterial
              color={material?.baseColor ?? "#d9dbdc"}
              roughness={0.3}
              metalness={0.55}
            />
          </RoundedBox>
          <mesh position={[w * 0.32, 0, d / 2 + 0.006]} material={accent}>
            <boxGeometry args={[0.02, h * 0.5, 0.02]} />
          </mesh>
          {outline}
        </group>
      );

    default:
      return (
        <group>
          <RoundedBox
            args={[w, h, d]}
            radius={0.02}
            smoothness={3}
            material={mat}
            castShadow
            receiveShadow
          />
          {outline}
        </group>
      );
  }
}
