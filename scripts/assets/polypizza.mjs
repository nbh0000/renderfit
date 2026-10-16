/**
 * Poly Pizza 무료 3D 모델을 카탈로그에 통째로 채워 넣는다.
 *
 * 편집기의 "무료" 탭은 검색할 때마다 Poly Pizza를 부르지만, 그건 사용자가 영어로
 * 검색어를 떠올려야 쓸 수 있다. 가구 탭에서 그냥 펼쳐 고를 수 있어야 배치가 된다.
 * 그래서 실내에 놓일 만한 항목을 미리 훑어 카탈로그(models/polypizza.generated.ts)에 굽는다.
 *
 * 하는 일
 *  1) QUERIES의 검색어로 Poly Pizza를 훑는다 (한 페이지 32개, 끝까지 넘긴다)
 *  2) 모델의 앞부분만 Range로 받아 glTF JSON을 읽고, POSITION accessor로 경계 상자를 잰다
 *     — 통째로 받으면 500MB가 넘는다. 크기를 재는 데는 파일 앞의 JSON 청크면 충분하다
 *  3) 잰 상자를 종류별 표준 규격에 비례로 맞춰 mm로 환산한다
 *     — Poly 계열은 단위가 제각각이다 (같은 소파가 4단위로도, 108단위로도 들어온다)
 *  4) 라이선스와 저작자 표시(CC-BY는 표기 의무가 있다)를 함께 적어 둔다
 *
 * 모델 파일은 내려받지 않고 static.poly.pizza 를 그대로 가리킨다. CDN이 CORS를
 * 열어 두어(Access-Control-Allow-Origin: *) three.js가 바로 읽고, 500MB를 저장소에
 * 넣거나 빌드마다 다시 받을 이유가 없다. 편집기의 "무료" 탭도 이미 같은 URL을 쓴다.
 *
 * 실행: node scripts/assets/polypizza.mjs
 *       node scripts/assets/polypizza.mjs --dry     (검색만 하고 몇 개가 잡히는지 본다)
 *       node scripts/assets/polypizza.mjs --force   (캐시해 둔 치수를 버리고 다시 잰다)
 *
 * 키가 없으면 이미 구워 둔 카탈로그를 그대로 두고 넘어간다 — 빌드가 키 없이도 돌아야 한다.
 */

