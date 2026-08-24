/**
 * 갤러리에 보여 줄 시안을 만들어 올린다.
 *
 * 갤러리는 시안이 쌓여야 사는 곳인데, 처음 열었을 때는 아무것도 없다. 빈 갤러리를
 * 본 사람은 "아직 아무도 안 쓰는 서비스"로 받아들이고 나가 버린다. 그래서 문을 열기
 * 전에 우리가 직접 채워 둔다.
 *
 * 사용자가 스튜디오에서 만드는 것과 같은 모양으로 만든다.
 *   1) 빈 방 사진을 만들고 (전/후 비교의 "전")
 *   2) 그 사진을 입력으로 시안을 그린다 (4K)
 *   3) 두 장을 Storage 에 올리고 generation_jobs · generation_results 를 남긴다
 *   4) 익명으로 공개한다 — 우리 계정 이름이 갤러리에 열 번 찍히면 곤란하다
 *
 * 실행:
 *   node scripts/gallery/seed.mjs            (전부)
 *   node scripts/gallery/seed.mjs 1 3 7      (그 번호만)
 *   node scripts/gallery/seed.mjs --dry      (돈 안 쓰고 계획만 본다)
 *
 * ⚠ 실제 호출이므로 돈이 든다. 4K 한 장 $0.151, 빈 방 사진 $0.039 —
 *   열 벌이면 대략 $1.9 다. 계획을 먼저 --dry 로 확인하고 돌린다.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "../..");

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

/* ────────────────────────────── 무엇을 만들 것인가 ────────────────────────────── */

/**
 * 열 벌의 시안.
 *
 * 방과 스타일을 겹치지 않게 짰다. 같은 거실이 열 번 나오면 갤러리가 아니라 슬라이드쇼다.
 * `room`·`style` 은 config/rooms.ts · config/styles.ts 의 id 와 반드시 같아야 한다 —
 * 다르면 갤러리에서 실명이 "공간"으로 떨어지고 slug 도 엉킨다.
 */
