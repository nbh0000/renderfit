/**
 * 샘플 데이터 시드 스크립트.
 *
 *   npm run dev      (다른 터미널)
 *   npm run seed
 *
 * 개발 서버의 /api/demo/seed를 호출해 "Japandi Living Room" 데모 프로젝트를 만든다.
 * (에셋 20개 이상, 재질 17개, 스타일 9개는 코드 카탈로그로 항상 로드된다)
 */
const baseUrl = process.env.SEED_BASE_URL ?? "http://localhost:3000";

async function main() {
  const url = `${baseUrl.replace(/\/$/, "")}/api/demo/seed`;

  try {
    const response = await fetch(url, { method: "POST" });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status} ${text.slice(0, 200)}`);
    }
    const data = await response.json();
    console.log(`✔ 데모 프로젝트 생성: ${data.project.name} (${data.project.id})`);
    console.log(`  총 프로젝트 수: ${data.total}`);
    console.log(`  대시보드에서 확인: ${baseUrl}/dashboard`);
  } catch (error) {
    console.error("✘ 시드 실패:", error instanceof Error ? error.message : error);
    console.error("  개발 서버가 실행 중인지 확인하세요 (npm run dev).");
    console.error(`  다른 포트라면: SEED_BASE_URL=http://localhost:3111 npm run seed`);
    process.exitCode = 1;
  }
}

main();