import { existsSync, promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** 잰 치수를 담아 두는 캐시 — 다시 돌릴 때 같은 모델을 또 재지 않는다 */
const CACHE = path.join(ROOT, ".cache", "polypizza-size.json");
const GENERATED = path.join(ROOT, "models", "polypizza.generated.ts");

const API = "https://api.poly.pizza/v1/search";
/** 검색 응답은 페이지당 32개 고정이다 (limit을 올려도 그 이상 오지 않는다) */
const PAGE_SIZE = 32;
/** 크기를 재려고 받아 오는 앞부분의 길이. glTF JSON 청크는 거의 이 안에 들어온다 */
const HEAD_BYTES = 256 * 1024;
/** 동시에 재는 개수 — 더 올리면 CDN이 끊는다 */
const CONCURRENCY = 8;

const DRY = process.argv.includes("--dry");
const FORCE = process.argv.includes("--force");

/**
 * 검색어 → 우리 분류.
 *
 * type은 3D 배치 규칙(벽에 붙는지, 바닥에 놓이는지)에 쓰이고,
 * category는 가구 탭의 접이식 목록 이름과 같아야 보인다.
 */
const QUERIES = [
  { q: "sofa", type: "sofa", category: "sofa" },
  { q: "couch", type: "sofa", category: "sofa" },
  { q: "armchair", type: "sofa", category: "sofa" },
  { q: "chair", type: "chair", category: "chair" },
  { q: "dining chair", type: "chair", category: "chair" },
  { q: "office chair", type: "chair", category: "chair" },
  { q: "stool", type: "chair", category: "chair" },
  { q: "bench", type: "chair", category: "chair" },
  { q: "table", type: "table", category: "table" },
  { q: "desk", type: "table", category: "table" },
  { q: "coffee table", type: "table", category: "table" },
  { q: "dining table", type: "table", category: "table" },
  { q: "piano", type: "table", category: "table" },
  { q: "bed", type: "bed", category: "bed" },
  { q: "bunk bed", type: "bed", category: "bed" },
  { q: "cabinet", type: "cabinet", category: "cabinet" },
  { q: "wardrobe", type: "cabinet", category: "cabinet" },
  { q: "bookshelf", type: "cabinet", category: "cabinet" },
  { q: "bookcase", type: "cabinet", category: "cabinet" },
  { q: "shelf", type: "cabinet", category: "cabinet" },
  { q: "dresser", type: "cabinet", category: "cabinet" },
  { q: "sideboard", type: "cabinet", category: "cabinet" },
  { q: "nightstand", type: "cabinet", category: "cabinet" },
  { q: "lamp", type: "lamp", category: "lamp" },
  { q: "floor lamp", type: "lamp", category: "lamp" },
  { q: "ceiling light", type: "lamp", category: "lamp" },
  { q: "chandelier", type: "lamp", category: "lamp" },
  { q: "refrigerator", type: "appliance", category: "appliance" },
  { q: "fridge", type: "appliance", category: "appliance" },
  { q: "washing machine", type: "appliance", category: "appliance" },
  { q: "washer", type: "appliance", category: "appliance" },
  { q: "oven", type: "appliance", category: "appliance" },
  { q: "microwave", type: "appliance", category: "appliance" },
  { q: "stove", type: "appliance", category: "appliance" },
  { q: "sink", type: "appliance", category: "appliance" },
  { q: "toilet", type: "appliance", category: "appliance" },
  { q: "bathtub", type: "appliance", category: "appliance" },
  { q: "radiator", type: "appliance", category: "appliance" },
  { q: "fan", type: "appliance", category: "appliance" },
  { q: "air conditioner", type: "appliance", category: "appliance" },
  { q: "tv", type: "tv", category: "appliance" },
  { q: "television", type: "tv", category: "appliance" },
  { q: "monitor", type: "tv", category: "appliance" },
  { q: "laptop", type: "tv", category: "appliance" },
  { q: "rug", type: "rug", category: "rug" },
  { q: "carpet", type: "rug", category: "rug" },
  { q: "plant", type: "plant", category: "plant" },
  { q: "potted plant", type: "plant", category: "plant" },
  { q: "houseplant", type: "plant", category: "plant" },
  { q: "cactus", type: "plant", category: "plant" },
  { q: "mirror", type: "decoration", category: "decoration" },
  { q: "picture frame", type: "decoration", category: "decoration" },
  { q: "painting", type: "decoration", category: "decoration" },
  { q: "wall art", type: "decoration", category: "decoration" },
  { q: "vase", type: "decoration", category: "decoration" },
  { q: "clock", type: "decoration", category: "decoration" },
  { q: "curtains", type: "decoration", category: "decoration" },
  { q: "pillow", type: "decoration", category: "decoration" },
  { q: "books", type: "decoration", category: "decoration" },
  { q: "candle", type: "decoration", category: "decoration" },
  { q: "trash can", type: "decoration", category: "decoration" },
  { q: "speaker", type: "decoration", category: "decoration" },
];


/**
 * 종류별 표준 규격(mm) — 잰 값을 여기에 비례로 맞춘다.
 * models/sources/polyPizza.ts의 DEFAULT_SIZE와 같은 값을 쓴다.
 */
const STANDARD = {
  sofa: [2000, 800, 900],
  chair: [500, 850, 550],
  table: [1200, 750, 700],
  cabinet: [900, 1800, 450],
  bed: [1500, 600, 2000],
  lamp: [350, 1500, 350],
  plant: [500, 1200, 500],
  rug: [2000, 20, 1400],
  tv: [1200, 700, 80],
  appliance: [600, 1800, 650],
  decoration: [300, 400, 300],
};

function key() {
  const fromEnv = process.env.POLY_PIZZA_API_KEY;
  if (fromEnv) return fromEnv.trim();

  // 로컬에서는 .env.local 에만 넣어 두는 경우가 많다.
  const file = path.join(ROOT, ".env.local");
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((item) => item.startsWith("POLY_PIZZA_API_KEY"));
  return line ? line.slice(line.indexOf("=") + 1).trim() : "";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 실패하면 잠깐 쉬었다 다시 부른다.
 *
 * 검색어를 예순 개 넘게 연달아 던지면 중간부터 조용히 빈 응답이 온다. 처음 만들 때
 * 이걸 모르고 돌려서 TV·러그·거울이 통째로 빠진 카탈로그가 나왔다.
 */
async function get(url, options, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      if (response.status === 404 || response.status === 401) return null;
    } catch {
      /* 네트워크 오류도 같은 방식으로 다시 시도한다 */
    }
    await sleep(attempt * 700);
  }
  return null;
}