const PLAN = [
  {
    room: "living-room",
    style: "luxury",
    before: "서울 신축 아파트의 넓은 거실. 가구가 하나도 없는 빈 방. 전면 창으로 도시가 보이고 오후 햇빛이 든다. 밝은 회색 벽, 밝은 톤 마루.",
    after: "대리석 아트월과 황동 몰딩, 벨벳 3인 소파와 라운지 체어, 조각적인 디자이너 샹들리에, 깊은 네이비 포인트 벽. 저녁 무렵 간접조명이 켜진 호화로운 거실.",
  },
  {
    room: "bedroom",
    style: "hotel",
    before: "서울 아파트의 안방. 가구 없는 빈 방. 창 하나, 흰 벽, 밝은 마루.",
    after: "5성급 호텔 스위트 같은 침실. 킹사이즈 침대와 두툼한 헤드보드, 좌우 대칭 협탁과 갓 조명, 벨벳 벤치, 암막 커튼과 시어 커튼 이중, 따뜻한 간접조명.",
  },
  {
    room: "kitchen",
    style: "modern",
    before: "아파트 주방. 싱크대만 있고 비어 있다. 흰 벽, 밝은 타일 바닥.",
    after: "매트 블랙 하이글로시 상부장과 대형 아일랜드, 통 대리석 상판과 히든 손잡이, 라인 펜던트 세 개, 빌트인 가전. 잡동사니 없이 정갈한 모던 주방.",
  },
  {
    room: "home-office",
    style: "midcentury",
    before: "아파트의 작은 방. 비어 있다. 창 하나, 흰 벽, 원목 마루.",
    after: "미드센추리 서재. 월넛 원목 책상과 가죽 라운지 체어, 벽면 가득한 우드 책장, 놋쇠 테이블 램프와 아치형 플로어 램프, 빈티지 러그.",
  },
  {
    room: "kids-room",
    style: "kids",
    before: "아파트의 작은 방. 비어 있다. 창으로 낮 햇빛이 든다. 흰 벽, 밝은 마루.",
    after: "아이 방. 하우스 프레임 침대와 낮은 원목 수납장, 파스텔 톤 놀이 매트, 벽에 붙은 그림책 선반, 천장에 걸린 구름 모빌. 밝고 안전한 분위기.",
  },
  {
    room: "bathroom",
    style: "minimal",
    before: "아파트 욕실. 변기와 세면대만 있고 비어 있다. 흰 타일.",
    after: "호텔 같은 미니멀 욕실. 대형 포세린 타일, 벽걸이 세면대와 프레임리스 거울, 워크인 유리 샤워부스, 매트 블랙 수전, 우드 스툴과 흰 타월.",
  },
  {
    room: "living-room",
    style: "industrial",
    before: "복층 구조의 넓은 거실. 비어 있다. 높은 층고와 큰 창.",
    after: "인더스트리얼 거실. 노출 콘크리트 벽과 블랙 아이언 창틀, 빈티지 가죽 소파, 철제 선반과 에디슨 벌브 조명, 러프한 우드 테이블.",
  },
  {
    room: "dressing-room",
    style: "classic",
    before: "아파트의 작은 방. 비어 있다. 흰 벽, 밝은 마루.",
    after: "클래식 드레스룸. 몰딩이 들어간 화이트 붙박이장과 유리 도어, 가운데 아일랜드 서랍장과 주얼리 트레이, 크리스털 샹들리에, 벨벳 스툴과 전신 거울.",
  },
  {
    room: "studio",
    style: "nordic",
    before: "6평 원룸. 비어 있다. 창 하나, 흰 벽, 밝은 마루.",
    after: "북유럽풍 원룸. 밝은 자작나무 가구, 패브릭 소파베드와 라운드 커피 테이블, 린넨 커튼, 화이트 오크 선반과 초록 식물. 작지만 답답하지 않게.",
  },
  {
    room: "kitchen",
    style: "french",
    before: "아파트의 주방 겸 다이닝 공간. 비어 있다. 창 하나, 흰 벽.",
    after: "프렌치 다이닝. 몰딩 벽과 헤링본 마루, 원형 원목 식탁과 라탄 체어, 리넨 커튼, 앤티크 황동 샹들리에, 벽면 접시 장식. 파리 아파트 같은 결.",
  },
];

/** 앵글·구조를 고정하는 공통 지시 — "전"과 "후"가 같은 방으로 읽혀야 한다 */
const KEEP_ROOM = [
  "이것은 실제로 촬영된 빈 방 사진이다.",
  "벽·바닥·천장의 위치, 창문과 문의 위치와 크기, 카메라 앵글과 화각, 시점 높이를 픽셀 단위로 그대로 유지한다.",
  "방을 다시 그리거나 다른 방으로 바꾸지 않는다. 기존 방에 가구와 마감만 더한다.",
  "잡지 화보에 실릴 만큼 완성도 높게 연출한다. 마감재의 질감, 조명의 층위, 소품의 배치까지 신경 쓴다.",
  "실제 인테리어 촬영 사진처럼 사실적인 재질감과 자연광, 얕은 그림자를 유지한다.",
  "텍스트·워터마크·사람·반려동물은 넣지 않는다.",
].join(" ");

const BEFORE_PROMPT = [
  "한국 아파트 실내를 실제로 촬영한 것 같은 사진.",
  "가구가 전혀 없는 빈 방이며, 벽·바닥·천장과 창문만 보인다.",
  "자연광이 들어오는 낮, 표준 화각(24~35mm)으로 방 전체가 들어오게 찍은 구도.",
  "텍스트·워터마크·사람은 넣지 않는다.",
].join(" ");

/* ────────────────────────────── 모델 호출 ────────────────────────────── */

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/** 4K 가 실제로 나오는 모델 (config/plans.ts 와 같은 값) */
const MODEL_HI = "gemini-3.1-flash-image";
const MODEL_BASE = "gemini-2.5-flash-image";

/**
 * 이미지를 한 장 받아 온다.
 *
 * 설정을 몰라서 난 오류일 때만 단계를 낮춘다 — 붐벼서 난 오류까지 되물리면 같은
 * 요청을 네 번 던지게 된다(src/lib/image-api.ts 와 같은 이유).
 */
