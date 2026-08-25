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

/**
 * 다리 4개.
 *
 * 가구의 원점은 한가운데이므로 바닥은 y = -가구높이/2 다. 그런데 다리를 제 길이의
 * 절반만큼만 내려 두고 있었다 — 그러면 다리가 바닥이 아니라 가구 한가운데에 매달린다.
 * 옆에서 보면 상판과 다리가 뚝 떨어져 보이고, 다리 끝은 바닥을 뚫고 내려간다.
 * 0.75m 짜리 책상이면 0.3m 씩 어긋났다.
 *
 * 그래서 바닥 높이(floorY)를 받아 거기서부터 세운다. 다리 윗끝은 floorY + height 이고,
 * 부르는 쪽은 그 값이 앉는 면·상판 밑면과 맞도록 height 를 준다.
 */
function Legs({
  width,
  depth,
  height,
  floorY,
  radius = 0.022,
  color = "#5b4632",
}: {
  width: number;
  depth: number;
  /** 다리 길이 — 바닥에서 앉는 면(또는 상판 밑면)까지 */
  height: number;
  /** 가구 바닥의 y. 가구 원점이 한가운데라 보통 -가구높이/2 다 */
  floorY: number;
  radius?: number;
  color?: string;
}) {
  const y = floorY + height / 2;

  const positions: [number, number, number][] = [
    [width / 2 - radius * 2.5, y, depth / 2 - radius * 2.5],
    [-(width / 2 - radius * 2.5), y, depth / 2 - radius * 2.5],
    [width / 2 - radius * 2.5, y, -(depth / 2 - radius * 2.5)],
    [-(width / 2 - radius * 2.5), y, -(depth / 2 - radius * 2.5)],
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
    /*
     * 각진 상자는 어떤 가구도 그렇게 생기지 않아서 눈에 걸린다. 모서리를 조금만
     * 굴려도 "가구"로 읽힌다. 반지름은 가장 짧은 변에 맞춰야 얇은 것(TV장·매트리스)이
     * 캡슐처럼 부풀지 않는다.
     */
    const radius = Math.min(0.03, Math.min(width, height, depth) * 0.12);

    return (
      <group>
        <RoundedBox
          args={[width * 0.98, height * 0.98, depth * 0.98]}
          radius={radius}
          smoothness={3}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial color={shape.color} roughness={0.85} metalness={0.02} />
        </RoundedBox>

        {/*
          윗면은 3/4 시점에서 앞면 다음으로 많이 보인다. 사진 윗부분에서 뽑은 색을
          얹어 두면 통짜 색 덩어리에서 벗어난다.
        */}
        <mesh position={[0, height / 2 - 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[width * 0.94, depth * 0.94]} />
          <meshStandardMaterial color={shape.topColor} roughness={0.8} metalness={0.02} />
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

/**
 * 도면에서 읽은 모양을 그대로 세운다.
 *
 * 평면도에 ㄱ자 책상이 그려져 있으면 3D 에서도 ㄱ자여야 한다. 네모 상자로 세우면
 * 도면과 3D 가 서로 다른 가구를 보여 주는 셈이고, 그 순간 둘 다 못 믿게 된다.
 *
 * 다각형(-0.5~0.5)을 받아 실제 폭·깊이로 늘리고 높이만큼 뽑아 올린다. 평면의 y 는
 * 3D 의 z 이고 부호가 반대다(scene/placement 의 규칙) — 여기서 뒤집어 준다.
 */
function FootprintSolid({
  footprint,
  width,
  depth,
  height,
  y,
  material,
  bevel = 0,
}: {
  footprint: [number, number][];
  width: number;
  depth: number;
  height: number;
  /** 이 덩어리의 아래쪽 y */
  y: number;
  material: THREE.Material;
  /** 모서리를 살짝 깎는다 — 상판처럼 얇은 것에 쓰면 날이 서지 않는다 */
  bevel?: number;
}) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();

    footprint.forEach(([fx, fy], index) => {
      const x = fx * width;
      // 평면 y 가 커질수록 도면 안쪽 → 3D 에서는 z 가 작아진다
      const z = -fy * depth;
      if (index === 0) shape.moveTo(x, z);
      else shape.lineTo(x, z);
    });
    shape.closePath();

    const solid = new THREE.ExtrudeGeometry(shape, {
      depth: height,
      bevelEnabled: bevel > 0,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 1,
      curveSegments: 4,
    });

    // ExtrudeGeometry 는 z 방향으로 뽑으므로 눕혀서 세운다
    solid.rotateX(-Math.PI / 2);
    solid.computeVertexNormals();
    return solid;
  }, [footprint, width, depth, height, bevel]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} position={[0, y, 0]} material={material} castShadow receiveShadow />
  );
}

