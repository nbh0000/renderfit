import type { Scene, SceneLight, SceneObject, SceneVersion } from "../types";
import { createId } from "../engine/SceneEngine";
import { DEFAULT_MATERIALS } from "@/models/materials";
import { parseScene } from "../validation";
import { ensureRoom, rectangleWalls, wallLength } from "../geometry";

/** 새 프로젝트의 기본 조명 세트 */
export function defaultLights(): SceneLight[] {
  return [
    {
      id: "light_ambient",
      name: "환경광",
      type: "ambient",
      intensity: 0.6,
      color: "#ffffff",
      temperature: 4500,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      enabled: true,
    },
    {
      id: "light_window",
      name: "창문 자연광",
      type: "directional",
      intensity: 1.1,
      color: "#fff4e6",
      temperature: 5200,
      position: [3, 3, 2],
      rotation: [-35, 25, 0],
      enabled: true,
    },
    {
      id: "light_ceiling",
      name: "천장 조명",
      type: "point",
      intensity: 0.8,
      color: "#ffe9cc",
      temperature: 3000,
      position: [0, 2.4, 0],
      rotation: [0, 0, 0],
      enabled: true,
    },
  ];
}

export function createEmptyScene(roomType = "living-room"): Scene {
  return {
    sceneId: createId("scene"),
    version: 1,
    room: {
      type: roomType,
      dimensions: { width: 5000, length: 6000, height: 2700 },
      walls: rectangleWalls({ width: 5000, length: 6000, height: 2700 }),
      measured: false,
    },
    camera: {
      position: [0, 1.5, 4.5],
      rotation: [0, 0, 0],
      fov: 50,
      near: 0.1,
      far: 100,
      projection: "perspective",
    },
    source: {
      imageUrl: null,
      generatedImageUrl: null,
      depthMapUrl: null,
      segmentationUrl: null,
      width: 1280,
      height: 960,
    },
    objects: [],
    materials: DEFAULT_MATERIALS.map((m) => ({ ...m })),
    lights: defaultLights(),
    renderSettings: { resolution: [1920, 1080], quality: "preview" },
    styleId: null,
    updatedAt: new Date().toISOString(),
  };
}

/** 예전 형식(벽 없음)으로 저장된 Scene을 현재 모델로 맞춘다 */
export function normalizeScene(scene: Scene): Scene {
  return { ...scene, room: ensureRoom(scene.room) };
}

export function sceneToJSON(scene: Scene): string {
  return JSON.stringify(scene, null, 2);
}

/** 외부에서 들어온 Scene JSON은 반드시 검증을 통과해야 한다. */
export function sceneFromJSON(json: string | unknown): Scene {
  const raw = typeof json === "string" ? JSON.parse(json) : json;
  return parseScene(raw);
}

export function createVersion(scene: Scene, label: string): SceneVersion {
  return {
    id: createId("ver"),
    version: scene.version,
    label,
    createdAt: new Date().toISOString(),
    scene: JSON.parse(JSON.stringify(scene)) as Scene,
  };
}

/** Scene 요약 — 대시보드 카드나 AI 프롬프트 컨텍스트에 쓴다. */
export function summarizeScene(scene: Scene): string {
  const visible = scene.objects.filter((o) => o.visibility);
  const byType = new Map<string, number>();
  for (const object of visible) {
    byType.set(object.type, (byType.get(object.type) ?? 0) + 1);
  }
  const parts = [...byType.entries()].map(([type, count]) => `${type}×${count}`);
  return `${scene.room.type} · 객체 ${visible.length}개 (${parts.join(", ") || "없음"})`;
}

/** AI에게 넘길 최소 컨텍스트 (전체 Scene을 그대로 주지 않는다) */
export function sceneContextForAI(scene: Scene): {
  roomType: string;
  styleId: string | null;
  room: {
    dimensions: { width: number; length: number; height: number };
    measured: boolean;
    walls: {
      id: string;
      name: string;
      length: number;
      thickness: number;
      openings: { id: string; name: string; type: string; width: number; height: number }[];
    }[];
  };
  objects: { id: string; name: string; type: string; materialId: string | null }[];
  materials: { id: string; name: string; baseColor: string }[];
  lights: { id: string; name: string; type: string }[];
} {
  const room = ensureRoom(scene.room);

  return {
    roomType: scene.room.type,
    styleId: scene.styleId,
    room: {
      dimensions: room.dimensions,
      measured: room.measured ?? false,
      walls: (room.walls ?? []).map((wall) => ({
        id: wall.id,
        name: wall.name,
        length: Math.round(wallLength(wall)),
        thickness: wall.thickness,
        openings: (wall.openings ?? []).map((opening) => ({
          id: opening.id,
          name: opening.name,
          type: opening.type,
          width: opening.width,
          height: opening.height,
        })),
      })),
    },
    objects: scene.objects.map((o: SceneObject) => ({
      id: o.id,
      name: o.name,
      type: o.type,
      materialId: o.materialId,
    })),
    materials: scene.materials.map((m) => ({ id: m.id, name: m.name, baseColor: m.baseColor })),
    lights: scene.lights.map((l) => ({ id: l.id, name: l.name, type: l.type })),
  };
}
