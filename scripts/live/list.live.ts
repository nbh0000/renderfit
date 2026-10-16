import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "vitest";

/** 저장된 프로젝트 목록 — AI 를 부르지 않는다 */

const ROOT = path.resolve(__dirname, "../..");
const envFile = path.join(ROOT, ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

describe("프로젝트 목록", () => {
  it("최근 것부터 훑는다", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );

    const { data } = await db
      .from("design_projects")
      .select("id,name,status,scene,updated_at")
      .order("updated_at", { ascending: false })
      .limit(12);

    for (const row of data ?? []) {
      const scene = row.scene as {
        source?: { kind?: string; imageUrl?: string; width?: number; height?: number };
        room?: { dimensions?: Record<string, number>; walls?: unknown[]; areas?: { name: string }[] };
        objects?: unknown[];
      };

      console.log(
        [
          row.id.padEnd(13),
          String(row.status).padEnd(9),
          (scene.source?.kind ?? "-").padEnd(10),
          `${scene.source?.width ?? 0}x${scene.source?.height ?? 0}px`.padEnd(12),
          `${scene.room?.dimensions?.width ?? 0}x${scene.room?.dimensions?.length ?? 0}mm`.padEnd(16),
          `벽${(scene.room?.walls ?? []).length}`.padEnd(6),
          `실${(scene.room?.areas ?? []).length}`.padEnd(5),
          `물건${(scene.objects ?? []).length}`.padEnd(7),
          row.updated_at?.slice(5, 16),
          (scene.room?.areas ?? []).map((area) => area.name).join(","),
        ].join(" ")
      );
    }
  });
});
