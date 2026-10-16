import { randomUUID } from "node:crypto";
import { getViewer } from "@/lib/auth";
import { createAdminSupabase } from "@/lib/supabase/server";
import { classifyPlanFile, type Classification } from "@/services/planIngest";
import { parseCadFile, parseRasterFile, type CropRect } from "@/services/planIngestClient";
import { getStorage } from "@/lib/storage";
import type { FloorPlanDoc } from "@renderfit/plan-schema";

/**
 * 도면 들여오기.
 *
 * 파일을 받아 **어느 경로로 갈지** 정하고, 그 경로의 파서에 넘긴 뒤 잡을 남긴다.
 *
 * 경로가 셋인 이유는 기하를 만드는 방법이 다르기 때문이다.
 *  · cad     — DXF·DWG. 파서가 좌표를 그대로 읽는다
 *  · cad-pdf — 벡터 PDF. DXF 로 옮긴 뒤 같은 파서를 태운다
 *  · raster  — 스캔 PDF·PNG·JPG. 벡터화 모델을 거친다
 *
 * 어느 경로에도 **LLM 이 좌표를 지어내는 길은 없다.** LLM 은 확정된 기하 위에
 * 실 이름과 설비 종류만 붙인다.
 *
 * ── 여기서 편집기로 바로 넘기지 않는다 ──
 *
 * 읽어 낸 문서는 잡에만 담고, 검수 화면 주소를 돌려준다. 사람이 한 번 보고 확인을
 * 누르기 전에는(review.status="confirmed") 편집기·3D 로 넘어가지 않는다. 자동으로
 * 읽은 도면을 그대로 얹으면, 틀린 채로 3D 가 서고 견적까지 뽑히기 때문이다.
 */

/** 도면 파일 한 장의 한계 (바이트) — A0 스캔도 이 안에 든다 */
const MAX_BYTES = 60 * 1024 * 1024;

const PHASE: Record<Classification["route"], string> = {
  cad: "페이즈 1 — DXF 파서",
  "cad-pdf": "페이즈 1 — PDF→DXF 변환 뒤 DXF 파서",
  raster: "페이즈 2 — 벡터화 모델",
};

/**
 * 사용자가 잡아 준 도면 영역을 꺼낸다.
 *
 * 래스터 경로의 정확도에 가장 크게 영향을 주는 값이다 — 표제란·범례가 함께 들어오면
 * 벡터화 모델이 그 선까지 벽으로 읽는다. 네 값이 다 오지 않으면 없는 것으로 본다;
 * 반쯤 온 사각형으로 자르면 엉뚱한 자리를 도면으로 삼는다.
 */
function readCrop(form: FormData): CropRect | null {
  const numbers = ["cropX", "cropY", "cropWidth", "cropHeight"].map((key) => {
    const value = form.get(key);
    return typeof value === "string" ? Number(value) : Number.NaN;
  });

  if (numbers.some((value) => !Number.isFinite(value))) return null;
  const [x, y, width, height] = numbers;
  if (width <= 0 || height <= 0) return null;

  return { x, y, width, height };
}

