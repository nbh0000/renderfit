/**
 * Poly Haven CC0 3D 모델을 카탈로그에 채워 넣는다.
 *
 * 3D 뷰는 지금까지 상자·원기둥 같은 primitive로만 가구를 그렸다. 실사감을 내려면
 * 진짜 메시가 있어야 하는데, 라이선스가 깨끗하면서 API로 받아올 수 있는 곳이
 * Poly Haven이다 — 전부 CC0(저작자 표시 의무 없음)이고 공개 API가 있다.
 *
 * 하는 일
 *  1) 아래 MAPPING의 모델을 1k glTF로 내려받아 public/models/{id}/ 에 둔다
 *     (.gltf가 .bin과 textures/를 상대경로로 참조하므로 폴더 구조를 그대로 유지한다)
 *  2) glTF의 POSITION accessor min/max로 실제 크기(mm)를 계산한다
 *  3) models/polyhaven.generated.ts 를 만든다 — 카탈로그가 이 파일을 읽어 modelUrl을 붙인다
 *
 * 실행: node scripts/assets/polyhaven.mjs
 *       node scripts/assets/polyhaven.mjs --force   (이미 받은 것도 다시 받는다)
 */

import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "public", "models");
const GENERATED = path.join(ROOT, "models", "polyhaven.generated.ts");

const API = "https://api.polyhaven.com";
/** 1k면 가구 한 점당 0.5MB 안쪽이다. 편집기에서 수십 개를 띄우므로 이 이상은 무겁다. */
const RESOLUTION = "1k";

/**
 * Poly Haven 모델 → 우리 카탈로그.
 *
 * asset: 이미 있는 에셋에 메시만 입힌다 (치수·이름·검색어는 국내 규격에 맞춰 둔 것을 쓴다).
 * newAsset: 대응하는 항목이 없어 새로 만드는 에셋.
 */
const MAPPING = [
  // ── 소파 ──
  { source: "Sofa_01", asset: "asset_sofa_beige_3" },
  { source: "sofa_02", asset: "asset_sofa_grey_2" },
  { source: "sofa_03", asset: "asset_sofa_leather" },
  { source: "painted_wooden_sofa", asset: "asset_bench_entry" },
  { source: "Ottoman_01", asset: "asset_sofa_1seat" },

  // ── 의자 ──
  { source: "mid_century_lounge_chair", asset: "asset_lounge_chair" },
  { source: "modern_arm_chair_01", asset: "asset_accent_chair" },
  { source: "dining_chair_02", asset: "asset_dining_chair" },
  { source: "ArmChair_01", asset: "asset_rocking_chair" },
  { source: "bar_chair_round_01", asset: "asset_bar_stool" },
  { source: "wooden_stool_01", asset: "asset_kids_chair" },
  { source: "plastic_monobloc_chair_01", asset: "asset_desk_chair" },

  // ── 테이블·책상 ──
  { source: "modern_coffee_table_01", asset: "asset_coffee_table_oak" },
  { source: "coffee_table_round_01", asset: "asset_round_table" },
  { source: "dining_table", asset: "asset_dining_table" },
  { source: "round_wooden_table_01", asset: "asset_dining_table_4" },
  { source: "side_table_01", asset: "asset_side_table" },
  { source: "side_table_tall_01", asset: "asset_nesting_table" },
  { source: "metal_office_desk", asset: "asset_desk_1400" },
  { source: "ClassicConsole_01", asset: "asset_console_table" },

  // ── 수납 ──
  { source: "modern_wooden_cabinet", asset: "asset_tv_cabinet" },
  { source: "wooden_bookshelf_worn", asset: "asset_bookshelf" },
  { source: "drawer_cabinet", asset: "asset_chest_5" },
  { source: "painted_wooden_nightstand", asset: "asset_nightstand" },
  { source: "painted_wooden_shelves", asset: "asset_open_shelf" },
  { source: "vintage_cabinet_01", asset: "asset_sideboard" },
  { source: "painted_wooden_cabinet", asset: "asset_shoe_cabinet" },

  // ── 침대 ──
  { source: "old_bed_frame", asset: "asset_bed_queen" },
  { source: "vintage_day_bed", asset: "asset_bed_single" },

  // ── 조명 ──
  { source: "modern_ceiling_lamp_01", asset: "asset_pendant_lamp" },
  { source: "hanging_industrial_lamp", asset: "asset_pendant_long" },
  { source: "desk_lamp_arm_01", asset: "asset_desk_lamp" },
  { source: "Chandelier_02", asset: "asset_ceiling_flush" },
  { source: "industrial_wall_sconce", asset: "asset_wall_sconce" },

  // ── 식물·장식 ──
  { source: "potted_plant_01", asset: "asset_plant_large" },
  { source: "potted_plant_02", asset: "asset_plant_monstera" },
  { source: "potted_plant_04", asset: "asset_plant_small" },
  { source: "ornate_mirror_01", asset: "asset_mirror" },
  { source: "ceramic_vase_01", asset: "asset_vase_set" },

  // ── 가전 ──
  { source: "electric_stove", asset: "asset_washer" },
  { source: "vintage_microwave", asset: "asset_air_purifier" },
  { source: "ceiling_fan", newAsset: { name: "실링팬", type: "lamp", category: "lamp", style: ["natural", "modern"], tags: ["실링팬", "fan", "천장", "선풍기"], materials: ["mat_walnut"] } },
  { source: "projector_screen", asset: "asset_projector_screen" },
];

