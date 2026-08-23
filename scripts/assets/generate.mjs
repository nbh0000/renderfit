/**
 * 메시가 없는 카탈로그 가구를 AI 이미지로 채운다.
 *
 * Poly Haven에는 한국 주거의 핵심 품목이 거의 없다 — 붙박이장, 주방 상하부장,
 * 4도어 냉장고, 스탠드 에어컨, 커튼·블라인드 같은 것들이다. 이런 것들은
 * 설명으로 제품 사진을 만들어 3D에 세우는 편이 빠르고 결과도 낫다.
 *
 * 하는 일
 *  1) models/assets.ts에서 메시(POLYHAVEN_MODELS)가 없는 항목을 골라낸다
 *  2) 각 항목의 이름·태그로 흰 배경 제품 사진을 만들어 public/assets/{id}.png 에 둔다
 *  3) models/generated.generated.ts 를 만든다 — 카탈로그가 이 파일을 읽어 imageUrl을 붙인다
 *
 * 이미 받은 것은 건너뛴다. 다시 만들려면 그 파일을 지우고 실행한다.
 * 실행: node scripts/assets/generate.mjs [--limit N] [--only assetId,assetId]
 */

import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_DIR = path.join(ROOT, "public", "assets");
const GENERATED = path.join(ROOT, "models", "generated.generated.ts");

/** .env.local에서 키를 읽는다 (Next 없이 단독 실행하므로) */
async function apiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  try {
    const text = await fs.readFile(path.join(ROOT, ".env.local"), "utf8");
    const line = text.split(/\r?\n/).find((row) => row.startsWith("GEMINI_API_KEY="));
    return line?.slice("GEMINI_API_KEY=".length).trim() ?? "";
  } catch {
    return "";
  }
}

/**
 * 카탈로그에서 항목을 읽는다.
 *
 * 카탈로그는 한 줄에 하나씩 asset(...) 호출로 적혀 있어 그 형태만 훑는다.
 * (TS를 그대로 불러오려면 빌드가 필요한데, 에셋 받는 스크립트가 빌드에 기대면 안 된다)
 */
async function readCatalog() {
  const source = await fs.readFile(path.join(ROOT, "models", "assets.ts"), "utf8");
  const rows = [...source.matchAll(/^\s*asset\(\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)",\s*\[([^\]]*)\],\s*\[([^\]]*)\],\s*\[([^\]]*)\]/gm)];

  return rows.map((row) => ({
    id: row[1],
    name: row[2],
    type: row[3],
    style: row[5].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean),
    tags: row[7].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean),
  }));
}

/** 이미 진짜 메시가 붙은 항목은 건너뛴다 */
async function withMesh() {
  try {
    const source = await fs.readFile(path.join(ROOT, "models", "polyhaven.generated.ts"), "utf8");
    return new Set([...source.matchAll(/^\s{2}(asset_[a-z0-9_]+):/gm)].map((m) => m[1]));
  } catch {
    return new Set();
  }
}

const PRODUCT_PROMPT = [
  "Create a product photograph of a single piece of furniture, described below.",
  "",
  "Strict requirements:",
  "- Pure white background (#FFFFFF), completely uniform, no gradient, no floor, no wall, no room.",
  "- No shadow of any kind, no reflection, no pedestal.",
  "- The entire object must be visible and centred, viewed straight from the front, slightly above eye level.",
  "- Nothing must be cropped — leave a small margin on every side.",
  "- One object only. No props, no people, no text, no watermark, no dimension labels.",
  "- Even, neutral studio lighting so the real colour of the material is visible.",
  "- Korean residential interior product, realistic proportions.",
].join("\n");

async function generate(key, item) {
  const description = [item.name, item.style.join(" "), item.tags.slice(0, 4).join(" ")]
    .filter(Boolean)
    .join(", ");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${PRODUCT_PROMPT}\n\nFurniture: ${description}` }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: "1:1", imageSize: "1K" },
        },
      }),
    }
  );

  const body = await response.json();
  const inline = body.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .find((part) => part.inlineData?.data)?.inlineData;

  if (!inline?.data) {
    throw new Error(body.error?.message?.slice(0, 100) ?? "이미지를 돌려주지 않았습니다");
  }
  return Buffer.from(inline.data, "base64");
}

function serialize(entries) {
  return [
    "/* 이 파일은 scripts/assets/generate.mjs가 만든다. 직접 고치지 말 것. */",
    "",
    "/**",
    " * AI로 만든 가구 사진.",
    " *",
    " * 진짜 메시가 없는 항목에 붙는다. 3D는 흰 배경을 지운 실루엣을 판으로 세운다 —",
    " * 옆에서 보면 얇지만 평면도의 발자국과 치수는 정확하고, 마지막 실사 렌더가",
    " * 이 판을 사진으로 바꿔 준다.",
    " */",
    "export const GENERATED_ASSET_IMAGES: Record<string, string> = {",
    ...entries.map(([id, url]) => `  ${id}: ${JSON.stringify(url)},`),
    "};",
    "",
  ].join("\n");
}

const key = await apiKey();
if (!key) {
  console.warn("GEMINI_API_KEY가 없어 건너뜁니다. 기존 카탈로그를 그대로 둡니다.");
  process.exit(0);
}

const onlyArg = process.argv.indexOf("--only");
const only = onlyArg > -1 ? new Set(process.argv[onlyArg + 1].split(",")) : null;
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const meshed = await withMesh();
const catalog = await readCatalog();
const targets = catalog
  .filter((item) => !meshed.has(item.id))
  .filter((item) => (only ? only.has(item.id) : true));

console.log(`카탈로그 ${catalog.length}개 · 메시 있음 ${meshed.size}개 · 채울 것 ${targets.length}개`);
await fs.mkdir(OUT_DIR, { recursive: true });

const entries = [];
let made = 0;
let failed = 0;

for (const item of targets) {
  const file = path.join(OUT_DIR, `${item.id}.png`);

  if (existsSync(file)) {
    entries.push([item.id, `/assets/${item.id}.png`]);
    continue;
  }
  if (made >= limit) continue;

  try {
    const bytes = await generate(key, item);
    await fs.writeFile(file, bytes);
    entries.push([item.id, `/assets/${item.id}.png`]);
    made += 1;
    console.log(`  ✓ ${item.id.padEnd(26)} ${(bytes.length / 1024).toFixed(0)}KB  ${item.name}`);
  } catch (error) {
    failed += 1;
    console.warn(`  ✗ ${item.id.padEnd(26)} ${error.message}`);
  }
}

/*
 * 하나도 못 만들었으면 기존 목록을 덮지 않는다.
 * 커밋돼 있던 카탈로그를 빈 파일로 갈아 끼우면 배포판에서 에셋이 사라진다.
 */
if (entries.length === 0 && existsSync(GENERATED)) {
  console.warn("  ! 만든 것이 없어 기존 목록을 그대로 둡니다.");
} else {
  await fs.writeFile(GENERATED, serialize(entries), "utf8");
}

console.log(`\n새로 ${made}개, 실패 ${failed}개, 목록 ${entries.length}개 → models/generated.generated.ts`);
