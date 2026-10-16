/**
 * 실제 Gemini 를 부르는 일회성 확인용 설정.
 *
 * 평소 시험(vitest.config.ts)에는 절대 섞지 않는다 — npm test 가 돌 때마다 돈이 나간다.
 * 그래서 include 를 이 폴더의 *.live.ts 로만 좁혀 두었고, vitest.config.ts 는
 * tests/ 만 본다. 사람이 일부러 이 설정을 짚어 줄 때만 돈이 나간다.
 *
 * 사용: npx vitest run --config scripts/live/config.ts
 *
 * 콘솔 출력을 반드시 보이게 한다 — 지난번에 vitest 가 console.log 를 삼켜서, 돈을
 * 쓰고 돌린 결과의 진단 로그를 한 줄도 못 건졌다.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/live/*.live.ts"],
    /* 돈을 쓰고 돌리는 것이니 무엇이 오갔는지 전부 보여야 한다 */
    disableConsoleIntercept: true,
    printConsoleTrace: false,
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
  resolve: {
    alias: [
      { find: /^@\/config\/(.*)$/, replacement: path.resolve(ROOT, "config/$1") },
      { find: /^@\/scene\/(.*)$/, replacement: path.resolve(ROOT, "scene/$1") },
      { find: /^@\/ai\/(.*)$/, replacement: path.resolve(ROOT, "ai/$1") },
      { find: /^@\/models\/(.*)$/, replacement: path.resolve(ROOT, "models/$1") },
      { find: /^@\/services\/(.*)$/, replacement: path.resolve(ROOT, "services/$1") },
      { find: /^@\/lib\/storage$/, replacement: path.resolve(ROOT, "lib/storage/index.ts") },
      { find: /^@\/lib\/queue$/, replacement: path.resolve(ROOT, "lib/queue/index.ts") },
      { find: /^@\/lib\/db$/, replacement: path.resolve(ROOT, "lib/db/index.ts") },
      { find: /^@\/(.*)$/, replacement: path.resolve(ROOT, "src/$1") },
    ],
  },
});
