import { ELECTRICAL_MAP } from "@/config/electrical";

/** [[x,y],...] 형태만 받아들인다 — 잘못된 좌표가 Scene에 들어가면 도면이 깨진다 */
function normalizePoints(value: unknown): [number, number][] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const points: [number, number][] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length < 2) return null;
    const [x, y] = item;
    if (typeof x !== "number" || typeof y !== "number") return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push([Math.round(x), Math.round(y)]);
  }
  return points;
}
import type { ElectricalKind } from "@/scene/types";
import type { StructuredCommand, ToolDefinition } from "@/ai/providers/types";
import type { Asset, SceneObject } from "@/scene/types";
import { SceneEngine, createSceneObject } from "@/scene/engine/SceneEngine";
import { ASSET_MAP, searchAssets } from "@/models/assets";
import { STYLE_PRESET_MAP } from "@/models/styles";
import { MATERIAL_MAP } from "@/models/materials";
import { createOpening, createWall, findFreeOffset } from "@/scene/geometry";

/**
 * AI Agent Tools.
 *
 * LLM은 Scene JSON을 직접 수정하지 않는다. 반드시 이 tool들 중 하나를 호출하고,
 * Scene Engine이 validation 후 실행한다. (잘못된 명령은 Scene에 닿지 않는다)
 */

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "select_object",
    description: "캔버스에서 객체를 선택한다.",
    parameters: { objectId: "string" },
  },
  {
    name: "move_object",
    description: "객체를 이동한다. dx/dy는 화면 기준 0~1 비율 이동량.",
    parameters: { objectId: "string", dx: "number", dy: "number" },
  },
  {
    name: "rotate_object",
    description: "객체를 회전한다.",
    parameters: { objectId: "string", degrees: "number" },
  },
  {
    name: "scale_object",
    description: "객체 크기를 배율로 조정한다.",
    parameters: { objectId: "string", factor: "number" },
  },
  { name: "delete_object", description: "객체를 삭제한다.", parameters: { objectId: "string" } },
  { name: "duplicate_object", description: "객체를 복제한다.", parameters: { objectId: "string" } },
  {
    name: "add_object",
    description:
      "가구/소품을 장면에 추가한다. 외부 무료 모델을 넣을 때는 modelUrl과 치수(widthMm/heightMm/depthMm)를 함께 준다.",
    parameters: {
      type: "string",
      assetId: "string|null",
      name: "string",
      modelUrl: "string",
      attribution: "string",
      widthMm: "number",
      heightMm: "number",
      depthMm: "number",
      levelId: "string",
    },
  },
  {
    name: "replace_object",
    description: "객체를 다른 에셋으로 교체한다.",
    parameters: { objectId: "string", assetId: "string|null", query: "string" },
  },
  {
    name: "change_material",
    description: "객체의 재질을 변경한다.",
    parameters: { objectId: "string", materialId: "string" },
  },
  {
    name: "set_surface_material",
    description: "바닥·벽·천장의 마감재를 바꾼다.",
    parameters: { surface: "floor|wall|ceiling", materialId: "string" },
  },
  {
    name: "change_color",
    description: "객체의 색상을 변경한다.",
    parameters: { objectId: "string", color: "string" },
  },
  {
    name: "rename_object",
    description: "객체 이름을 변경한다.",
    parameters: { objectId: "string", name: "string" },
  },
  {
    name: "change_visibility",
    description: "객체 표시/숨김을 전환한다.",
    parameters: { objectId: "string", visibility: "boolean" },
  },
  {
    name: "change_lock",
    description: "객체 잠금을 전환한다.",
    parameters: { objectId: "string", locked: "boolean" },
  },
  {
    name: "reorder_object",
    description: "레이어 순서를 변경한다.",
    parameters: { objectId: "string", order: "number" },
  },
  {
    name: "change_lighting",
    description: "조명의 밝기나 색온도를 조정한다.",
    parameters: { lightId: "string|null", intensityDelta: "number", temperature: "number" },
  },
  {
    name: "change_style",
    description: "전체 공간의 스타일을 바꾼다.",
    parameters: { styleId: "string" },
  },
  {
    name: "generate_region",
    description: "AI 이미지 생성을 실행한다.",
    parameters: { prompt: "string" },
  },
  {
    name: "inpaint_region",
    description: "선택 영역만 AI로 다시 그린다.",
    parameters: { objectId: "string", prompt: "string" },
  },
  {
    name: "set_room",
    description: "방의 실측 치수를 입력한다 (mm).",
    parameters: { width: "number", length: "number", height: "number", measured: "boolean" },
  },
  {
    name: "calibrate_scale",
    description: "벽 하나의 실제 길이를 받아 평면 전체의 축척을 맞춘다.",
    parameters: { wallId: "string", actualMm: "number" },
  },
  {
    name: "set_dimensions",
    description: "객체의 실측 치수를 입력한다 (mm).",
    parameters: { objectId: "string", width: "number", height: "number", depth: "number" },
  },
  {
    name: "add_wall",
    description: "벽을 추가한다. 좌표는 평면 mm.",
    parameters: { x1: "number", y1: "number", x2: "number", y2: "number", thickness: "number" , levelId: "string" },
  },
  {
    name: "update_wall",
    description: "벽의 두께·높이·이름·좌표를 수정한다.",
    parameters: { wallId: "string", thickness: "number", height: "number", name: "string" },
  },
  { name: "delete_wall", description: "벽을 삭제한다.", parameters: { wallId: "string" } },
  {
    name: "add_opening",
    description: "벽에 문 또는 창을 낸다.",
    parameters: { wallId: "string", type: "door|window", offset: "number", width: "number", height: "number" },
  },
  {
    name: "update_opening",
    description:
      "개구부의 위치·크기와 문 사양(문 종류·경첩 위치·열림 방향)을 수정한다. doorType은 hinged|sliding|folding|opening, hinge는 start|end, swing은 in|out.",
    parameters: {
      wallId: "string",
      openingId: "string",
      offset: "number",
      width: "number",
      height: "number",
      sillHeight: "number",
      doorType: "string",
      hinge: "string",
      swing: "string",
    },
  },
  {
    name: "delete_opening",
    description: "개구부를 제거한다.",
    parameters: { wallId: "string", openingId: "string" },
  },
  {
    name: "add_level",
    description: "층을 추가한다. 비우면 맨 위 층 위에 같은 높이로 얹는다.",
    parameters: { name: "string", height: "number", elevation: "number" },
  },
  {
    name: "update_level",
    description: "층의 이름·높이·바닥 레벨을 수정한다.",
    parameters: { levelId: "string", name: "string", height: "number", elevation: "number", visible: "boolean" },
  },
  {
    name: "delete_level",
    description: "층을 삭제한다. 그 층의 벽·실·가구도 함께 사라진다.",
    parameters: { levelId: "string" },
  },
  {
    name: "add_room_area",
    description:
      "실(방) 영역을 추가한다. points는 [[x,y],...] 폴리곤 좌표(mm). points를 비우면 방 외곽 전체를 실 하나로 만든다.",
    parameters: { name: "string", points: "array", color: "string" , levelId: "string" },
  },
  {
    name: "update_room_area",
    description: "실의 이름·경계·바닥 마감을 수정한다.",
    parameters: {
      areaId: "string",
      name: "string",
      points: "array",
      color: "string",
      floorMaterialId: "string",
    },
  },
  {
    name: "delete_room_area",
    description: "실을 삭제한다.",
    parameters: { areaId: "string" },
  },
  {
    name: "add_annotation",
    description:
      "도면에 치수선·텍스트·폴리라인을 추가한다. type은 dimension|text|polyline, points는 [[x,y],...] 평면 좌표(mm).",
    parameters: {
      type: "string",
      points: "array",
      text: "string",
      offset: "number",
      fontSize: "number",
      thickness: "number",
      levelId: "string",
    },
  },
  {
    name: "update_annotation",
    description: "주석의 위치·내용을 수정한다.",
    parameters: { annotationId: "string", points: "array", text: "string", offset: "number" },
  },
  {
    name: "delete_annotation",
    description: "주석을 삭제한다.",
    parameters: { annotationId: "string" },
  },
  {
    name: "derive_openings",
    description:
      "사진 분석으로 찾은 창문·문을 벽의 개구부로 반영한다. 평면도·측면도·3D에 실제 구조로 나타난다.",
    parameters: {},
  },
  {
    name: "add_fixture",
    description:
      "콘센트·스위치·조명 같은 전기/통신 설비를 추가한다. kind는 outlet|outlet-aircon|switch|switch-3way|ceiling-light|wall-light|data|tv-jack|panel. 벽에 붙이려면 wallId와 offset(벽 시작점에서 mm)을, 천장이면 wallId 없이 쓴다.",
    parameters: {
      kind: "string",
      wallId: "string",
      offset: "number",
      height: "number",
      name: "string",
      levelId: "string",
    },
  },
  {
    name: "update_fixture",
    description: "설비의 위치·높이를 수정한다.",
    parameters: { fixtureId: "string", wallId: "string", offset: "number", height: "number" },
  },
  {
    name: "delete_fixture",
    description: "설비를 제거한다.",
    parameters: { fixtureId: "string" },
  },
  {
    name: "arrange_objects",
    description: "가구를 벽에 맞춰 겹치지 않게 자동 배치한다.",
    parameters: {},
  },
  { name: "search_asset", description: "가구 에셋을 검색한다.", parameters: { query: "string" } },
  { name: "render_preview", description: "미리보기 렌더를 실행한다.", parameters: {} },
  { name: "render_final", description: "최종 렌더를 실행한다.", parameters: {} },
];

