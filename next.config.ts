import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * 검증용 빌드는 다른 곳에 쌓는다.
   *
   * next dev 가 도는 채로 npm run build 를 돌리면 둘이 같은 .next/ 를 쓴다. 빌드가
   * dev 캐시를 덮어써서 개발 서버가 요청마다 다시 컴파일하게 되는데, 그러면 페이지
   * 이동이 2~4초씩 걸린다(정적 파일조차 1초가 넘었다). 배포에는 영향이 없고 개발
   * 중에만 생기는 일이라 원인을 찾기도 어렵다.
   *
   * 그래서 확인용 빌드는 NEXT_DIST_DIR 를 주어 따로 쌓게 한다 (npm run build:check).
   * Railway는 이 값을 주지 않으므로 평소대로 .next/ 를 쓴다.
   */
  distDir: process.env.NEXT_DIST_DIR ?? ".next",

  images: {
    remotePatterns: [
      // Supabase Storage 공개 버킷 (Phase 2에서 실제 호스트로 확정)
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

export default nextConfig;