export async function POST(request: Request) {
  const viewer = await getViewer();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "파일을 multipart/form-data 로 보내 주세요." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file 항목이 없습니다." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: `파일이 너무 큽니다 (${Math.round(file.size / 1024 / 1024)}MB). 60MB 까지 받습니다.` },
      { status: 413 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const bytes = new Uint8Array(buffer);
  const verdict = classifyPlanFile({ name: file.name, bytes });

  if ("error" in verdict) {
    return Response.json({ error: verdict.error }, { status: 415 });
  }

  const jobId = `ingest_${randomUUID()}`;
  const projectId = typeof form.get("projectId") === "string" ? String(form.get("projectId")) : null;
  const crop = readCrop(form);

  /*
   * 그림은 검수 화면이 겹쳐 놓을 것이므로 남긴다. DXF·DWG 는 겹쳐 놓을 그림이 없다.
   * 저장이 안 되는 환경(로컬·데모)에서도 파싱 자체는 되어야 하므로 실패해도 넘어간다.
   */
  let imageUrl: string | null = null;
  if (verdict.route === "raster" && file.type.startsWith("image/")) {
    try {
      imageUrl = await getStorage().upload(
        `plan-ingest/${jobId}/source.${verdict.format === "png" ? "png" : "jpg"}`,
        buffer,
        file.type
      );
    } catch (error) {
      console.warn(`[ingest] 원본 그림을 못 남겼습니다: ${String(error).slice(0, 120)}`);
    }
  }

  const job = {
    id: jobId,
    owner_id: viewer.userId,
    project_id: projectId,
    route: verdict.route,
    format: verdict.format,
    reason: verdict.reason,
    file_name: file.name,
    byte_size: file.size,
    /* 다시 돌릴 때 같은 자리에서 시작하려면 크롭이 남아 있어야 한다 */
    crop,
    /* 검수 화면이 원본을 반투명으로 깔려면 그림이 남아 있어야 한다 */
    image_url: imageUrl,
    status: "queued" as const,
  };

  /*
   * 잡을 남긴다.
   *
   * Supabase 가 연결돼 있지 않은 로컬·데모 모드에서도 분류 자체는 되어야 하므로,
   * 저장에 실패해도 400 을 던지지 않고 저장 여부를 함께 알려 준다 — 조용히 성공한
   * 척하면 나중에 잡을 못 찾는 이유를 알 수 없다.
   */
  let persisted = false;
  let persistError: string | null = null;

  const admin = createAdminSupabase();
  if (admin) {
    const { error } = await admin.from("plan_ingest_jobs").insert(job);
    if (error) persistError = error.message;
    else persisted = true;
  } else {
    persistError = "Supabase 가 연결돼 있지 않습니다.";
  }

  console.info(
    `[ingest] ${file.name} (${file.size}B) → ${verdict.route} · ${verdict.reason}` +
      (persisted ? "" : ` · 저장 안 됨: ${persistError}`)
  );

  const summary = {
    id: job.id,
    route: job.route,
    format: job.format,
    reason: job.reason,
    fileName: job.file_name,
    byteSize: job.byte_size,
  };

  /*
   * 파싱은 Python 마이크로서비스가 맡는다 — ezdxf·shapely·opencv 가 전부 Python
   * 생태계다. 기하는 거기서만 만들어진다.
   *
   * PDF 는 아직이다. 벡터 PDF 를 DXF 로 옮기는 일이 남았다.
   */
  if (verdict.route === "cad-pdf") {
    await mark(admin, job.id, { status: "failed", error: `${PHASE[verdict.route]} 미구현` });
    return Response.json(
      { job: { ...summary, status: "failed" }, persisted, ...(persistError ? { persistError } : {}),
        message: `${PHASE[verdict.route]} 는 아직 만들지 않았습니다.` },
      { status: 501 }
    );
  }

  await mark(admin, job.id, { status: "processing" });

  const parsed =
    verdict.route === "cad"
      ? await parseCadFile({
          name: file.name,
          bytes,
          format: verdict.format === "dwg" ? "dwg" : "dxf",
        })
      : await parseRasterFile({ name: file.name, bytes }, crop);

  if (!parsed.ok) {
    await mark(admin, job.id, { status: "failed", error: parsed.failure.message });

    /* 501 은 "이 서버가 아직 못 한다", 나머지는 파일 문제다 */
    const status = parsed.failure.kind === "unsupported" ? 501 : 422;
    return Response.json(
      { job: { ...summary, status: "failed" }, error: parsed.failure.message },
      { status }
    );
  }

  const doc = parsed.doc;

  /*
   * 여기서 프로젝트에 얹지 않는다.
   *
   * 예전에는 읽자마자 Scene 으로 옮겨 편집기에 띄웠다. 그러면 틀리게 읽힌 도면이
   * 그대로 3D 로 서고, 사용자는 그것이 자기 도면인 줄 안다. 사람이 검수 화면에서
   * 확인을 눌러야 넘어간다.
   */
  await mark(admin, job.id, { status: "done", doc });

  console.info(
    `[ingest] ${job.id} — 실 ${doc.rooms.length}개, 벽 ${doc.walls.length}개, ` +
      `개구부 ${doc.openings.length}개, 설비 ${doc.fixtures.length}개, ` +
      `지적 ${doc.review.flags.length}건`
  );

  return Response.json({
    job: { ...summary, status: "done" },
    persisted,
    ...(persistError ? { persistError } : {}),
    /* 다음은 검수다. 확인을 눌러야 편집기로 넘어간다 */
    reviewUrl: `/plan/${job.id}/review`,
    doc,
  });
}

/** 잡 상태를 갱신한다. 저장이 안 되는 환경에서는 조용히 넘어간다 */
async function mark(
  admin: ReturnType<typeof createAdminSupabase>,
  id: string,
  patch: { status: string; error?: string; doc?: FloorPlanDoc }
): Promise<void> {
  if (!admin) return;

  const { error } = await admin
    .from("plan_ingest_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) console.warn(`[ingest] 잡 상태를 못 남겼습니다: ${error.message}`);
}
