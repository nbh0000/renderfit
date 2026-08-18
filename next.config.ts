import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Supabase Storage 공개 버킷 (Phase 2에서 실제 호스트로 확정)
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

export default nextConfig;
