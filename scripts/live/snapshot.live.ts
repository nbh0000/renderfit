import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 지금 저장돼 있는 평면을 그림으로 떨어뜨린다.
 *
 * AI 를 부르지 않는다 — 저장된 Scene 을 읽어 그리기만 하므로 돈이 들지 않는다.
 * "지금 결과가 원본과 얼마나 다른가" 를 눈으로 대 보려고 쓴다.
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

describe("저장된 평면 스냅샷", () => {
  it("가장 최근 도면 프로젝트를 그린다", async () => {
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
    console.log(`\n■ ${row!.id} ${row!.name}  (${row!.updated_at})`);

    /* 원본 */
    const { getStorage } = await import("@/lib/storage");
    const source = (scene as unknown as { source: { imageUrl: string } }).source;
    const key = source.imageUrl.replace(/^\/api\/files\//, "");
    writeFileSync(path.join(OUT, "snap-original.png"), await getStorage().download(key));

    /* 우리 도면 — 사용자가 실제로 받는 그림이다 */
    const { buildPlanSvg, toPlanData } = await import("@/services/cadExport");
    const sharp = (await import("sharp")).default;
    const plan = await sharp(Buffer.from(buildPlanSvg(toPlanData(scene, row!.name as string))))
      .resize({ width: 1600 })
      .png()
      .toBuffer();
    writeFileSync(path.join(OUT, "snap-plan.png"), plan);

    writeFileSync(
      path.join(OUT, "snap-scene.json"),
      JSON.stringify({ id: row!.id, name: row!.name, scene }, null, 2)
    );
  });
});
