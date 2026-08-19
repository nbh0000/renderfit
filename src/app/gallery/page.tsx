import type { Metadata } from "next";
import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { listPublicResults, memoryListGallery, type GalleryItem } from "@/lib/gallery";
import { BRAND } from "@/config/brand";
import { getViewer } from "@/lib/auth";

export const metadata: Metadata = {
  title: "인테리어 시안 갤러리",
  description:
    "실제 공간 사진과 도면으로 만든 방 종류별·스타일별 인테리어 시안을 모아 봅니다. 아파트 거실부터 상업공간까지.",
  openGraph: {
    title: `인테리어 시안 갤러리 | ${BRAND.name}`,
    description: "방 종류와 스타일별 인테리어 시안 모음",
    type: "website",
  },
};

export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  const viewer = await getViewer();
  let items: GalleryItem[] = [];

  if (isSupabaseConfigured()) {
    const supabase = await createServerSupabase();
    if (supabase) items = await listPublicResults(supabase);
  } else {
    items = memoryListGallery();
  }

  return (
    <div className="min-h-dvh">
      <AppHeader active="gallery" authed={Boolean(viewer.userId)} />

      <main className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
        <h1 className="serif-display text-[26px] leading-tight sm:text-[30px]">
          인테리어 시안 갤러리
        </h1>
        <p className="mt-2 max-w-lg text-[14px] leading-relaxed text-ink-soft">
          사용자가 공개에 동의한 시안만 모았습니다. 방 종류와 스타일로 살펴보세요.
        </p>

        {items.length === 0 ? (
          <div className="mt-8 flex min-h-[240px] flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface/60 px-6 text-center">
            <p className="text-[15px] font-semibold">아직 공개된 시안이 없습니다</p>
            <p className="mt-1.5 text-[13px] text-muted">
              스튜디오에서 만든 시안을 &lsquo;갤러리 공개&rsquo;로 올리면 이곳에 소개됩니다.
            </p>
            <Link
              href="/studio"
              className="mt-5 inline-flex h-10 items-center rounded-lg bg-accent px-4 text-[14px] font-medium text-white hover:bg-accent-hover"
            >
              시안 만들어 보기
            </Link>
          </div>
        ) : (
          <ul className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((item) => (
              <li key={item.slug}>
                <Link href={`/gallery/${encodeURIComponent(item.slug)}`} className="group block">
                  <span className="block overflow-hidden rounded-[var(--radius-card)] border border-line bg-sunken">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.imageUrl}
                      alt={item.title}
                      loading="lazy"
                      className="aspect-[4/3] w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                  </span>
                  <p className="mt-1.5 text-[13px] font-medium">{item.title}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
