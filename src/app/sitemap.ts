import type { MetadataRoute } from "next";
import { createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { listPublicResults, memoryListGallery } from "@/lib/gallery";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// 공개 갤러리가 늘어나면 즉시 반영되도록 매 요청마다 생성한다.
export const dynamic = "force-dynamic";

/** 정적 페이지 + 공개된 갤러리 상세 페이지를 sitemap에 자동 반영한다. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/gallery`, changeFrequency: "daily", priority: 0.8 },
    { url: `${SITE_URL}/pricing`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${SITE_URL}/studio`, changeFrequency: "monthly", priority: 0.5 },
  ];

  let items: { slug: string; createdAt: string }[] = [];

  if (isSupabaseConfigured()) {
    const supabase = await createServerSupabase();
    if (supabase) items = await listPublicResults(supabase, { limit: 500 });
  } else {
    items = memoryListGallery();
  }

  return [
    ...staticRoutes,
    ...items.map((item) => ({
      url: `${SITE_URL}/gallery/${encodeURIComponent(item.slug)}`,
      lastModified: new Date(item.createdAt),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