async function callImage({ model, parts, size }) {
  const configs = [
    { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:3", imageSize: size } },
    { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:3" } },
    { responseModalities: ["IMAGE"] },
  ];

  let lastError;

  for (const config of configs) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config,
        });

        const inline = (response.candidates?.[0]?.content?.parts ?? []).find(
          (part) => part.inlineData?.data
        )?.inlineData;

        if (!inline?.data) throw new Error("응답에 이미지가 없습니다");
        return Buffer.from(inline.data, "base64");
      } catch (error) {
        lastError = error;
        const text = error instanceof Error ? error.message : String(error);

        if (/\b400\b|INVALID_ARGUMENT|Unknown name/i.test(text)) break; // 설정 문제 → 단계를 낮춘다
        if (!/\b(429|500|502|503|504)\b|UNAVAILABLE|INTERNAL|overloaded/i.test(text)) throw error;

        const wait = [2000, 6000, 12000][attempt];
        process.stdout.write(` (붐빔, ${wait / 1000}초 뒤 다시)`);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
  }

  throw lastError ?? new Error("이미지를 만들지 못했습니다");
}

/** 앱과 같은 방식으로 마무리한다 — 큰 그림은 늘리면서 사라진 경계를 되살린다 */
async function finalize(data) {
  const pipeline = sharp(data);
  const meta = await pipeline.metadata();
  const long = Math.max(meta.width ?? 0, meta.height ?? 0);

  if (long >= 4000) pipeline.sharpen({ sigma: 1, m1: 0, m2: 2.5 });
  else if (long >= 2000) pipeline.sharpen({ sigma: 0.7, m1: 0, m2: 1.5 });

  const output = await pipeline.webp({ quality: 90 }).toBuffer();
  const out = await sharp(output).metadata();

  return { data: output, width: out.width, height: out.height };
}

/* ────────────────────────────── 저장 ────────────────────────────── */

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

/** 시안을 누구 것으로 남길지 — 가장 먼저 가입한 계정(우리 것)을 쓴다 */
async function ownerId() {
  const pinned = process.env.GALLERY_SEED_USER_ID;
  if (pinned) return pinned;

  const { data, error } = await db
    .from("profiles")
    .select("id, created_at")
    .order("created_at", { ascending: true })
    .limit(1);

  if (error || !data?.length) throw new Error("올릴 계정을 찾지 못했습니다 (profiles 가 비어 있음)");
  return data[0].id;
}

