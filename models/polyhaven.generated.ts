/* 이 파일은 scripts/assets/polyhaven.mjs가 만든다. 직접 고치지 말 것. */

import type { ObjectType } from "@/scene/types";

export interface PolyHavenModel {
  /** Poly Haven 에셋 id (CC0) */
  source: string;
  modelUrl: string;
  /** glTF 경계 상자에서 읽은 실제 크기 (mm) */
  dimensions: { width: number; height: number; depth: number };
}

/** 기존 카탈로그 항목에 입힐 메시 */
export const POLYHAVEN_MODELS: Record<string, PolyHavenModel> = {
  asset_sofa_beige_3: { source: "Sofa_01", modelUrl: "/models/Sofa_01/Sofa_01_1k.gltf", dimensions: {"width":1571,"height":797,"depth":658} },
  asset_sofa_grey_2: { source: "sofa_02", modelUrl: "/models/sofa_02/sofa_02_1k.gltf", dimensions: {"width":1807,"height":709,"depth":818} },
  asset_sofa_leather: { source: "sofa_03", modelUrl: "/models/sofa_03/sofa_03_1k.gltf", dimensions: {"width":2731,"height":1118,"depth":925} },
  asset_bench_entry: { source: "painted_wooden_sofa", modelUrl: "/models/painted_wooden_sofa/painted_wooden_sofa_1k.gltf", dimensions: {"width":2452,"height":1281,"depth":787} },
  asset_sofa_1seat: { source: "Ottoman_01", modelUrl: "/models/Ottoman_01/Ottoman_01_1k.gltf", dimensions: {"width":885,"height":624,"depth":621} },
  asset_lounge_chair: { source: "mid_century_lounge_chair", modelUrl: "/models/mid_century_lounge_chair/mid_century_lounge_chair_1k.gltf", dimensions: {"width":1009,"height":1169,"depth":1190} },
  asset_accent_chair: { source: "modern_arm_chair_01", modelUrl: "/models/modern_arm_chair_01/modern_arm_chair_01_1k.gltf", dimensions: {"width":820,"height":1023,"depth":987} },
  asset_dining_chair: { source: "dining_chair_02", modelUrl: "/models/dining_chair_02/dining_chair_02_1k.gltf", dimensions: {"width":434,"height":973,"depth":576} },
  asset_rocking_chair: { source: "ArmChair_01", modelUrl: "/models/ArmChair_01/ArmChair_01_1k.gltf", dimensions: {"width":848,"height":1065,"depth":766} },
  asset_bar_stool: { source: "bar_chair_round_01", modelUrl: "/models/bar_chair_round_01/bar_chair_round_01_1k.gltf", dimensions: {"width":486,"height":751,"depth":483} },
  asset_kids_chair: { source: "wooden_stool_01", modelUrl: "/models/wooden_stool_01/wooden_stool_01_1k.gltf", dimensions: {"width":425,"height":437,"depth":442} },
  asset_desk_chair: { source: "plastic_monobloc_chair_01", modelUrl: "/models/plastic_monobloc_chair_01/plastic_monobloc_chair_01_1k.gltf", dimensions: {"width":642,"height":880,"depth":628} },
  asset_coffee_table_oak: { source: "modern_coffee_table_01", modelUrl: "/models/modern_coffee_table_01/modern_coffee_table_01_1k.gltf", dimensions: {"width":600,"height":390,"depth":1202} },
  asset_round_table: { source: "coffee_table_round_01", modelUrl: "/models/coffee_table_round_01/coffee_table_round_01_1k.gltf", dimensions: {"width":1301,"height":491,"depth":1301} },
  asset_dining_table: { source: "dining_table", modelUrl: "/models/dining_table/dining_table_1k.gltf", dimensions: {"width":2256,"height":877,"depth":1390} },
  asset_dining_table_4: { source: "round_wooden_table_01", modelUrl: "/models/round_wooden_table_01/round_wooden_table_01_1k.gltf", dimensions: {"width":1399,"height":1005,"depth":1399} },
  asset_side_table: { source: "side_table_01", modelUrl: "/models/side_table_01/side_table_01_1k.gltf", dimensions: {"width":550,"height":551,"depth":450} },
  asset_nesting_table: { source: "side_table_tall_01", modelUrl: "/models/side_table_tall_01/side_table_tall_01_1k.gltf", dimensions: {"width":384,"height":761,"depth":384} },
  asset_desk_1400: { source: "metal_office_desk", modelUrl: "/models/metal_office_desk/metal_office_desk_1k.gltf", dimensions: {"width":2000,"height":788,"depth":947} },
  asset_console_table: { source: "ClassicConsole_01", modelUrl: "/models/ClassicConsole_01/ClassicConsole_01_1k.gltf", dimensions: {"width":1543,"height":949,"depth":589} },
  asset_tv_cabinet: { source: "modern_wooden_cabinet", modelUrl: "/models/modern_wooden_cabinet/modern_wooden_cabinet_1k.gltf", dimensions: {"width":2440,"height":680,"depth":684} },
  asset_bookshelf: { source: "wooden_bookshelf_worn", modelUrl: "/models/wooden_bookshelf_worn/wooden_bookshelf_worn_1k.gltf", dimensions: {"width":1374,"height":2063,"depth":581} },
  asset_chest_5: { source: "drawer_cabinet", modelUrl: "/models/drawer_cabinet/drawer_cabinet_1k.gltf", dimensions: {"width":1141,"height":1881,"depth":488} },
  asset_nightstand: { source: "painted_wooden_nightstand", modelUrl: "/models/painted_wooden_nightstand/painted_wooden_nightstand_1k.gltf", dimensions: {"width":505,"height":660,"depth":630} },
  asset_open_shelf: { source: "painted_wooden_shelves", modelUrl: "/models/painted_wooden_shelves/painted_wooden_shelves_1k.gltf", dimensions: {"width":511,"height":1125,"depth":367} },
  asset_sideboard: { source: "vintage_cabinet_01", modelUrl: "/models/vintage_cabinet_01/vintage_cabinet_01_1k.gltf", dimensions: {"width":2022,"height":2576,"depth":648} },
  asset_shoe_cabinet: { source: "painted_wooden_cabinet", modelUrl: "/models/painted_wooden_cabinet/painted_wooden_cabinet_1k.gltf", dimensions: {"width":1195,"height":1561,"depth":644} },
  asset_bed_queen: { source: "old_bed_frame", modelUrl: "/models/old_bed_frame/old_bed_frame_1k.gltf", dimensions: {"width":905,"height":1201,"depth":2002} },
  asset_bed_single: { source: "vintage_day_bed", modelUrl: "/models/vintage_day_bed/vintage_day_bed_1k.gltf", dimensions: {"width":1973,"height":1127,"depth":855} },
  asset_pendant_lamp: { source: "modern_ceiling_lamp_01", modelUrl: "/models/modern_ceiling_lamp_01/modern_ceiling_lamp_01_1k.gltf", dimensions: {"width":432,"height":952,"depth":432} },
  asset_pendant_long: { source: "hanging_industrial_lamp", modelUrl: "/models/hanging_industrial_lamp/hanging_industrial_lamp_1k.gltf", dimensions: {"width":550,"height":1355,"depth":550} },
  asset_desk_lamp: { source: "desk_lamp_arm_01", modelUrl: "/models/desk_lamp_arm_01/desk_lamp_arm_01_1k.gltf", dimensions: {"width":202,"height":893,"depth":614} },
  asset_ceiling_flush: { source: "Chandelier_02", modelUrl: "/models/Chandelier_02/Chandelier_02_1k.gltf", dimensions: {"width":679,"height":848,"depth":619} },
  asset_wall_sconce: { source: "industrial_wall_sconce", modelUrl: "/models/industrial_wall_sconce/industrial_wall_sconce_1k.gltf", dimensions: {"width":150,"height":342,"depth":252} },
  asset_plant_large: { source: "potted_plant_01", modelUrl: "/models/potted_plant_01/potted_plant_01_1k.gltf", dimensions: {"width":587,"height":1336,"depth":634} },
  asset_plant_monstera: { source: "potted_plant_02", modelUrl: "/models/potted_plant_02/potted_plant_02_1k.gltf", dimensions: {"width":729,"height":633,"depth":757} },
  asset_plant_small: { source: "potted_plant_04", modelUrl: "/models/potted_plant_04/potted_plant_04_1k.gltf", dimensions: {"width":168,"height":267,"depth":185} },
  asset_mirror: { source: "ornate_mirror_01", modelUrl: "/models/ornate_mirror_01/ornate_mirror_01_1k.gltf", dimensions: {"width":486,"height":744,"depth":26} },
  asset_vase_set: { source: "ceramic_vase_01", modelUrl: "/models/ceramic_vase_01/ceramic_vase_01_1k.gltf", dimensions: {"width":204,"height":400,"depth":204} },
  asset_washer: { source: "electric_stove", modelUrl: "/models/electric_stove/electric_stove_1k.gltf", dimensions: {"width":724,"height":881,"depth":610} },
  asset_air_purifier: { source: "vintage_microwave", modelUrl: "/models/vintage_microwave/vintage_microwave_1k.gltf", dimensions: {"width":1074,"height":526,"depth":746} },
  asset_projector_screen: { source: "projector_screen", modelUrl: "/models/projector_screen/projector_screen_1k.gltf", dimensions: {"width":1094,"height":1601,"depth":916} },
};

export interface PolyHavenAsset extends PolyHavenModel {
  id: string;
  name: string;
  type: ObjectType;
  category: string;
  style: string[];
  tags: string[];
  materials: string[];
}

/** 대응하는 항목이 없어 새로 추가하는 에셋 */
export const POLYHAVEN_EXTRA: PolyHavenAsset[] = [
  { id: "asset_ph_ceiling_fan", source: "ceiling_fan", modelUrl: "/models/ceiling_fan/ceiling_fan_1k.gltf", dimensions: {"width":1463,"height":516,"depth":1463}, name: "실링팬", type: "lamp", category: "lamp", style: ["natural","modern"], tags: ["실링팬","fan","천장","선풍기"], materials: ["mat_walnut"] },
];
