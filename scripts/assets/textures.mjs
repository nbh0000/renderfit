/**
 * Poly Haven CC0 PBR 텍스처를 재질 카탈로그에 채워 넣는다.
 *
 * 지금까지 재질은 색 하나(baseColor)와 절차적 노이즈뿐이라, 마루든 타일이든
 * 3D에서는 색만 다른 같은 면으로 보였다. 벽지·장판을 고르는 화면이 되려면
 * 진짜 결이 있어야 한다. Poly Haven 텍스처는 전부 CC0다.
 *
 * 하는 일
 *  1) 아래 MATERIALS의 텍스처를 1k jpg(diffuse·normal·ARM)로 public/textures/{id}/ 에 받는다
 *  2) models/materials.generated.ts 를 만든다 — 카탈로그가 이 파일을 합쳐 쓴다
 *
 * 실행: node scripts/assets/textures.mjs [--force]
 */

import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "public", "textures");
const GENERATED = path.join(ROOT, "models", "materials.generated.ts");

const API = "https://api.polyhaven.com";
const RESOLUTION = "1k";

/**
 * 받아올 마감재.
 *
 * scale은 텍스처 한 장이 덮는 실제 크기(m)다 — 마루널은 2m, 벽 도장은 4m쯤이
 * 자연스럽다. 이 값이 없으면 3D에서 무늬가 우스울 만큼 크거나 잘게 반복된다.
 * surface는 이 마감을 어디에 바를 수 있는지다 (재질 고르기 화면의 탭).
 */
