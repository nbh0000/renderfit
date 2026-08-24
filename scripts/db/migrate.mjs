/**
 * supabase/*.sql 을 실제 DB에 돌린다.
 *
 * Supabase 대시보드의 SQL Editor에 붙여넣는 것과 같은 일을 명령 한 줄로 한다.
 * 마이그레이션이 여러 개가 되면 어느 것을 돌렸는지 헷갈리는데, 여기서는 파일을
 * 지정해 돌리고 결과를 그대로 찍어 준다.
 *
 * 접속 문자열은 .env.local 의 SUPABASE_DB_URL 에서 읽는다.
 * Supabase → Project Settings → Database → Connection string → URI 를 그대로 넣으면 된다.
 *
 * 실행:
 *   node scripts/db/migrate.mjs supabase/migrations-billing.sql
 *   node scripts/db/migrate.mjs supabase/migrations-billing.sql supabase/migrations-admin.sql
 *   node scripts/db/migrate.mjs --check          (접속만 확인)
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** .env.local 에서 값을 읽는다 (Next 없이 단독 실행하므로) */
async function readEnv(name) {
  if (process.env[name]) return process.env[name];

  try {
    const text = await fs.readFile(path.join(ROOT, ".env.local"), "utf8");
    const line = text.split(/\r?\n/).find((row) => row.startsWith(`${name}=`));
    return line?.slice(name.length + 1).trim() ?? "";
  } catch {
    return "";
  }
}

const url = await readEnv("SUPABASE_DB_URL");

if (!url) {
  console.error(
    [
      "SUPABASE_DB_URL 이 없습니다.",
      "",
      "Supabase → Project Settings → Database → Connection string → URI 를 복사해",
      ".env.local 에 아래처럼 한 줄 넣어 주세요.",
      "",
      "  SUPABASE_DB_URL=postgresql://postgres.xxxx:비밀번호@aws-0-...pooler.supabase.com:5432/postgres",
      "",
      "이 값은 .env.local 에만 있고 커밋되지 않습니다.",
    ].join("\n")
  );
  process.exit(1);
}

const files = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const checkOnly = process.argv.includes("--check");

const client = new pg.Client({
  connectionString: url,
  // Supabase는 인증서 체인이 자체 서명이라 검증을 끄고 붙는다 (연결 자체는 TLS다)
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const { rows } = await client.query("select current_database() as db, version() as version");
  console.log(`붙었습니다 — ${rows[0].db} (${rows[0].version.split(",")[0]})`);

  if (checkOnly || files.length === 0) {
    if (!checkOnly) console.log("\n돌릴 파일을 지정해 주세요. 예: node scripts/db/migrate.mjs supabase/migrations-admin.sql");
    process.exit(0);
  }

  for (const file of files) {
    const sql = await fs.readFile(path.join(ROOT, file), "utf8");
    process.stdout.write(`\n▶ ${file} … `);

    /*
     * 한 파일을 한 트랜잭션으로 돌린다.
     * 중간에 실패하면 통째로 되돌려야 한다 — 반쯤 만들어진 스키마가 가장 고치기 어렵다.
     */
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("commit");
      console.log("완료");
    } catch (error) {
      await client.query("rollback");
      console.log("실패 (되돌렸습니다)");
      console.error(`  ${error.message}`);
      process.exitCode = 1;
      break;
    }
  }

  /* 무엇이 생겼는지 눈으로 확인한다 */
  const { rows: tables } = await client.query(
    `select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('subscriptions','payments','incidents','events')
      order by table_name`
  );
  console.log(`\n확인된 테이블: ${tables.map((row) => row.table_name).join(", ") || "(없음)"}`);
} catch (error) {
  console.error("붙지 못했습니다:", error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