const force = process.argv.includes("--force");

async function getJSON(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function download(url, target) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  await fs.writeFile(target, Buffer.from(await response.arrayBuffer()));
  return (await fs.stat(target)).size;
}

/**
 * glTF에서 실제 크기(mm)를 읽는다.
 *
 * POSITION accessor의 min/max가 모델 좌표(미터)라서, 모든 메시를 합친 경계 상자가
 * 곧 그 가구의 실제 치수다. 사람이 어림한 값보다 이쪽이 정확하다.
 */
function dimensionsOf(gltf) {
  const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };

  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const accessor = gltf.accessors?.[primitive.attributes?.POSITION];
      if (!accessor?.min || !accessor?.max) continue;
      for (let axis = 0; axis < 3; axis++) {
        box.min[axis] = Math.min(box.min[axis], accessor.min[axis]);
        box.max[axis] = Math.max(box.max[axis], accessor.max[axis]);
      }
    }
  }

  if (!Number.isFinite(box.min[0])) return null;

  const mm = (value) => Math.max(10, Math.round(value * 1000));
  // glTF는 Y가 위, Z가 앞이다. 우리 Dimensions는 width=X, height=Y, depth=Z.
  return {
    width: mm(box.max[0] - box.min[0]),
    height: mm(box.max[1] - box.min[1]),
    depth: mm(box.max[2] - box.min[2]),
  };
}

async function fetchModel(entry) {
  const dir = path.join(OUT_DIR, entry.source);
  const gltfPath = path.join(dir, `${entry.source}_${RESOLUTION}.gltf`);

  let bytes = 0;
  const cached = !force && (await fs.access(gltfPath).then(() => true, () => false));

  if (!cached) {
    const files = await getJSON(`${API}/files/${entry.source}`);
    const bundle = files?.gltf?.[RESOLUTION]?.gltf;
    if (!bundle?.url) throw new Error("1k glTF가 없습니다");

    bytes += await download(bundle.url, gltfPath);
    for (const [relative, include] of Object.entries(bundle.include ?? {})) {
      bytes += await download(include.url, path.join(dir, relative));
    }
  }

  const gltf = JSON.parse(await fs.readFile(gltfPath, "utf8"));
  return {
    ...entry,
    modelUrl: `/models/${entry.source}/${entry.source}_${RESOLUTION}.gltf`,
    dimensions: dimensionsOf(gltf),
    bytes,
    cached,
  };
}

