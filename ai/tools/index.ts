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
    description: "가구/소품을 장면에 추가한다.",
    parameters: { type: "string", assetId: "string|null", name: "string" },
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
    name: "set_dimensions",
    description: "객체의 실측 치수를 입력한다 (mm).",
    parameters: { objectId: "string", width: "number", height: "number", depth: "number" },
  },
  {
    name: "add_wall",
    description: "벽을 추가한다. 좌표는 평면 mm.",
    parameters: { x1: "number", y1: "number", x2: "number", y2: "number", thickness: "number" },
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
    description: "개구부의 위치·크기를 수정한다.",
    parameters: { wallId: "string", openingId: "string", offset: "number", width: "number", height: "number", sillHeight: "number" },
  },
  {
    name: "delete_opening",
    description: "개구부를 제거한다.",
    parameters: { wallId: "string", openingId: "string" },
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

      // 에셋이 참조하는 재질이 Scene에 없으면 먼저 넣어 준다.
      if (object.materialId && !scene.materials.some((m) => m.id === object.materialId)) {
        const material = MATERIAL_MAP[object.materialId];
        if (material) engine.addMaterial(material);
      }

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
      const wall = createWall({
        start: [Number(args.x1 ?? 0), Number(args.y1 ?? 0)],
        end: [Number(args.x2 ?? 0), Number(args.y2 ?? 0)],
        thickness: typeof args.thickness === "number" ? (args.thickness as number) : undefined,
        height: scene.room.dimensions.height,
        name: (args.name as string) ?? "벽",
      });
      const result = engine.addWall(wall);
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

    case "update_opening": {
      const wallId = args.wallId as string;
      const openingId = args.openingId as string;
      if (!wallId || !openingId) return fail("대상 개구부가 없습니다.");
      const patch: Record<string, unknown> = {};
      for (const key of ["offset", "width", "height", "sillHeight"]) {
        if (typeof args[key as never] === "number") patch[key] = args[key as never];
      }
      if (typeof args.name === "string") patch.name = args.name;
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
