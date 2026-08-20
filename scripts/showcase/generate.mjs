/**
 * 메인 페이지에 쓰는 쇼케이스 이미지를 만든다.
 *
 * 1) 빈 방 사진 한 장을 만들어 기준으로 삼고(public/showcase/base-room.jpg)
 * 2) 그 사진을 그대로 입력으로 넣어 스타일별 시안을 생성한다.
 *
 * 같은 방·같은 앵글에서 가구와 마감만 바뀌므로 히어로의 전/후 비교와
 * 스타일 카드가 한 벌로 읽힌다.
 *
 * 사용: node scripts/showcase/generate.mjs [styleId ...]
 */
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { GoogleGenAI } from "@google/genai";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT_DIR = path.join(ROOT, "public/showcase");
const BASE_FILE = path.join(OUT_DIR, "base-room.jpg");
const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

/** .env.local 을 직접 읽는다 — 스크립트는 Next 런타임 밖에서 돈다 */
function loadEnv() {
  const file = path.join(ROOT, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}
loadEnv();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/** 앵글·구조를 고정하는 공통 지시 — 스타일별 시안이 같은 방으로 읽혀야 한다 */
const KEEP_ROOM = [
  "이것은 실제로 촬영된 빈 방 사진이다.",
  "벽·바닥·천장의 위치, 창문과 문의 위치와 크기, 카메라 앵글과 화각, 시점 높이를 픽셀 단위로 그대로 유지한다.",
  "방을 다시 그리거나 다른 방으로 바꾸지 않는다. 기존 방에 가구와 마감만 더한다.",
  "실제 인테리어 촬영 사진처럼 사실적인 재질감과 자연광, 얕은 그림자를 유지한다.",
  "텍스트·워터마크·사람·반려동물은 넣지 않는다.",
].join(" ");

async function callImage(parts) {
  const configs = [
    { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:3", imageSize: "2K" } },
    { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:3" } },
    { responseModalities: ["IMAGE"] },
  ];

  let lastError;
  for (const config of configs) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts }],
        config,
      });
      const candidate = response.candidates?.[0]?.content?.parts ?? [];
      const inline = candidate.find((part) => part?.inlineData?.data)?.inlineData;
      if (inline?.data) return Buffer.from(inline.data, "base64");
      lastError = new Error("응답에 이미지가 없습니다: " + JSON.stringify(response?.candidates?.[0]?.finishReason ?? ""));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

/** 원본 화질을 유지하되 웹에서 가벼운 크기로 저장한다 */
async function save(buffer, file, width, quality) {
  mkdirSync(path.dirname(file), { recursive: true });
  const output = await sharp(buffer)
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  await writeFile(file, output);
  const meta = await sharp(output).metadata();
  console.log(`  → ${path.relative(ROOT, file)} (${meta.width}×${meta.height}, ${(output.length / 1024).toFixed(0)}KB)`);
  return output;
}

const BASE_PROMPT = [
  "한국 아파트의 비어 있는 거실을 실제로 촬영한 사진.",
  "가구가 하나도 없는 완전한 공실 상태 — 바닥과 벽만 보인다.",
  "정면 약간 왼쪽에서 바라본 구도, 왼쪽 벽면에 큰 통창과 얇은 흰색 새시, 오른쪽 벽에 방문 하나.",
  "화이트 도장 벽, 밝은 오크 강마루, 천장에 매입 조명.",
  "낮 시간 창으로 들어오는 자연광, 부드러운 그림자, 24mm 광각, 눈높이 1.5m, 수직선이 살아 있는 실내 부동산 촬영 사진.",
  "사실적인 사진 화질, 텍스트나 워터마크 없음, 사람 없음.",
].join(" ");

async function generateBase() {
  console.log("빈 방 기준 사진 생성 중…");
  const buffer = await callImage([{ text: BASE_PROMPT }]);
  return save(buffer, BASE_FILE, 1600, 86);
}

/* ── 히어로 전/후 비교에 쓰는 침실 한 쌍 ── */

const HERO_BEFORE_FILE = path.join(OUT_DIR, "hero-before.jpg");
const HERO_AFTER_FILE = path.join(OUT_DIR, "hero-after.jpg");

