import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { getPublicResult, memoryGetGallery, type GalleryItem } from "@/lib/gallery";
import { ROOM_MAP } from "@/config/rooms";
import { STYLE_MAP } from "@/config/styles";
import { BRAND } from "@/config/brand";
import { getViewer } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function loadItem(slug: string): Promise<GalleryItem | null> {
  const decoded = decodeURIComponent(slug);
  if (isSupabaseConfigured()) {
    const supabase = await createServerSupabase();
    if (!supabase) return null;
    return getPublicResult(supabase, decoded);
  }
  return memoryGetGallery(decoded) ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const item = await loadItem(slug);
  if (!item) return { title: "찾을 수 없는 페이지" };

  const description = `${item.roomLabel || ROOM_MAP[item.roomId]?.label} 공간을 ${
    item.styleLabel || STYLE_MAP[item.styleId]?.label
  } 스타일로 만든 인테리어 시안입니다. 구조는 그대로 두고 가구와 마감만 바꿔 만든 참고용 이미지입니다.`;

  return {
    title: item.title,
    description,
    alternates: { canonical: `/gallery/${encodeURIComponent(item.slug)}` },
    openGraph: {
      title: `${item.title} | ${BRAND.name}`,
      description,
      type: "article",
      images: item.imageUrl.startsWith("http")
        ? [{ url: item.imageUrl, width: item.width, height: item.height, alt: item.title }]
        : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: item.title,
      description,
    },
  };
}

export default async function GalleryDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const item = await loadItem(slug);
  if (!item) notFound();

  const viewer = await getViewer();

  const roomLabel = item.roomLabel || ROOM_MAP[item.roomId]?.label || "공간";
  const styleLabel = item.styleLabel || STYLE_MAP[item.styleId]?.label || "스타일";

  return (
    <div className="min-h-dvh">
      <AppHeader active="gallery" authed={Boolean(viewer.userId)} />

      <main className="mx-auto max-w-[900px] px-4 py-8 sm:px-6">
        <Link href="/gallery" className="text-[12.5px] text-muted hover:text-ink">
          ← 갤러리
        </Link>

        <h1 className="serif-display mt-2 text-[24px] leading-tight sm:text-[28px]">
          {item.title}
        </h1>
        <p className="mt-1.5 text-[13px] text-muted">
          {roomLabel} · {styleLabel} · {new Date(item.createdAt).toLocaleDateString("ko-KR")}
        </p>

        <div className="mt-5 overflow-hidden rounded-[var(--radius-card)] border border-line bg-sunken">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.imageUrl} alt={item.title} className="w-full object-cover" />
        </div>

        <p className="mt-5 text-[14px] leading-relaxed text-ink-soft">
          {roomLabel} 공간을 {styleLabel} 스타일로 바꾼 시안입니다. 벽·창문·문의 위치와 카메라 앵글은
          원본 그대로 두고, 가구와 마감재만 새로 구성했습니다. 같은 방식으로 내 공간 사진이나 도면을
          올리면 몇 분 안에 시안을 받아볼 수 있습니다.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/studio"
            className="inline-flex h-11 items-center rounded-lg bg-accent px-5 text-[14px] font-medium text-white hover:bg-accent-hover"
          >
            내 사진으로 만들어 보기
          </Link>
          <Link
            href="/gallery"
            className="inline-flex h-11 items-center rounded-lg border border-line-strong px-5 text-[14px] hover:bg-sunken"
          >
            다른 시안 보기
          </Link>
        </div>

        <p className="mt-8 text-[12px] leading-relaxed text-muted">
          AI가 생성한 참고용 시안입니다. 실제 시공 도면이 아니며, 치수와 마감은 현장 실측을 따라야 합니다.
        </p>
      </main>
    </div>
  );
}