/** 검색어 하나를 끝까지 넘기며 결과를 모은다 */
async function searchAll(token, query) {
  const collected = [];

  /* page 는 0부터 센다 — page=1로 시작하면 첫 32개가 통째로 빠진다 (TV·러그·거울이 그렇게 사라졌다) */
  for (let page = 0; page < 20; page += 1) {
    const url = `${API}/${encodeURIComponent(query)}?limit=${PAGE_SIZE}&page=${page}`;
    const response = await get(url, { headers: { "x-auth-token": token } });
    if (!response) break;

    const data = await response.json();
    const results = data.results ?? [];
    collected.push(...results);

    if (results.length < PAGE_SIZE) break;
    if (collected.length >= (data.total ?? 0)) break;
  }

  return collected;
}

/* ─────────────────────────── glTF 경계 상자 ─────────────────────────── */

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** TRS 또는 matrix 를 column-major 4x4 로 만든다 (glTF 규약) */
function localMatrix(node) {
  if (node.matrix) return node.matrix.slice();

  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];

  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;

  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function apply(matrix, [x, y, z]) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

/** GLB 바이너리에서 JSON 청크만 꺼낸다 */
function readGlbJson(buffer) {
  if (buffer.length < 20 || buffer.toString("utf8", 0, 4) !== "glTF") return null;
  const jsonLength = buffer.readUInt32LE(12);
  try {
    return JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength));
  } catch {
    return null;
  }
}

/**
 * 모델의 경계 상자를 잰다.
 *
 * 메시 accessor의 min/max(8개 꼭짓점)를 노드 변환까지 태워 누적한다.
 * 정점을 전부 읽지 않아도 상자 크기는 이것으로 충분하다.
 */
function measure(json) {
  if (!json?.nodes?.length) return null;

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  const walk = (index, parent) => {
    const node = json.nodes[index];
    if (!node) return;
    const world = multiply(parent, localMatrix(node));

    const mesh = node.mesh != null ? json.meshes?.[node.mesh] : null;
    for (const primitive of mesh?.primitives ?? []) {
      const accessor = json.accessors?.[primitive.attributes?.POSITION];
      if (!accessor?.min || !accessor?.max) continue;

      const [ax, ay, az] = accessor.min;
      const [bx, by, bz] = accessor.max;
      for (const corner of [
        [ax, ay, az], [bx, ay, az], [ax, by, az], [ax, ay, bz],
        [bx, by, az], [bx, ay, bz], [ax, by, bz], [bx, by, bz],
      ]) {
        const point = apply(world, corner);
        for (let i = 0; i < 3; i += 1) {
          if (point[i] < min[i]) min[i] = point[i];
          if (point[i] > max[i]) max[i] = point[i];
        }
      }
    }

    for (const child of node.children ?? []) walk(child, world);
  };

  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? json.nodes.map((_, i) => i);
  for (const root of roots) walk(root, identity);

  if (!Number.isFinite(min[0]) || !Number.isFinite(max[0])) return null;
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
}