const HERO_BEFORE_PROMPT = [
  "한국 아파트의 비어 있는 침실을 실제로 촬영한 사진.",
  "가구가 하나도 없는 공실 상태 — 바닥과 벽만 보인다.",
  "정면에서 약간 오른쪽으로 치우쳐 바라본 구도, 왼쪽 벽에 창문 하나, 오른쪽 벽에 화이트 붙박이장 문.",
  "화이트 도장 벽, 밝은 오크 강마루, 천장에 매입 조명, 벽에 콘센트와 스위치.",
  "낮 시간 창으로 들어오는 자연광, 부드러운 그림자, 24mm 광각, 눈높이 1.5m, 수직선이 살아 있는 실내 부동산 촬영 사진.",
  "사실적인 사진 화질, 텍스트나 워터마크 없음, 사람 없음.",
].join(" ");

const HERO_AFTER_PROMPT = [
  KEEP_ROOM,
  "이 빈 침실을 실제로 사용 중인 침실로 꾸민 완성 사진을 만든다.",
  "퀸 사이즈 침대 하나를 안쪽 벽에 붙여 놓고, 리넨 침구와 쿠션, 협탁 1개와 테이블 조명, 러그 1장, 커튼을 더한다.",
  "밝은 오크 원목과 아이보리·웜그레이 톤으로 정돈된 호텔 객실 같은 분위기, 은은한 간접 조명.",
  "주요 가구는 4점 이내로 두고, 침대 옆에 최소 700mm 보행 공간을 남긴다.",
  "가구는 실제 제품처럼 비율이 정확하고 바닥에 닿는 그림자가 자연스러워야 한다.",
].join(" ");

async function generateHero() {
  console.log("히어로 침실 — 빈 방 생성 중…");
  const before = await callImage([{ text: HERO_BEFORE_PROMPT }]);
  const saved = await save(before, HERO_BEFORE_FILE, 1400, 86);

  console.log("히어로 침실 — 시안 생성 중…");
  const after = await callImage([
    { text: HERO_AFTER_PROMPT },
    { inlineData: { mimeType: "image/jpeg", data: saved.toString("base64") } },
  ]);
  await save(after, HERO_AFTER_FILE, 1400, 86);
}

async function generateStyle(style, base) {
  const parts = [
    {
      text: [
        KEEP_ROOM,
        `이 빈 방을 ${style.label} 스타일의 거실로 꾸민 완성 사진을 만든다.`,
        style.promptFragment,
        "가구는 실제 제품처럼 비율과 두께가 정확해야 하고, 바닥에 닿는 그림자가 자연스러워야 한다.",
      ].join(" "),
    },
    { inlineData: { mimeType: "image/jpeg", data: base.toString("base64") } },
  ];
  const buffer = await callImage(parts);
  return save(buffer, path.join(OUT_DIR, `style-${style.id}.jpg`), 900, 82);
}

/** config/styles.ts 에서 id/label/promptFragment 만 뽑아 온다 (ts 로더 없이) */
function loadStyles() {
  const source = readFileSync(path.join(ROOT, "config/styles.ts"), "utf8");
  const body = source.slice(source.indexOf("export const STYLES"));
  const styles = [];
  const re = /id:\s*"([^"]+)",\s*\n\s*label:\s*"([^"]+)",\s*\n\s*promptFragment:\s*\n?\s*"([^"]+)"/g;
  let match;
  while ((match = re.exec(body))) {
    styles.push({ id: match[1], label: match[2], promptFragment: match[3] });
  }
  return styles;
}

async function main() {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY가 없습니다.");

  const only = process.argv.slice(2);

  // 히어로는 스타일 카드와 다른 방(침실)을 쓴다. 따로 만든다.
  if (only.includes("hero")) {
    await generateHero();
    if (only.length === 1) {
      console.log("완료");
      return;
    }
  }
  const all = loadStyles().filter((style) => style.id !== "custom");
  const targets = only.length ? all.filter((s) => only.includes(s.id)) : all;
  if (only.length && targets.length === 0) return;

  const base = existsSync(BASE_FILE) && (only.length || process.env.REUSE_BASE)
    ? readFileSync(BASE_FILE)
    : await generateBase();

  // 쿼터를 감안해 3장씩 나눠 보낸다.
  for (let i = 0; i < targets.length; i += 3) {
    const batch = targets.slice(i, i + 3);
    console.log(`스타일 생성: ${batch.map((s) => s.label).join(", ")}`);
    await Promise.all(
      batch.map((style) =>
        generateStyle(style, base).catch((error) => {
          console.error(`  ✗ ${style.id}: ${error.message}`);
        })
      )
    );
  }
  console.log("완료");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
