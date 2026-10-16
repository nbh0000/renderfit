import { parseFloorPlanDoc, type FloorPlanDoc } from "@renderfit/plan-schema";

/**
 * 파싱 마이크로서비스를 부른다.
 *
 * ezdxf·shapely·opencv·벡터화 모델이 전부 Python 생태계라 파싱은 따로 세운 FastAPI
 * 서비스가 맡는다. 여기서는 파일을 넘기고 FloorPlanDoc 을 받아 오는 일만 한다.
 *
 * 받은 것을 **반드시 스키마로 검사한다.** 서비스가 조금 다른 모양을 돌려주면 그대로
 * 편집기까지 흘러가 화면이 깨지는데, 그때는 어디서 어긋났는지 되짚기 어렵다.
 */

/** 서비스 주소. 안 잡혀 있으면 로컬 기본값 */
const BASE = process.env.PLAN_INGEST_URL ?? "http://127.0.0.1:8001";

/** CAD 파싱은 몇십 초까지 걸린다 — 큰 도면은 폴리곤 만들기가 오래 걸린다 */
const TIMEOUT_MS = 120_000;

export type IngestFailure =
  /** 서비스가 안 떠 있다 */
  | { kind: "offline"; message: string }
  /** 서비스는 떴는데 이 파일을 못 다룬다 (DWG 컨버터 없음 등) */
  | { kind: "unsupported"; message: string }
  /** 파일이 잘못됐다 */
  | { kind: "invalid"; message: string };

export type IngestResult = { ok: true; doc: FloorPlanDoc } | { ok: false; failure: IngestFailure };

export type IngestHealth = {
  ok: boolean;
  /** DWG 를 받을 수 있는가 (ODA File Converter 가 있는가) */
  dwgConverter: boolean;
  /** 래스터 도면을 벡터로 바꿀 수 있는가 */
  raster: boolean;
  /** 치수 글자를 읽을 OCR 이 있는가 — 없으면 배율을 사용자가 찍어야 한다 */
  rasterOcr: boolean;
};

/** 서비스가 살아 있는지, 지금 어떤 경로를 받을 수 있는지 */
export async function ingestHealth(): Promise<IngestHealth> {
  const dead: IngestHealth = { ok: false, dwgConverter: false, raster: false, rasterOcr: false };

  try {
    const response = await fetch(`${BASE}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return dead;

    const data = (await response.json()) as Partial<IngestHealth>;
    return {
      ok: data.ok === true,
      dwgConverter: data.dwgConverter === true,
      raster: data.raster === true,
      rasterOcr: data.rasterOcr === true,
    };
  } catch {
    return dead;
  }
}

/**
 * CAD 파일 하나를 FloorPlanDoc 으로.
 *
 * `format` 이 dwg 면 서비스가 ODA File Converter 로 DXF 를 거쳐 읽는다. 컨버터가
 * 없으면 501 이 오는데, 그때 무엇을 설치해야 하는지까지 담겨 있으므로 그대로 올린다.
 */
export async function parseCadFile(
  file: { name: string; bytes: Uint8Array; format: "dxf" | "dwg" }
): Promise<IngestResult> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file.bytes)]), file.name);

  return post(`${BASE}/parse/${file.format}`, form);
}

/** 파싱 서비스에 한 번 보내고, 돌아온 것을 스키마로 검사한다 */
async function post(url: string, form: FormData): Promise<IngestResult> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      failure: {
        kind: "offline",
        message:
          `도면 파싱 서비스에 닿지 못했습니다 (${BASE}). ` +
          "services/plan-ingest 를 띄운 뒤 다시 시도해 주세요. " +
          (error instanceof Error ? error.message.slice(0, 100) : ""),
      },
    };
  }

  if (!response.ok) {
    const detail = await response
      .json()
      .then((body) => (body as { detail?: string }).detail)
      .catch(() => undefined);

    return {
      ok: false,
      failure: {
        /* 501 은 "이 서버가 아직 그 일을 못 한다" — 파일 잘못이 아니다 */
        kind: response.status === 501 ? "unsupported" : "invalid",
        message: detail ?? `파싱 서비스가 ${response.status} 를 돌려줬습니다.`,
      },
    };
  }

  const parsed = parseFloorPlanDoc(await response.json());
  if (!parsed.ok) {
    return {
      ok: false,
      failure: { kind: "invalid", message: `파싱 결과가 스키마와 다릅니다 — ${parsed.error}` },
    };
  }

  return { ok: true, doc: parsed.doc };
}


/** 사용자가 UI 에서 잡아 준 도면 영역 (원본 이미지 픽셀, 왼쪽 위 기준) */
export type CropRect = { x: number; y: number; width: number; height: number };

/**
 * 스캔·캡처 도면 한 장을 FloorPlanDoc 으로.
 *
 * **원본 DXF 가 없을 때의 차선책**이다. 자동 완성이 목표가 아니라 검수 시간을 줄이는
 * 것이 목표이므로, 돌아온 문서는 언제나 review.status 가 "auto" 이고 의심스러운
 * 항목이 flags 에 올라 있다.
 *
 * crop 이 정확도에 가장 크게 영향을 준다 — 표제란·범례가 함께 들어오면 벡터화 모델이
 * 그 선까지 벽으로 읽는다. 없이도 돌아가지만 결과가 눈에 띄게 나빠진다.
 */
export async function parseRasterFile(
  file: { name: string; bytes: Uint8Array },
  crop?: CropRect | null
): Promise<IngestResult> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file.bytes)]), file.name);

  if (crop) {
    form.append("crop_x", String(Math.round(crop.x)));
    form.append("crop_y", String(Math.round(crop.y)));
    form.append("crop_width", String(Math.round(crop.width)));
    form.append("crop_height", String(Math.round(crop.height)));
  }

  return post(`${BASE}/parse/raster`, form);
}