/**
 * 잰 상자를 mm 로 환산한다.
 *
 * glTF 의 단위는 미터다. 그 규약을 지킨 모델은 잰 값에 1000을 곱하면 그대로 실치수가
 * 된다 — 소파는 1.9m, 프라이팬은 0.3m 로 들어온다. 이쪽을 우선한다.
 *
 * 그런데 Poly 계열에는 규약을 안 지킨 모델이 섞여 있다. 같은 소파가 4단위로도,
 * 108단위로도, 300단위로도 들어온다. 그런 것만 비례를 지킨 채 그 종류의 표준 규격에
 * 맞춘다 — 프라이팬을 1.8m 로 부풀리지 않으려면 이 둘을 갈라야 한다.
 *
 * 실내에 놓이는 물건이 100mm 보다 작거나 4m 보다 클 일은 없다고 보고 그 밖을 벗어나면
 * 단위를 안 지킨 것으로 판단한다.
 */
const PLAUSIBLE_MIN_MM = 100;
const PLAUSIBLE_MAX_MM = 4000;

function toMillimeters(box, type) {
  const standard = STANDARD[type] ?? [600, 600, 600];
  const fallback = { width: standard[0], height: standard[1], depth: standard[2] };

  if (!box) return fallback;

  const longest = Math.max(...box);
  if (!(longest > 0)) return fallback;

  // 1) 미터로 읽었을 때 실내 물건다운 크기면 그대로 쓴다
  const asMeters = box.map((value) => Math.round(value * 1000));
  const longestMm = Math.max(...asMeters);
  if (longestMm >= PLAUSIBLE_MIN_MM && longestMm <= PLAUSIBLE_MAX_MM) {
    return {
      width: Math.max(10, asMeters[0]),
      height: Math.max(10, asMeters[1]),
      depth: Math.max(10, asMeters[2]),
    };
  }

  // 2) 단위를 못 믿을 때만 비례를 지킨 채 표준 규격에 맞춘다
  const scale = Math.max(...standard) / longest;
  const size = box.map((value) => Math.max(10, Math.round(value * scale)));
  return { width: size[0], height: size[1], depth: size[2] };
}

/* ─────────────────────────── 실행 ─────────────────────────── */

/**
 * 모델 앞부분만 받아 경계 상자를 잰다.
 *
 * GLB는 [12바이트 헤더][4바이트 길이][4바이트 종류][JSON]... 순서라 앞의 256KB면
 * 거의 모든 모델의 JSON 청크가 들어온다. 그보다 긴 JSON을 가진 모델만 통째로 받는다.
 */
