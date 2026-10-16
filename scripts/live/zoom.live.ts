import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 저장된 평면을 크게 떠서 눈으로 뜯어본다. AI 를 부르지 않는다.
 *
 * 도면은 축소해 보면 멀쩡해 보이고 확대하면 무너진 데가 드러난다 — 벽이 끊기거나,
 * 실 채움이 벽 밖으로 새거나, 글자가 겹친다. 작은 그림만 보고 고치면 그 셋을 놓친다.
 */

const ROOT = path.resolve(__dirname, "../..");
const OUT = process.env.LIVE_OUT ?? ROOT;

const envFile = path.join(ROOT, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

describe("도면 확대", () => {
  it("평면 부분만 크게 뜬다", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { data } = await db
      .from("design_projects")
      .select("id,name,scene,updated_at")
      .order("updated_at", { ascending: false })
      .limit(20);

    const row = (data ?? []).find(
      (item) => (item.scene as { source?: { kind?: string } })?.source?.kind === "floorplan"
    );
    expect(row).toBeTruthy();

    const scene = row!.scene as never;
    const { buildPlanSvg, toPlanData } = await import("@/services/cadExport");
    const svg = buildPlanSvg(toPlanData(scene, row!.name as string));

    const sharp = (await import("sharp")).default;
    const png = await sharp(Buffer.from(svg), { density: 400 })
      .resize(3200, undefined, { fit: "inside", background: "#ffffff" })
      .png()
      .toBuffer();

    const meta = await sharp(png).metadata();
    console.log(`\n${row!.id} — ${meta.width}×${meta.height}px`);

    /* 평면만 잘라 낸다 — 일람표·타이틀블록은 지금 볼 것이 아니다 */
    const cropHeight = Math.round((meta.height ?? 0) * 0.62);
    writeFileSync(
      path.join(OUT, "zoom-plan.png"),
      await sharp(png)
        .extract({ left: 0, top: 0, width: meta.width ?? 0, height: cropHeight })
        .png()
        .toBuffer()
    );
  });
});
