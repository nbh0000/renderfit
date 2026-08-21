import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
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
    <AppShell active="gallery" authed={Boolean(viewer.userId)}>

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
                  <span className="relative block overflow-hidden rounded-[var(--radius-card)] border border-line bg-sunken">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.imageUrl}
                      alt={item.title}
                      loading="lazy"
                      className="aspect-[4/3] w-full object-cover"
                    />

                    {/*
                      원본이 함께 공개된 항목은 마우스를 올리면 올린 사진으로 바뀐다.
                      목록에서도 무엇이 어떻게 달라졌는지 바로 가늠할 수 있다.
                    */}
                    {item.beforeUrl && (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.beforeUrl}
                          alt={`${item.title} 원본`}
                          loading="lazy"
                          className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                        />
                        <span className="absolute left-1.5 top-1.5 rounded bg-ink/70 px-1.5 py-0.5 text-[10px] text-white">
                          전 · 후
                        </span>
                      </>
                    )}
                  </span>
                  <p className="mt-1.5 text-[13px] font-medium">{item.title}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted">
                    <span className="truncate">{item.authorName}</span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0">조회 {item.viewCount.toLocaleString("ko-KR")}</span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  );
}
