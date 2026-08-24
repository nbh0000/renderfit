/**
 * 확인용 빌드.
 *
 * next dev 가 도는 채로 npm run build 를 돌리면 둘이 같은 .next/ 를 쓴다. 빌드가 dev
 * 캐시를 덮어써서 개발 서버가 요청마다 다시 컴파일하게 되고, 페이지 이동이 2~4초씩
 * 걸린다 — 정적 파일조차 1초가 넘었다. 배포에는 영향이 없고 개발 중에만 생기는 일이라
 * 원인을 찾기도 어렵다.
 *
 * 그래서 확인은 이 명령으로 한다. 결과물을 .next-check/ 에 쌓아 개발 서버를 건드리지
 * 않는다. 배포용 빌드는 그대로 npm run build 다.
 */
import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_DIST_DIR: ".next-check" },
});

process.exit(result.status ?? 1);