/**
 * 다각형 꼭짓점마다 다리를 세운다.
 *
 * ㄱ자 책상에 네 다리를 바깥 사각형 모서리에 박으면 두 개가 허공에 뜬다.
 * 실제 모양의 꼭짓점을 쓰되, 안쪽으로 조금 당겨 상판 밖으로 나오지 않게 한다.
 */
function FootprintLegs({
  footprint,
  width,
  depth,
  height,
  floorY,
  radius = 0.02,
  color = "#5b4632",
}: {
  footprint: [number, number][];
  width: number;
  depth: number;
  height: number;
  floorY: number;
  radius?: number;
  color?: string;
}) {
  const y = floorY + height / 2;
  /** 꼭짓점을 가운데로 당기는 정도 — 다리가 상판 모서리를 뚫지 않을 만큼만 */
  const inset = 0.86;

  /* 점이 촘촘한 원형·둥근 모양은 꼭짓점마다 다리를 세울 수 없다 */
  const spots = footprint.length <= 12 ? footprint : [];

  return (
    <>
      {spots.map(([fx, fy], index) => (
        <mesh key={index} position={[fx * width * inset, y, -fy * depth * inset]} castShadow>
          <cylinderGeometry args={[radius, radius * 0.85, height, 12]} />
          <meshStandardMaterial color={color} roughness={0.55} />
        </mesh>
      ))}
    </>
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

  /*
   * 도면에서 읽은 모양이 있으면 그 모양으로 세운다.
   *
   * 침대·의자는 뺀다. 그 둘은 아래에 결이 살아 있는 형태(머리판·베개·이불, 등받이와
   * 앉는 면)를 따로 만들어 두었고, 실제로도 거의 다 직사각이라 다각형으로 뽑아 올리면
   * 오히려 밋밋한 덩어리가 된다.
   */
  const shaped = object.footprint?.length && object.type !== "bed" && object.type !== "chair"
    ? object.footprint
    : null;

  if (shaped) {
    /** 상판이 있는 것과 통짜인 것 — 상판이 있으면 다리를 세운다 */
    const legged = object.type === "table";
    const topH = legged ? Math.max(0.03, h * 0.1) : h;

    return (
      <group>
        <FootprintSolid
          footprint={shaped}
          width={w}
          depth={d}
          height={topH}
          y={legged ? h / 2 - topH : -h / 2}
          material={mat}
          bevel={legged ? 0.004 : 0}
        />
        {legged && (
          <FootprintLegs
            footprint={shaped}
            width={w}
            depth={d}
            height={h - topH}
            floorY={-h / 2}
          />
        )}
        {outline}
      </group>
    );
  }

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
          {/* 소파는 몸통이 바닥 가까이 앉으므로 다리가 짧다 */}
          <Legs width={w * 0.86} depth={d * 0.8} height={0.12} floorY={-h / 2} />
          {outline}
        </group>
      );
    }

    /*
     * 의자.
     *
     * 앉는 판 하나에 등받이 판 하나면 옆에서 봤을 때 의자로 안 보인다 — 그냥 ㄴ자로
     * 세운 널빤지다. 실제 의자를 의자로 만드는 것은 네 가지다.
     *   · 방석이 조금 도톰하고 앞쪽이 둥글다
     *   · 등받이가 뒤로 살짝 눕는다 (직각이면 사무용 파티션처럼 보인다)
     *   · 등받이와 앉는 면 사이가 떠 있다
     *   · 뒷다리가 등받이까지 이어져 올라간다
     */
    case "chair": {
      const seatY = -h / 2 + h * 0.45;
      const seatH = Math.max(0.035, h * 0.07);
      const backH = h * 0.4;
      const backY = seatY + seatH / 2 + h * 0.06 + backH / 2;
      const backZ = -d / 2 + d * 0.1;
      /** 등받이가 뒤로 눕는 각 — 6도쯤이 앉아 본 느낌이 난다 */
      const recline = -0.1;

      return (
        <group>
          {/* 방석 */}
          <RoundedBox
            args={[w * 0.94, seatH, d * 0.92]}
            radius={Math.min(0.02, seatH * 0.45)}
            smoothness={4}
            position={[0, seatY, d * 0.02]}
            material={mat}
            castShadow
            receiveShadow
          />

          {/* 등받이 — 뒤로 눕히고 앉는 면과 띄운다 */}
          <group position={[0, backY, backZ]} rotation={[recline, 0, 0]}>
            <RoundedBox
              args={[w * 0.9, backH, Math.max(0.022, d * 0.07)]}
              radius={0.018}
              smoothness={4}
              material={mat}
              castShadow
            />
          </group>

          {/* 뒷다리는 등받이 높이까지 이어 올린다 */}
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[side * (w * 0.43 - 0.018), (-h / 2 + backY) / 2, backZ]}
              castShadow
            >
              <cylinderGeometry args={[0.018, 0.016, backY + h / 2, 10]} />
              <meshStandardMaterial color="#5b4632" roughness={0.55} />
            </mesh>
          ))}

          {/* 앞다리 — 앉는 면까지만 */}
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[side * (w * 0.43 - 0.018), (-h / 2 + seatY) / 2, d / 2 - d * 0.12]}
              castShadow
            >
              <cylinderGeometry args={[0.018, 0.016, seatY + h / 2, 10]} />
              <meshStandardMaterial color="#5b4632" roughness={0.55} />
            </mesh>
          ))}

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
          {/* 상판 밑면까지 — 이 둘이 어긋나면 옆에서 봤을 때 상판이 떠 보인다 */}
          <Legs
            width={w * 0.9}
            depth={d * 0.86}
            height={h - topH}
            floorY={-h / 2}
            radius={0.02}
          />
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

    /*
     * 침대.
     *
     * 프레임 + 매트리스 + 베개만 있으면 매트리스를 얹은 평상으로 보인다. 침대를
     * 침대로 만드는 것은 정리된 침구의 결이다.
     *   · 이불이 매트리스를 덮되 발치 쪽으로 조금 짧다
     *   · 머리맡에서 이불을 접어 넘긴 단이 있다 (호텔 침구의 그 선)
     *   · 베개가 머리판에 살짝 기대어 서 있다
     *   · 머리판이 매트리스보다 확실히 높다
     *
     * 머리맡은 y 가 작은 쪽, 즉 -z 다 (회전 0도에서 정면이 도면 아래를 본다).
     */
    case "bed": {
      const baseH = h * 0.32;
      const mattressH = h * 0.24;
      const mattressY = -h / 2 + baseH + mattressH / 2;
      const mattressTop = mattressY + mattressH / 2;
      const headZ = -d / 2;

      return (
        <group>
          {/* 프레임 */}
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

          {/* 매트리스 */}
          <RoundedBox
            args={[w * 0.97, mattressH, d * 0.96]}
            radius={0.045}
            smoothness={4}
            position={[0, mattressY, 0]}
            material={mat}
            castShadow
          />

          {/* 이불 — 발치를 덮고 머리맡은 비운다 */}
          <RoundedBox
            args={[w * 0.99, h * 0.05, d * 0.62]}
            radius={0.03}
            smoothness={4}
            position={[0, mattressTop + h * 0.02, d * 0.17]}
            castShadow
          >
            <meshStandardMaterial color="#d9d5cc" roughness={0.92} />
          </RoundedBox>

          {/* 접어 넘긴 단 — 이 선 하나가 정리된 침구로 보이게 한다 */}
          <RoundedBox
            args={[w * 0.99, h * 0.055, d * 0.1]}
            radius={0.025}
            smoothness={4}
            position={[0, mattressTop + h * 0.035, -d * 0.15]}
            castShadow
          >
            <meshStandardMaterial color="#efece5" roughness={0.9} />
          </RoundedBox>

          {/* 베개 둘 — 머리판에 살짝 기대어 눕힌다 */}
          {[-1, 1].map((side) => (
            <group
              key={side}
              position={[side * w * 0.23, mattressTop + h * 0.055, headZ + d * 0.13]}
              rotation={[0.28, 0, 0]}
            >
              <RoundedBox args={[w * 0.4, h * 0.09, d * 0.17]} radius={0.045} smoothness={4} castShadow>
                <meshStandardMaterial color="#f6f4ef" roughness={0.95} />
              </RoundedBox>
            </group>
          ))}

          {/* 머리판 — 매트리스보다 확실히 높아야 침대로 읽힌다 */}
          <RoundedBox
            args={[w, h * 0.66, Math.max(0.05, d * 0.03)]}
            radius={0.025}
            smoothness={4}
            position={[0, -h / 2 + h * 0.52, headZ - d * 0.015]}
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
