import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// 개인 작업 공간과 API 는 색인하지 않는다.
const PRIVATE_PATHS = ["/studio", "/projects", "/dashboard", "/editor", "/plan", "/library", "/admin", "/login", "/auth/", "/api/"];

/**
 * AI 검색·답변 엔진의 크롤러.
 *
 * 렌더핏은 AI 검색에서 인용되는 쪽이 이득이므로 공개 페이지(메인·갤러리·요금제)는
 * 이들에게도 열어 둔다. 기본 `*` 규칙으로도 열리지만, 일부 봇은 자기 이름으로 된
 * 규칙이 없으면 보수적으로 물러나므로 명시한다.
 */
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Google-Extended",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: PRIVATE_PATHS },
      { userAgent: AI_CRAWLERS, allow: "/", disallow: PRIVATE_PATHS },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
