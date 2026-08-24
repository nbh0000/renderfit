/**
 * 로컬을 프로덕션 모드로 다시 띄운다.
 *
 * next dev 는 요청마다 다시 컴파일해서 화면 하나 넘기는 데 1초가 넘는다. 프로덕션
 * 빌드는 같은 화면이 10~70배 빠르다(/gallery 1.15초 → 0.07초). 그래서 사람이 직접
 * 만져 볼 때는 이쪽으로 띄운다.
 *
 * 대신 핫 리로드가 없다. 코드를 고쳤으면 이 명령을 다시 돌려야 화면에 반영된다.
 *
 * 실행: npm run serve
 */
import { spawnSync, spawn } from "node:child_process";

const run = (command, args) =>
  spawnSync(command, args, { stdio: "inherit", shell: true }).status ?? 1;

console.log("빌드하는 중…");
if (run("npx", ["next", "build"]) !== 0) {
  console.error("\n빌드에 실패해 띄우지 않았습니다. 위 오류를 먼저 고쳐 주세요.");
  process.exit(1);
}

console.log("\nhttp://localhost:3000 으로 띄웁니다 (Ctrl+C로 종료)");
const child = spawn("npx", ["next", "start", "-p", "3000"], { stdio: "inherit", shell: true });
process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