async function measureRemote(url) {
  const head = await get(url, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
  if (!head) return null;

  let buffer = Buffer.from(await head.arrayBuffer());
  if (buffer.length < 20) return null;

  const jsonLength = buffer.readUInt32LE(12);
  if (20 + jsonLength > buffer.length) {
    const whole = await get(url, {});
    if (!whole) return null;
    buffer = Buffer.from(await whole.arrayBuffer());
  }

  return measure(readGlbJson(buffer));
}

/** 목록을 CONCURRENCY개씩 동시에 처리한다 */
async function mapLimit(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

async function readCache() {
  if (FORCE || !existsSync(CACHE)) return {};
  try {
    return JSON.parse(await fs.readFile(CACHE, "utf8"));
  } catch {
    return {};
  }
}

function displayName(title, category) {
  const clean = (title ?? "").replace(/\s+/g, " ").trim();
  return clean || category;
}

async function main() {
  const token = key();
  if (!token) {
    console.log("POLY_PIZZA_API_KEY 가 없어 건너뜁니다 (구워 둔 카탈로그를 그대로 씁니다).");
    if (!existsSync(GENERATED)) await write([]);
    return;
  }

  /** ID 하나가 여러 검색어에 걸린다 — 처음 잡힌 분류를 쓴다 */
  const found = new Map();

  for (const entry of QUERIES) {
    const results = await searchAll(token, entry.q);
    for (const item of results) {
      if (!item.ID || !item.Download) continue;
      if (found.has(item.ID)) continue;
      found.set(item.ID, { ...entry, item });
    }
    console.log(`  ${entry.q}: ${results.length}개 (누적 ${found.size})`);
  }

  console.log(`검색 결과 ${found.size}종.`);
  if (DRY) return;

  const cache = await readCache();
  const entries = [...found.entries()];

  const measured = await mapLimit(entries, async ([id, { item }]) => {
    if (cache[id]) return cache[id];
    const box = await measureRemote(item.Download);
    cache[id] = box; // 못 잰 것(null)도 적어 둔다 — 다시 돌릴 때 또 받지 않는다
    return box;
  });

  const models = entries.map(([id, { q, type, category, item }], index) => {
    const creator = item.Creator?.Username?.trim() || "Unknown";
    return {
      id: `poly_${id}`,
      name: displayName(item.Title, category),
      type,
      category,
      dimensions: toMillimeters(measured[index], type),
      modelUrl: item.Download,
      thumbnailUrl: item.Thumbnail ?? "",
      tags: [q, ...(item.Tags ?? [])].slice(0, 8),
      license: item.Licence ?? "CC-BY",
      attribution: item.Attribution?.trim() || `"${item.Title}" by ${creator}`,
      sourceUrl: `https://poly.pizza/m/${id}`,
    };
  });

  await fs.mkdir(path.dirname(CACHE), { recursive: true });
  await fs.writeFile(CACHE, JSON.stringify(cache), "utf8");

  const unmeasured = measured.filter((box) => !box).length;
  await write(models);
  console.log(`카탈로그 ${models.length}종 (치수를 못 잰 ${unmeasured}종은 표준 규격을 쓴다).`);
}

async function write(models) {
  const sorted = models.sort((a, b) =>
    a.category === b.category ? a.name.localeCompare(b.name) : a.category.localeCompare(b.category)
  );

  /*
   * 목록을 TypeScript 배열 리터럴로 적으면 tsc 가 2천 개짜리 객체 리터럴을 하나하나
   * 대조하다 "union type that is too complex to represent" 로 넘어진다.
   * JSON 문자열 하나로 적고 실행할 때 한 번 파싱한다 — 타입 검사는 공짜가 되고
   * 서버가 뜰 때 10ms 남짓 든다.
   */
  const payload = JSON.stringify(sorted)
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\`")
    .replaceAll("${", "\${");

  const file = `/* 이 파일은 scripts/assets/polypizza.mjs가 만든다. 직접 고치지 말 것. */

import type { ObjectType } from "@/scene/types";

export interface PolyPizzaModel {
  id: string;
  name: string;
  type: ObjectType;
  category: string;
  dimensions: { width: number; height: number; depth: number };
  /** static.poly.pizza 의 .glb — CDN 이 CORS 를 열어 두어 바로 읽힌다 */
  modelUrl: string;
  thumbnailUrl: string;
  tags: string[];
  /** CC0 또는 CC-BY */
  license: string;
  /** CC-BY는 저작자 표시 의무가 있다 — 배치할 때 Scene에 함께 저장한다 */
  attribution: string;
  sourceUrl: string;
}

export const POLYPIZZA_MODELS: PolyPizzaModel[] = JSON.parse(
  ${"`"}${payload}${"`"}
) as PolyPizzaModel[];
`;

  await fs.writeFile(GENERATED, file, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