const MATERIALS = [
  // ── 바닥: 마루 ──
  { source: "laminate_floor_02", name: "라미네이트 마루", surface: ["floor"], scale: 2, tags: ["바닥", "마루", "강마루", "laminate", "wood"] },
  { source: "plank_flooring", name: "원목 마루", surface: ["floor"], scale: 2.2, tags: ["바닥", "마루", "원목", "plank", "wood"] },
  { source: "plank_flooring_02", name: "화이트 오크 마루", surface: ["floor"], scale: 2.2, tags: ["바닥", "마루", "오크", "화이트", "wood"] },
  { source: "dark_wooden_planks", name: "다크 월넛 마루", surface: ["floor"], scale: 2.2, tags: ["바닥", "마루", "월넛", "다크", "wood"] },
  { source: "rectangular_parquet", name: "헤링본 파케트", surface: ["floor"], scale: 1.6, tags: ["바닥", "파케트", "헤링본", "parquet", "wood"] },
  { source: "diagonal_parquet", name: "대각 파케트", surface: ["floor"], scale: 1.6, tags: ["바닥", "파케트", "대각", "parquet"] },

  // ── 바닥: 타일·석재 ──
  { source: "marble_01", name: "화이트 마블", surface: ["floor", "wall"], scale: 2.4, tags: ["바닥", "벽", "대리석", "마블", "marble", "luxury"] },
  { source: "floor_tiles_06", name: "포세린 타일", surface: ["floor"], scale: 1.2, tags: ["바닥", "타일", "포세린", "tile"] },
  { source: "floor_tiles_02", name: "무광 그레이 타일", surface: ["floor"], scale: 1.2, tags: ["바닥", "타일", "그레이", "tile"] },
  { source: "terracotta_floor_tiles", name: "테라코타 타일", surface: ["floor"], scale: 1.4, tags: ["바닥", "타일", "테라코타", "terracotta"] },
  { source: "smooth_concrete_floor", name: "폴리싱 콘크리트", surface: ["floor"], scale: 3, tags: ["바닥", "콘크리트", "폴리싱", "concrete", "industrial"] },

  // ── 벽: 도장·미장 ──
  { source: "white_plaster_02", name: "화이트 미장", surface: ["wall", "ceiling"], scale: 4, tags: ["벽", "천장", "도장", "미장", "화이트", "plaster"] },
  { source: "beige_wall_001", name: "베이지 도장", surface: ["wall"], scale: 4, tags: ["벽", "도장", "베이지", "warm"] },
  { source: "beige_wall_002", name: "웜 아이보리 도장", surface: ["wall"], scale: 4, tags: ["벽", "도장", "아이보리", "warm"] },
  { source: "grey_plaster", name: "그레이 미장", surface: ["wall"], scale: 4, tags: ["벽", "도장", "그레이", "미장"] },
  { source: "plastered_wall_04", name: "거친 미장", surface: ["wall"], scale: 3.2, tags: ["벽", "미장", "텍스처", "plaster"] },
  { source: "white_stucco", name: "스투코", surface: ["wall"], scale: 3.2, tags: ["벽", "스투코", "stucco", "natural"] },
  { source: "ceiling_interior", name: "천장 텍스", surface: ["ceiling"], scale: 2.4, tags: ["천장", "텍스", "ceiling", "office"] },

  // ── 벽: 벽돌·나무 ──
  { source: "painted_brick", name: "화이트 벽돌", surface: ["wall"], scale: 2.6, tags: ["벽", "벽돌", "화이트", "brick"] },
  { source: "brick_wall_13", name: "적벽돌", surface: ["wall"], scale: 2.6, tags: ["벽", "벽돌", "적벽돌", "brick", "industrial"] },
  { source: "brown_planks_03", name: "우드 월패널", surface: ["wall"], scale: 2.4, tags: ["벽", "월패널", "우드", "wood"] },
  { source: "dark_wood", name: "다크 우드 패널", surface: ["wall"], scale: 2.4, tags: ["벽", "월패널", "다크", "wood"] },

  // ── 패브릭 ──
  { source: "hessian_230", name: "린넨 패브릭", surface: ["furniture"], scale: 1, tags: ["패브릭", "린넨", "소파", "fabric"] },
  { source: "cotton_jersey", name: "코튼 패브릭", surface: ["furniture"], scale: 1, tags: ["패브릭", "코튼", "소파", "fabric"] },
  { source: "brown_leather", name: "브라운 가죽", surface: ["furniture"], scale: 1, tags: ["가죽", "leather", "소파", "브라운"] },
  { source: "dirty_carpet", name: "카펫", surface: ["floor", "furniture"], scale: 1.6, tags: ["카펫", "러그", "carpet", "fabric"] },
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

/** Poly Haven의 맵 이름 → 우리가 쓰는 이름 */
const MAPS = [
  { key: "Diffuse", suffix: "diff" },
  { key: "nor_gl", suffix: "nor" },
  { key: "arm", suffix: "arm" },
];

async function fetchTexture(entry) {
  const dir = path.join(OUT_DIR, entry.source);
  const diffuse = path.join(dir, `diff.jpg`);
  const cached = !force && (await fs.access(diffuse).then(() => true, () => false));

  let bytes = 0;
  const urls = {};

  if (!cached) {
    const files = await getJSON(`${API}/files/${entry.source}`);
    for (const map of MAPS) {
      const file = files?.[map.key]?.[RESOLUTION]?.jpg;
      if (!file?.url) continue;
      bytes += await download(file.url, path.join(dir, `${map.suffix}.jpg`));
      urls[map.suffix] = true;
    }
    if (!urls.diff) throw new Error("diffuse 맵이 없습니다");
  } else {
    for (const map of MAPS) {
      urls[map.suffix] = await fs
        .access(path.join(dir, `${map.suffix}.jpg`))
        .then(() => true, () => false);
    }
  }

  return { ...entry, bytes, cached, has: urls };
}

/** 재질 id는 mat_ph_{source} — 손으로 적어 둔 기본 재질과 부딪히지 않는다 */
function serialize(results) {
  const lines = [
    "/* 이 파일은 scripts/assets/textures.mjs가 만든다. 직접 고치지 말 것. */",
    "",
    'import type { Material } from "@/scene/types";',
    "",
    "/**",
    " * Poly Haven CC0 PBR 마감재.",
    " * surface는 이 마감을 바를 수 있는 면 — 재질 고르기 화면이 이 값으로 묶어 보여 준다.",
    " */",
    "export interface TexturedMaterial extends Material {",
    '  surface: ("floor" | "wall" | "ceiling" | "furniture")[];',
    "  /** 거칠기·금속감·AO가 한 장에 들어 있는 맵 (R=AO, G=roughness, B=metallic) */",
    "  armMapUrl: string | null;",
    "}",
    "",
    "export const TEXTURED_MATERIALS: TexturedMaterial[] = [",
  ];

  for (const item of results) {
    const base = `/textures/${item.source}`;
    lines.push(
      "  {",
      `    id: ${JSON.stringify(`mat_ph_${item.source}`)},`,
      `    name: ${JSON.stringify(item.name)},`,
      `    baseColor: "#ffffff",`,
      `    roughness: 1,`,
      `    metallic: 0,`,
      `    scale: ${item.scale},`,
      `    textureUrl: ${JSON.stringify(`${base}/diff.jpg`)},`,
      `    normalMapUrl: ${item.has.nor ? JSON.stringify(`${base}/nor.jpg`) : "null"},`,
      `    armMapUrl: ${item.has.arm ? JSON.stringify(`${base}/arm.jpg`) : "null"},`,
      `    heightMapUrl: null,`,
      `    surface: ${JSON.stringify(item.surface)},`,
      `    tags: ${JSON.stringify([...item.surface, ...item.tags])},`,
      "  },"
    );
  }

  lines.push("];", "");
  return lines.join("\n");
}

const results = [];
let failed = 0;

for (const entry of MATERIALS) {
  try {
    const result = await fetchTexture(entry);
    results.push(result);
    const size = result.cached ? "캐시" : `${(result.bytes / 1024).toFixed(0)}KB`;
    console.log(`  ✓ ${entry.source.padEnd(26)} ${size.padStart(8)}  ${entry.name}`);
  } catch (error) {
    failed += 1;
    console.warn(`  ✗ ${entry.source.padEnd(26)} ${error.message}`);
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
console.log(`\n${results.length}개 반영, ${failed}개 실패 → models/materials.generated.ts`);
