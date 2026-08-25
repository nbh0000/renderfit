/**
 * 우리가 넣은 갤러리 시드 시안을 지운다.
 *
 * 시드를 다시 만들 때 옛것을 남겨 두면 같은 방·같은 스타일이 두 벌씩 걸리고,
 * 주소에도 -2 가 붙는다. 사용자가 직접 올린 시안은 절대 건드리지 않는다 —
 * 익명이면서 차감 크레딧이 0인 것만 우리 것으로 본다.
 *
 * 사용: node scripts/gallery/prune.mjs <slug> [slug ...]
 */
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const file = path.join(ROOT, ".env.local");
if (existsSync(file)) {
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

for (const slug of process.argv.slice(2)) {
  const { data: row } = await db
    .from("generation_results")
    .select("id, job_id, storage_path, before_path, author_name, generation_jobs(source_path, credits_charged)")
    .eq("slug", slug)
    .maybeSingle();

  if (!row) {
    console.log(`  ${slug} — 없음`);
    continue;
  }
  if (row.author_name !== null || row.generation_jobs.credits_charged !== 0) {
    console.log(`  ${slug} — 사용자가 올린 시안이라 건너뜁니다`);
    continue;
  }

  await db.storage.from("results").remove([row.storage_path, row.before_path].filter(Boolean));
  if (row.generation_jobs.source_path) {
    await db.storage.from("sources").remove([row.generation_jobs.source_path]);
  }
  await db.from("generation_results").delete().eq("id", row.id);
  await db.from("generation_jobs").delete().eq("id", row.job_id);
  console.log(`  ${slug} — 지웠습니다`);
}
