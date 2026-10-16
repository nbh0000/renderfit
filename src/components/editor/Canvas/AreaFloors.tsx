"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { levelIdOf, levelsOf, polygonArea } from "@/scene/geometry";
import { worldXZ } from "@/scene/placement";
import type { RoomArea, RoomSpec, Scene } from "@/scene/types";
import { useStandardMaterial } from "./materials";

/**
 * 실마다 다른 바닥재.
 *
 * `RoomArea.floorMaterialId` 는 타입에도, AI 도구에도, 도면 내보내기에도 있었는데
 * 3D 만 `finishes.floor` 한 장으로 방 전체를 깔고 있었다. "욕실 바닥을 타일로"라고
 * 말해도 3D 에서는 거실 마루가 그대로였다.
 *
 * 기준 바닥 위에 실 모양대로 얇은 패치를 얹는다. 벽을 다시 세우거나 바닥을 잘라
 * 붙이는 것보다 단순하고, 실 경계가 바뀌어도 패치만 다시 만들면 된다.
 */

const MM = 0.001;

/**
 * 기준 바닥에서 얼마나 띄울지 (m).
 *
 * 같은 높이에 두 면이 겹치면 어느 쪽이 앞인지 GPU 가 매 픽셀 다르게 판단해 지글거린다.
 * 3mm 면 눈에는 안 보이고 깊이 버퍼에는 충분하다. 기준 바닥의 polygonOffset 이
 * 여기에 더해져 둘이 확실히 갈린다.
 */
const LIFT = 0.003;

/**
 * 실 폴리곤(mm) → XZ 평면에 눕힌 지오메트리.
 *
 * ShapeGeometry 는 XY 평면에 만들어지므로 `rotateX(-π/2)` 로 눕힌다. 그 회전은
 * XY 의 +y 를 월드의 -z 로 보내므로, Shape 에는 월드 z 를 **부호를 뒤집어** 넣어야
 * 눕힌 뒤 제자리에 온다. 이걸 틀리면 평면도의 욕실이 3D 에서 반대편에 생긴다.
 *
 * UV 는 ShapeGeometry 가 shape 좌표를 그대로 쓴다 — 즉 단위가 m 다. 그래서 머티리얼
 * 반복을 `1/타일크기` 로 주면 타일 한 장이 정확히 그 크기가 된다. 패치가 어떤 모양이든,
 * 어느 방향으로 돌아 있든 이웃 실과 타일 줄이 맞는다.
 */
export function areaGeometry(area: RoomArea, room: RoomSpec): THREE.BufferGeometry | null {
  if (area.points.length < 3) return null;
  if (polygonArea(area.points) < 1) return null;

  try {
    const shape = new THREE.Shape();

    area.points.forEach(([px, py], index) => {
      const [x, z] = worldXZ({ cx: px, cy: py }, room);
      // 눕히는 회전이 y → -z 이므로 여기서 미리 뒤집어 둔다
      if (index === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  } catch (error) {
    // 자기교차 폴리곤은 삼각분할이 실패할 수 있다 — 그 실만 건너뛴다
    console.warn("[3d] 실 바닥을 만들지 못했습니다:", area.name, error);
    return null;
  }
}

/** 패치 하나 — 실 하나에 바닥재 하나 */
function AreaFloor({
  geometry,
  elevation,
  material,
  tile,
}: {
  geometry: THREE.BufferGeometry;
  /** 이 실이 속한 층의 바닥 높이 (mm) */
  elevation: number;
  material: Parameters<typeof useStandardMaterial>[0];
  /** 텍스처 한 장이 덮는 실제 크기 (m) */
  tile: number;
}) {
  /*
   * UV 가 월드 좌표(m)라 반복은 1/타일크기다. 방 크기나 패치 모양과 무관하게
   * 타일의 실제 크기가 나온다.
   */
  const mat = useStandardMaterial(material, {
    variant: "area",
    repeatX: 1 / tile,
    repeatY: 1 / tile,
  });

  return (
    <mesh
      geometry={geometry}
      material={mat}
      position={[0, elevation * MM + LIFT, 0]}
      receiveShadow
    />
  );
}

export function AreaFloors({ scene, room }: { scene: Scene; room: RoomSpec }) {
  const levels = useMemo(() => levelsOf(room), [room]);

  /*
   * 실 목록이 실제로 바뀔 때만 지오메트리를 다시 만든다.
   *
   * 가구를 하나 옮길 때마다 바닥 패치를 새로 만들면 그때마다 GPU 로 정점을 다시
   * 올린다. 서명이 같으면 만들 이유가 없다.
   */
  const signature = (room.areas ?? [])
    .map((area) => `${area.id}:${area.floorMaterialId ?? ""}:${area.levelId ?? ""}:${area.points.flat().join(",")}`)
    .join("|");

  const patches = useMemo(() => {
    return (room.areas ?? [])
      .filter((area) => Boolean(area.floorMaterialId))
      .map((area) => {
        const material = scene.materials.find((item) => item.id === area.floorMaterialId);
        if (!material) return null;

        const geometry = areaGeometry(area, room);
        if (!geometry) return null;

        const level = levels.find((item) => item.id === levelIdOf(area, levels));
        return {
          id: area.id,
          geometry,
          material,
          elevation: level?.elevation ?? 0,
          tile: material.scale || 2,
        };
      })
      .filter((patch): patch is NonNullable<typeof patch> => patch !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, scene.materials, levels]);

  // 다시 만들 때 옛 정점 버퍼를 놓아 준다 — 안 그러면 실을 옮길 때마다 GPU 가 샌다
  useEffect(() => {
    return () => {
      for (const patch of patches) patch.geometry.dispose();
    };
  }, [patches]);

  if (patches.length === 0) return null;

  return (
    <>
      {patches.map((patch) => (
        <AreaFloor
          key={patch.id}
          geometry={patch.geometry}
          elevation={patch.elevation}
          material={patch.material}
          tile={patch.tile}
        />
      ))}
    </>
  );
}