function serialize(results) {
  const lines = [
    "/* 이 파일은 scripts/assets/polyhaven.mjs가 만든다. 직접 고치지 말 것. */",
    "",
    "import type { ObjectType } from \"@/scene/types\";",
    "",
    "export interface PolyHavenModel {",
    "  /** Poly Haven 에셋 id (CC0) */",
    "  source: string;",
    "  modelUrl: string;",
    "  /** glTF 경계 상자에서 읽은 실제 크기 (mm) */",
    "  dimensions: { width: number; height: number; depth: number };",
    "}",
    "",
    "/** 기존 카탈로그 항목에 입힐 메시 */",
    "export const POLYHAVEN_MODELS: Record<string, PolyHavenModel> = {",
  ];

  for (const item of results.filter((entry) => entry.asset)) {
    lines.push(
      `  ${item.asset}: { source: ${JSON.stringify(item.source)}, modelUrl: ${JSON.stringify(item.modelUrl)}, dimensions: ${JSON.stringify(item.dimensions)} },`
    );
  }

  lines.push("};", "");
  lines.push("export interface PolyHavenAsset extends PolyHavenModel {");
  lines.push("  id: string;");
  lines.push("  name: string;");
  lines.push("  type: ObjectType;");
  lines.push("  category: string;");
  lines.push("  style: string[];");
  lines.push("  tags: string[];");
  lines.push("  materials: string[];");
  lines.push("}");
  lines.push("");
  lines.push("/** 대응하는 항목이 없어 새로 추가하는 에셋 */");
  lines.push("export const POLYHAVEN_EXTRA: PolyHavenAsset[] = [");

  for (const item of results.filter((entry) => entry.newAsset)) {
    const meta = item.newAsset;
    lines.push(
      `  { id: ${JSON.stringify(`asset_ph_${item.source}`)}, source: ${JSON.stringify(item.source)}, modelUrl: ${JSON.stringify(item.modelUrl)}, dimensions: ${JSON.stringify(item.dimensions)}, name: ${JSON.stringify(meta.name)}, type: ${JSON.stringify(meta.type)}, category: ${JSON.stringify(meta.category)}, style: ${JSON.stringify(meta.style)}, tags: ${JSON.stringify(meta.tags)}, materials: ${JSON.stringify(meta.materials)} },`
    );
  }

  lines.push("];", "");
  return lines.join("\n");
}

const results = [];
let failed = 0;

for (const entry of MAPPING) {
  try {
    const result = await fetchModel(entry);
    if (!result.dimensions) throw new Error("경계 상자를 읽지 못했습니다");
    results.push(result);
    const size = result.cached ? "캐시" : `${(result.bytes / 1024).toFixed(0)}KB`;
    const { width, height, depth } = result.dimensions;
    console.log(`  ✓ ${entry.source.padEnd(28)} ${size.padStart(7)}  ${width}×${height}×${depth}mm`);
  } catch (error) {
    failed += 1;
    console.warn(`  ✗ ${entry.source.padEnd(28)} ${error.message}`);
  }
}

/*
 * 하나도 못 받았으면 기존 카탈로그를 덮지 않는다.
 * 빌드 때(prebuild) 이 스크립트가 도는데, Poly Haven이 잠깐 죽었다고 해서
 * 커밋돼 있던 카탈로그를 빈 파일로 갈아 끼우면 배포판에서 에셋이 통째로 사라진다.
 */
if (results.length === 0 && existsSync(GENERATED)) {
  console.warn("  ! 하나도 받지 못해 기존 카탈로그를 그대로 둡니다.");
} else {
  await fs.writeFile(GENERATED, serialize(results), "utf8");
}
console.log(`\n${results.length}개 반영, ${failed}개 실패 → models/polyhaven.generated.ts`);