export type JobRequest =
  | { type: "GENERATE_INTERIOR"; params: { prompt?: string; styleId?: string | null } }
  | { type: "INPAINT"; params: { objectId: string; prompt: string } }
  | { type: "RENDER_PREVIEW"; params: Record<string, never> }
  | { type: "RENDER_FINAL"; params: Record<string, never> };

export interface ToolExecutionResult {
  ok: boolean;
  tool: string;
  message: string;
  error?: string;
  /** 실행된 scene operation id */
  operationId?: string;
  /** UI가 선택해야 할 객체 */
  selectObjectId?: string;
  /** 뒤이어 실행해야 할 비동기 작업 */
  job?: JobRequest;
  /** search_asset 결과 */
  assets?: Asset[];
}

/** 에셋을 Scene 객체로 변환한다 (2.5D 배치 포함) */
export function objectFromAsset(
  asset: Asset,
  options: { order: number; offsetIndex?: number } = { order: 0 }
): SceneObject {
  const offset = (options.offsetIndex ?? 0) * 0.08;
  const footprint = Math.min(0.32, Math.max(0.08, asset.dimensions.width / 6000));
  const heightRatio = Math.min(0.4, Math.max(0.06, asset.dimensions.height / 3000));

  return createSceneObject(
    {
      type: asset.type,
      name: asset.name,
      category: asset.category,
      assetId: asset.id,
      modelUrl: asset.modelUrl ?? null,
      imageUrl: asset.imageUrl ?? null,
      materialId: asset.materials[0] ?? null,
      dimensions: asset.dimensions,
      screen: {
        x: Math.min(0.85, 0.35 + offset),
        y: asset.type === "rug" ? 0.74 : 0.55,
        width: footprint,
        height: heightRatio,
        rotation: 0,
      },
      transform: {
        position: [offset * 3, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      depth: 0.45,
      confidence: 1,
      source: "ai_command",
      metadata: { addedBy: "ai_command" },
    },
    options.order
  );
}

/** Scene Engine 위에서 tool call 하나를 실행한다. */
export function executeCommand(engine: SceneEngine, command: StructuredCommand): ToolExecutionResult {
  const args = command.arguments as Record<string, never>;
  const objectId = (args.objectId as string | undefined) ?? undefined;
  const scene = engine.getScene();

  const fail = (error: string): ToolExecutionResult => ({
    ok: false,
    tool: command.tool,
    message: error,
    error,
  });

  switch (command.tool) {
    case "noop":
      return fail((args.reason as string) ?? "실행할 수 없는 명령입니다.");

    case "select_object":
      if (!objectId) return fail("선택할 객체가 없습니다.");
      return { ok: true, tool: command.tool, message: "객체를 선택했습니다.", selectObjectId: objectId };

    case "move_object": {
      if (!objectId) return fail("이동할 객체가 없습니다.");
      const object = engine.getObject(objectId);
      if (!object) return fail("대상 객체를 찾을 수 없습니다.");
      // dx/dy = 상대 이동(2.5D 드래그·AI 명령), x/depth = 절대 위치(3D 배치)
      const hasAbsolute = typeof args.x === "number" || typeof args.depth === "number";

      // 3D에서 끌어다 놓은 경우에는 벽 스냅·겹침 회피를 적용해 사람이 놓은 것처럼 정리한다.
      if (hasAbsolute && args.snap === true) {
        const room = engine.getScene().room;
        const cx =
          (((args.x as number) ?? object.screen.x) + object.screen.width / 2) *
          room.dimensions.width;
        const cy = ((args.depth as number) ?? object.depth) * room.dimensions.length;
        const placed = engine.placeObject(objectId, { cx, cy });
        return toResult(command, placed, "가구를 배치했습니다.", objectId);
      }

      const result = engine.moveObject(objectId, {
        screen: {
          x: hasAbsolute
            ? ((args.x as number) ?? object.screen.x)
            : object.screen.x + ((args.dx as number) ?? 0),
          y: hasAbsolute
            ? ((args.y as number) ?? object.screen.y)
            : object.screen.y + ((args.dy as number) ?? 0),
        },
        ...(typeof args.depth === "number" ? { depth: args.depth as number } : {}),
      });
      return toResult(command, result, "객체를 이동했습니다.", objectId);
    }

    case "rotate_object": {
      if (!objectId) return fail("회전할 객체가 없습니다.");
      const object = engine.getObject(objectId);
      if (!object) return fail("대상 객체를 찾을 수 없습니다.");
      const result = engine.rotateObject(objectId, {
        screen: object.screen.rotation + ((args.degrees as number) ?? 15),
      });
      return toResult(command, result, "객체를 회전했습니다.", objectId);
    }

    case "scale_object": {
      if (!objectId) return fail("크기를 바꿀 객체가 없습니다.");
      const factor = (args.factor as number) ?? 1.2;
      const result = engine.scaleObject(objectId, { factor });
      return toResult(command, result, "객체 크기를 조정했습니다.", objectId);
    }

    case "delete_object": {
      if (!objectId) return fail("삭제할 객체가 없습니다.");
      const result = engine.deleteObject(objectId);
      return toResult(command, result, "객체를 삭제했습니다.");
    }

    case "duplicate_object": {
      if (!objectId) return fail("복제할 객체가 없습니다.");
      const result = engine.duplicateObject(objectId);
      return toResult(command, result, "객체를 복제했습니다.", result.operation?.objectId);
    }

    case "add_object": {
      const assetId = args.assetId as string | undefined;
      const asset =
        (assetId ? ASSET_MAP[assetId] : undefined) ??
        searchAssets((args.name as string) ?? (args.type as string) ?? "", 1)[0];

      if (!asset) return fail("추가할 가구를 찾지 못했습니다.");

      const object = objectFromAsset(asset, {
        order: scene.objects.length,
        offsetIndex: (args.offsetIndex as number) ?? 0,
      });

      /*
       * 외부 모델(Poly Pizza 등)은 카탈로그에 없으므로 여기서 직접 붙인다.
       * 저작자 표시가 필요한 라이선스가 있어 attribution도 함께 저장한다.
       */
      if (typeof args.modelUrl === "string" && args.modelUrl) {
        object.modelUrl = String(args.modelUrl);
        object.name = typeof args.name === "string" ? String(args.name) : object.name;
        if (typeof args.attribution === "string") object.attribution = String(args.attribution);
        if (typeof args.type === "string") object.type = args.type as typeof object.type;

        for (const [key, field] of [
          ["widthMm", "width"],
          ["heightMm", "height"],
          ["depthMm", "depth"],
        ] as const) {
          const value = args[key as never];
          if (typeof value === "number" && value > 0) {
            object.dimensions[field] = value;
          }
        }
      }

      // 에셋이 참조하는 재질이 Scene에 없으면 먼저 넣어 준다.
      if (object.materialId && !scene.materials.some((m) => m.id === object.materialId)) {
        const material = MATERIAL_MAP[object.materialId];
        if (material) engine.addMaterial(material);
      }

      if (typeof args.levelId === "string") object.levelId = String(args.levelId);

      const result = engine.addObject(object);
      return toResult(command, result, `${asset.name}을(를) 추가했습니다.`, object.id);
    }

    case "replace_object": {
      if (!objectId) return fail("교체할 객체가 없습니다.");
      const target = engine.getObject(objectId);
      if (!target) return fail("대상 객체를 찾을 수 없습니다.");

      const assetId = args.assetId as string | undefined;
      const asset =
        (assetId ? ASSET_MAP[assetId] : undefined) ??
        searchAssets((args.query as string) ?? target.type, 1).find((a) => a.id !== target.assetId);

      if (!asset) return fail("교체할 가구를 찾지 못했습니다.");

      if (asset.materials[0] && !scene.materials.some((m) => m.id === asset.materials[0])) {
        const material = MATERIAL_MAP[asset.materials[0]];
        if (material) engine.addMaterial(material);
      }

      const result = engine.replaceObject(objectId, {
        name: asset.name,
        type: asset.type,
        category: asset.category,
        assetId: asset.id,
        materialId: asset.materials[0] ?? target.materialId,
        dimensions: asset.dimensions,
      });
      return toResult(command, result, `${asset.name}(으)로 교체했습니다.`, objectId);
    }

    case "change_material": {
      if (!objectId) return fail("재질을 바꿀 객체가 없습니다.");
      const materialId = args.materialId as string;
      if (!scene.materials.some((m) => m.id === materialId)) {
        const material = MATERIAL_MAP[materialId];
        if (!material) return fail("존재하지 않는 재질입니다.");
        engine.addMaterial(material);
      }
      const result = engine.changeMaterial(objectId, materialId);
      return toResult(command, result, "재질을 변경했습니다.", objectId);
    }

    case "set_surface_material": {
      const surface = args.surface as "floor" | "wall" | "ceiling";
      if (!["floor", "wall", "ceiling"].includes(surface)) {
        return fail("바닥·벽·천장 중 하나를 지정해 주세요.");
      }

      const materialId = args.materialId as string | null;
      const material = materialId ? MATERIAL_MAP[materialId] : null;
      if (materialId && !material) return fail("존재하지 않는 재질입니다.");

      const result = engine.setSurfaceFinish(surface, material ?? null);
      const label = { floor: "바닥재", wall: "벽 마감", ceiling: "천장 마감" }[surface];
      return toResult(command, result, material ? `${label}를 ${material.name}(으)로 바꿨습니다.` : `${label}를 되돌렸습니다.`);
    }

    case "change_color": {
      if (!objectId) return fail("색을 바꿀 객체가 없습니다.");
      const result = engine.changeColor(
        objectId,
        (args.color as string) ?? "#d8c8b2",
        args.label as string | undefined
      );
      return toResult(command, result, "색상을 변경했습니다.", objectId);
    }

    case "rename_object": {
      if (!objectId) return fail("이름을 바꿀 객체가 없습니다.");
      const result = engine.renameObject(objectId, (args.name as string) ?? "");
      return toResult(command, result, "이름을 변경했습니다.", objectId);
    }

    case "change_visibility": {
      if (!objectId) return fail("대상 객체가 없습니다.");
      const result = engine.setVisibility(objectId, Boolean(args.visibility));
      return toResult(command, result, "표시 상태를 변경했습니다.");
    }

    case "change_lock": {
      if (!objectId) return fail("대상 객체가 없습니다.");
      const result = engine.setLocked(objectId, Boolean(args.locked));
      return toResult(command, result, "잠금 상태를 변경했습니다.");
    }

    case "reorder_object": {
      if (!objectId) return fail("대상 객체가 없습니다.");
      const result = engine.reorderObject(objectId, Number(args.order ?? 0));
      return toResult(command, result, "순서를 변경했습니다.", objectId);
    }

    case "change_lighting": {
      const lightId = (args.lightId as string | undefined) ?? scene.lights[0]?.id;
      if (!lightId) return fail("조정할 조명이 없습니다.");

      const light = scene.lights.find((l) => l.id === lightId);
      if (!light) return fail("조명을 찾을 수 없습니다.");

      const patch: Record<string, unknown> = {};
      if (typeof args.intensityDelta === "number") {
        patch.intensity = Math.max(0, light.intensity + (args.intensityDelta as number));
      }
      if (typeof args.intensity === "number") patch.intensity = args.intensity as number;
      if (typeof args.temperature === "number") patch.temperature = args.temperature as number;
      if (typeof args.color === "string") patch.color = args.color as string;

      if (Object.keys(patch).length === 0) return fail("조명 변경 값이 없습니다.");

      const result = engine.changeLight(lightId, patch);
      return toResult(command, result, "조명을 조정했습니다.");
    }

    case "change_style": {
      const styleId = args.styleId as string;
      const preset = STYLE_PRESET_MAP[styleId];
      if (!preset) return fail("알 수 없는 스타일입니다.");

      engine.setStyle(styleId);

      // 벽/바닥 재질을 스타일 기본값으로 맞춘다 (있을 때만).
      for (const [type, materialId] of [
        ["wall", preset.defaultMaterials.wall],
        ["floor", preset.defaultMaterials.floor],
      ] as const) {
        const target = engine.getScene().objects.find((o) => o.type === type && !o.locked);
        if (!target) continue;
        if (!engine.getScene().materials.some((m) => m.id === materialId)) {
          const material = MATERIAL_MAP[materialId];
          if (material) engine.addMaterial(material);
        }
        engine.changeMaterial(target.id, materialId);
      }

      return {
        ok: true,
        tool: command.tool,
        message: `${preset.label} 스타일을 적용합니다.`,
        job: { type: "GENERATE_INTERIOR", params: { styleId } },
      };
    }

    case "generate_region":
      return {
        ok: true,
        tool: command.tool,
        message: "AI 생성을 시작합니다.",
        job: { type: "GENERATE_INTERIOR", params: { prompt: args.prompt as string } },
      };

    case "inpaint_region": {
      if (!objectId) return fail("인페인팅할 영역이 없습니다.");
      return {
        ok: true,
        tool: command.tool,
        message: "선택 영역을 다시 그립니다.",
        job: { type: "INPAINT", params: { objectId, prompt: (args.prompt as string) ?? "" } },
      };
    }

    case "set_room": {
      const result = engine.setRoomDimensions(
        {
          ...(typeof args.width === "number" ? { width: args.width as number } : {}),
          ...(typeof args.length === "number" ? { length: args.length as number } : {}),
          ...(typeof args.height === "number" ? { height: args.height as number } : {}),
        },
        {
          ...(typeof args.measured === "boolean" ? { measured: args.measured as boolean } : {}),
          ...(typeof args.note === "string" ? { note: args.note as string } : {}),
        }
      );
      return toResult(command, result, "방 치수를 반영했습니다.");
    }

    case "calibrate_scale": {
      const wallId = args.wallId as string;
      const actualMm = Number(args.actualMm);
      const result = engine.calibrateScale(wallId, actualMm);
      return toResult(command, result, "실측 길이에 맞춰 도면 축척을 보정했습니다.");
    }

    case "set_dimensions": {
      if (!objectId) return fail("대상 객체가 없습니다.");
      const result = engine.setDimensions(objectId, {
        ...(typeof args.width === "number" ? { width: args.width as number } : {}),
        ...(typeof args.height === "number" ? { height: args.height as number } : {}),
        ...(typeof args.depth === "number" ? { depth: args.depth as number } : {}),
      });
      return toResult(command, result, "치수를 반영했습니다.", objectId);
    }

    case "add_wall": {
      const levelId = typeof args.levelId === "string" ? String(args.levelId) : undefined;
      const wall = createWall({
        start: [Number(args.x1 ?? 0), Number(args.y1 ?? 0)],
        end: [Number(args.x2 ?? 0), Number(args.y2 ?? 0)],
        thickness: typeof args.thickness === "number" ? (args.thickness as number) : undefined,
        height: scene.room.dimensions.height,
        name: (args.name as string) ?? "벽",
      });
      const result = engine.addWall(levelId ? { ...wall, levelId } : wall);
      return toResult(command, result, "벽을 추가했습니다.");
    }

    case "update_wall": {
      const wallId = args.wallId as string;
      if (!wallId) return fail("대상 벽이 없습니다.");
      const patch: Record<string, unknown> = {};
      if (typeof args.thickness === "number") patch.thickness = args.thickness;
      if (typeof args.height === "number") patch.height = args.height;
      if (typeof args.name === "string") patch.name = args.name;
      if (Array.isArray(args.start)) patch.start = args.start;
      if (Array.isArray(args.end)) patch.end = args.end;
      const result = engine.updateWall(wallId, patch);
      return toResult(command, result, "벽을 수정했습니다.");
    }

    case "delete_wall": {
      const wallId = args.wallId as string;
      if (!wallId) return fail("대상 벽이 없습니다.");
      const result = engine.deleteWall(wallId);
      return toResult(command, result, "벽을 삭제했습니다.");
    }

    case "add_opening": {
      const wallId = args.wallId as string;
      if (!wallId) return fail("대상 벽이 없습니다.");

      // 위치를 안 주면(주로 AI 명령) 기존 문·창과 겹치지 않는 자리를 찾아 놓는다.
      const targetWall = engine.getWall(wallId);
      if (!targetWall) return fail("대상 벽을 찾을 수 없습니다.");

      const openingType = (args.type as "door" | "window") ?? "window";
      let offset = typeof args.offset === "number" ? (args.offset as number) : undefined;
      const openingWidth =
        typeof args.width === "number" ? (args.width as number) : openingType === "door" ? 900 : 1500;

      if (offset === undefined) {
        const free = findFreeOffset(targetWall, openingWidth);
        if (free === null) {
          return fail(`${targetWall.name}에는 더 놓을 자리가 없습니다.`);
        }
        offset = free;
      }

      const opening = createOpening(openingType, {
        offset,
        width: openingWidth,
        ...(typeof args.height === "number" ? { height: args.height as number } : {}),
        ...(typeof args.sillHeight === "number" ? { sillHeight: args.sillHeight as number } : {}),
        ...(typeof args.name === "string" ? { name: args.name as string } : {}),
      });
      const result = engine.addOpening(wallId, opening);
      return toResult(command, result, "개구부를 추가했습니다.");
    }

    case "add_level": {
      return toResult(
        command,
        engine.addLevel({
          name: typeof args.name === "string" ? String(args.name) : undefined,
          height: typeof args.height === "number" ? args.height : undefined,
          elevation: typeof args.elevation === "number" ? args.elevation : undefined,
        }),
        "층을 추가했습니다."
      );
    }

    case "update_level": {
      const levelId = args.levelId as string;
      if (!levelId) return fail("대상 층이 없습니다.");

      const patch: Record<string, unknown> = {};
      if (typeof args.name === "string") patch.name = String(args.name);
      if (typeof args.height === "number") patch.height = args.height;
      if (typeof args.elevation === "number") patch.elevation = args.elevation;
      if (typeof args.visible === "boolean") patch.visible = args.visible;

      return toResult(command, engine.updateLevel(levelId, patch), "층을 수정했습니다.");
    }

    case "delete_level": {
      const levelId = args.levelId as string;
      if (!levelId) return fail("대상 층이 없습니다.");
      return toResult(command, engine.deleteLevel(levelId), "층을 삭제했습니다.");
    }

    case "add_room_area": {
      const name = typeof args.name === "string" ? String(args.name).trim() || "실" : "실";
      const points = normalizePoints(args.points);

      // 좌표를 주지 않으면 방 외곽을 그대로 실로 잡는다.
      if (!points) return toResult(command, engine.addAreaFromRoomBounds(name), `${name}을(를) 만들었습니다.`);

      return toResult(
        command,
        engine.addArea({
          id: `area_${Math.random().toString(36).slice(2, 10)}`,
          name,
          points,
          showArea: true,
          ...(typeof args.levelId === "string" ? { levelId: String(args.levelId) } : {}),
          ...(typeof args.color === "string" ? { color: args.color } : {}),
        }),
        `${name}을(를) 만들었습니다.`
      );
    }

    case "update_room_area": {
      const areaId = args.areaId as string;
      if (!areaId) return fail("대상 실이 없습니다.");

      const patch: Record<string, unknown> = {};
      const points = normalizePoints(args.points);
      if (points) patch.points = points;
      if (typeof args.name === "string") {
        const trimmed = String(args.name).trim();
        if (trimmed) patch.name = trimmed;
      }
      if (typeof args.color === "string") patch.color = args.color;
      if (typeof args.floorMaterialId === "string") patch.floorMaterialId = args.floorMaterialId;

      return toResult(command, engine.updateArea(areaId, patch), "실을 수정했습니다.");
    }

    case "delete_room_area": {
      const areaId = args.areaId as string;
      if (!areaId) return fail("대상 실이 없습니다.");
      return toResult(command, engine.deleteArea(areaId), "실을 삭제했습니다.");
    }

    case "add_annotation": {
      const type = args.type as "dimension" | "text" | "polyline";
      if (!["dimension", "text", "polyline"].includes(type)) {
        return fail("주석 종류가 올바르지 않습니다.");
      }

      const points = normalizePoints(args.points);
      if (!points) return fail("좌표가 올바르지 않습니다.");

      return toResult(
        command,
        engine.addAnnotation({
          id: `an_${Math.random().toString(36).slice(2, 10)}`,
          type,
          points,
          ...(typeof args.levelId === "string" ? { levelId: String(args.levelId) } : {}),
          ...(typeof args.text === "string" ? { text: args.text } : {}),
          ...(typeof args.offset === "number" ? { offset: args.offset } : {}),
          ...(typeof args.fontSize === "number" ? { fontSize: args.fontSize } : {}),
          ...(typeof args.thickness === "number" ? { thickness: args.thickness } : {}),
        }),
        "주석을 추가했습니다."
      );
    }

    case "update_annotation": {
      const annotationId = args.annotationId as string;
      if (!annotationId) return fail("대상 주석이 없습니다.");

      const patch: Record<string, unknown> = {};
      const points = normalizePoints(args.points);
      if (points) patch.points = points;
      if (typeof args.text === "string") patch.text = args.text;
      if (typeof args.offset === "number") patch.offset = args.offset;
      if (typeof args.fontSize === "number") patch.fontSize = args.fontSize;

      return toResult(command, engine.updateAnnotation(annotationId, patch), "주석을 수정했습니다.");
    }

    case "delete_annotation": {
      const annotationId = args.annotationId as string;
      if (!annotationId) return fail("대상 주석이 없습니다.");
      return toResult(command, engine.deleteAnnotation(annotationId), "주석을 삭제했습니다.");
    }

    case "derive_openings": {
      const result = engine.syncOpeningsFromObjects();
      if (!result.ok) return toResult(command, result, "");

      const skipped = result.skipped?.length
        ? ` (자리가 없어 ${result.skipped.join(", ")}은(는) 건너뜀)`
        : "";
      return toResult(command, result, `창·문 ${result.added}개를 벽에 반영했습니다.${skipped}`);
    }

    case "add_fixture": {
      const kind = args.kind as ElectricalKind;
      const spec = ELECTRICAL_MAP[kind];
      if (!spec) return fail("알 수 없는 설비 종류입니다.");

      const wallId = typeof args.wallId === "string" && args.wallId ? args.wallId : null;
      const result = engine.addFixture({
        id: `fx_${Math.random().toString(36).slice(2, 10)}`,
        ...(typeof args.levelId === "string" ? { levelId: String(args.levelId) } : {}),
        name: typeof args.name === "string" && args.name ? args.name : spec.label,
        kind,
        wallId,
        offset: typeof args.offset === "number" ? args.offset : 0,
        height: typeof args.height === "number" ? args.height : spec.defaultHeight,
      });
      return toResult(command, result, `${spec.label}을(를) 추가했습니다.`);
    }

    case "update_fixture": {
      const fixtureId = args.fixtureId as string;
      if (!fixtureId) return fail("대상 설비가 없습니다.");
      const patch: Record<string, unknown> = {};
      for (const key of ["offset", "height"]) {
        if (typeof args[key as never] === "number") patch[key] = args[key as never];
      }
      if (typeof args.wallId === "string") patch.wallId = args.wallId || null;
      if (typeof args.name === "string") patch.name = args.name;
      return toResult(command, engine.updateFixture(fixtureId, patch), "설비를 수정했습니다.");
    }

    case "delete_fixture": {
      const fixtureId = args.fixtureId as string;
      if (!fixtureId) return fail("대상 설비가 없습니다.");
      return toResult(command, engine.deleteFixture(fixtureId), "설비를 제거했습니다.");
    }

    case "update_opening": {
      const wallId = args.wallId as string;
      const openingId = args.openingId as string;
      if (!wallId || !openingId) return fail("대상 개구부가 없습니다.");
      const patch: Record<string, unknown> = {};
      for (const key of ["offset", "width", "height", "sillHeight"]) {
        if (typeof args[key as never] === "number") patch[key] = args[key as never];
      }
      if (typeof args.name === "string") patch.name = args.name;

      // 문 사양 — 값이 정해진 목록 안에 있을 때만 반영한다.
      const enums: Record<string, string[]> = {
        doorType: ["hinged", "sliding", "folding", "opening"],
        hinge: ["start", "end"],
        swing: ["in", "out"],
      };
      for (const [key, allowed] of Object.entries(enums)) {
        const value = args[key as never];
        if (typeof value === "string" && allowed.includes(value)) patch[key] = value;
      }
      const result = engine.updateOpening(wallId, openingId, patch);
      return toResult(command, result, "개구부를 수정했습니다.");
    }

    case "delete_opening": {
      const wallId = args.wallId as string;
      const openingId = args.openingId as string;
      if (!wallId || !openingId) return fail("대상 개구부가 없습니다.");
      const result = engine.deleteOpening(wallId, openingId);
      return toResult(command, result, "개구부를 제거했습니다.");
    }

    case "arrange_objects": {
      const result = engine.arrangeObjects();
      return toResult(command, result, "가구를 정리했습니다.");
    }

    case "search_asset":
      return {
        ok: true,
        tool: command.tool,
        message: "에셋을 검색했습니다.",
        assets: searchAssets((args.query as string) ?? ""),
      };

    case "render_preview":
      return {
        ok: true,
        tool: command.tool,
        message: "미리보기 렌더를 시작합니다.",
        job: { type: "RENDER_PREVIEW", params: {} },
      };

    case "render_final":
      return {
        ok: true,
        tool: command.tool,
        message: "최종 렌더를 시작합니다.",
        job: { type: "RENDER_FINAL", params: {} },
      };

    default:
      return fail(`지원하지 않는 도구입니다: ${command.tool}`);
  }
}

function toResult(
  command: StructuredCommand,
  result: { ok: boolean; error?: string; operation?: { id: string } },
  successMessage: string,
  selectObjectId?: string
): ToolExecutionResult {
  if (!result.ok) {
    return { ok: false, tool: command.tool, message: result.error ?? "실행에 실패했습니다.", error: result.error };
  }
  return {
    ok: true,
    tool: command.tool,
    message: command.explanation || successMessage,
    operationId: result.operation?.id,
    selectObjectId,
  };
}