/** slug 는 갤러리 주소가 된다. 이미 있으면 뒤에 번호를 붙인다. */
async function freeSlug(base) {
  for (let n = 1; n < 30; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const { data } = await db
      .from("generation_results")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (!data) return slug;
  }
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

const ROOM_SLUG = {
  "living-room": "아파트-거실",
  bedroom: "아파트-침실",
  studio: "원룸",
  kitchen: "아파트-주방",
  "kids-room": "아이방",
  "home-office": "서재",
  bathroom: "욕실",
  "dressing-room": "드레스룸",
};

const STYLE_LABEL = {
  luxury: "럭셔리",
  hotel: "호텔식",
  modern: "모던",
  midcentury: "미드센추리",
  kids: "키즈",
  minimal: "미니멀",
  industrial: "인더스트리얼",
  classic: "클래식",
  nordic: "북유럽",
  french: "프렌치",
};

/* ────────────────────────────── 한 벌 만들기 ────────────────────────────── */

async function seedOne(entry, index, userId) {
  const tag = `${index + 1}/${PLAN.length} ${ROOM_SLUG[entry.room]} · ${STYLE_LABEL[entry.style]}`;
  process.stdout.write(`${tag} — 빈 방`);

  const beforeRaw = await callImage({
    model: MODEL_BASE,
    parts: [{ text: `${BEFORE_PROMPT}\n\n${entry.before}` }],
    size: "1K",
  });
  const before = await sharp(beforeRaw).webp({ quality: 88 }).toBuffer();

  process.stdout.write(" → 4K 시안");
  const afterRaw = await callImage({
    model: MODEL_HI,
    parts: [
      { text: `${KEEP_ROOM}\n\n${entry.after}` },
      { inlineData: { mimeType: "image/webp", data: before.toString("base64") } },
    ],
    size: "4K",
  });
  const after = await finalize(afterRaw);

  process.stdout.write(` (${after.width}×${after.height}) → 저장`);

  /* 1) 작업 행 — 사용자가 스튜디오에서 만든 것과 같은 모양으로 남긴다 */
  const prompt = `${KEEP_ROOM}\n\n${entry.after}`;
  const { data: job, error: jobError } = await db
    .from("generation_jobs")
    .insert({
      user_id: userId,
      status: "succeeded",
      mode_id: "redesign",
      room_id: entry.room,
      style_id: entry.style,
      resolution: "ultra",
      use_mask: false,
      prompt,
      image_count: 1,
      credits_charged: 0,
      plan_at_request: "pro",
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (jobError) throw new Error(`작업 기록 실패: ${jobError.message}`);

  /* 2) 전/후 두 장을 올린다 */
  const sourcePath = `${userId}/${job.id}/source.webp`;
  const resultPath = `${userId}/${job.id}/1.webp`;
  const beforeCopy = `${userId}/gallery/${job.id}-before.webp`;

  for (const [bucket, key, body] of [
    ["sources", sourcePath, before],
    ["results", resultPath, after.data],
    ["results", beforeCopy, before],
  ]) {
    const { error } = await db.storage
      .from(bucket)
      .upload(key, body, { contentType: "image/webp", upsert: true });
    if (error) throw new Error(`${bucket} 업로드 실패: ${error.message}`);
  }

  await db.from("generation_jobs").update({ source_path: sourcePath }).eq("id", job.id);

  /* 3) 결과 행 — author_name 을 비워 두면 갤러리가 "익명"으로 읽는다 */
  const slug = await freeSlug(
    `${ROOM_SLUG[entry.room]}-${STYLE_LABEL[entry.style]}-인테리어`.replace(/\s+/g, "-")
  );

  const { error: resultError } = await db.from("generation_results").insert({
    job_id: job.id,
    user_id: userId,
    storage_path: resultPath,
    width: after.width,
    height: after.height,
    watermarked: false,
    position: 0,
    is_public: true,
    slug,
    author_name: null,
    before_path: beforeCopy,
  });

  if (resultError) throw new Error(`결과 기록 실패: ${resultError.message}`);

  console.log(` ✓ /gallery/${slug}`);
}

/* ────────────────────────────── 실행 ────────────────────────────── */

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const picked = args.filter((a) => /^\d+$/.test(a)).map(Number);
const entries = picked.length ? picked.map((n) => PLAN[n - 1]).filter(Boolean) : PLAN;

if (dry) {
  console.log(`만들 시안 ${entries.length}벌 (돈은 쓰지 않음)\n`);
  entries.forEach((entry, i) => {
    console.log(`  ${i + 1}. ${ROOM_SLUG[entry.room]} · ${STYLE_LABEL[entry.style]}`);
    console.log(`     ${entry.after.slice(0, 76)}…`);
  });
  console.log(`\n예상 비용 약 $${(entries.length * 0.19).toFixed(2)} (빈 방 $0.039 + 4K $0.151)`);
  process.exit(0);
}

if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY 가 없습니다");
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY 가 없습니다");

const userId = await ownerId();
console.log(`갤러리 시안 ${entries.length}벌을 만듭니다 (계정 ${userId.slice(0, 8)}…, 익명 공개)\n`);

let done = 0;
const failures = [];

for (const [index, entry] of entries.entries()) {
  try {
    await seedOne(entry, index, userId);
    done += 1;
  } catch (error) {
    console.log(` ✗ ${error instanceof Error ? error.message : error}`);
    failures.push({ entry, error });
  }
}

console.log(`\n${done}/${entries.length}벌 올렸습니다.`);
if (failures.length) {
  console.log("실패한 것:");
  for (const f of failures) console.log(`  ${ROOM_SLUG[f.entry.room]} · ${STYLE_LABEL[f.entry.style]}`);
}
