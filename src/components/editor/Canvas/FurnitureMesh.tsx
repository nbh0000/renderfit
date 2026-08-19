"use client";

import { useMemo } from "react";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { Material, SceneObject } from "@/scene/types";
import { textureForMaterial } from "./textures";

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

function useStandardMaterial(material?: Material) {
  return useMemo(() => {
    const color = material?.baseColor ?? "#b9b2a8";
    const map = textureForMaterial(color, material?.tags ?? []);
    return new THREE.MeshStandardMaterial({
      color,
      roughness: material?.roughness ?? 0.75,
      metalness: material?.metallic ?? 0,
      map,
    });
  }, [material]);
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

export function FurnitureMesh({ object, material, selected }: MeshProps) {
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
