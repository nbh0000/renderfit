import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { bumpViewCount, getPublicResult, memoryGetGallery, type GalleryItem } from "@/lib/gallery";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { GalleryDeleteButton } from "@/components/gallery/GalleryDeleteButton";
import { LikeButton } from "@/components/gallery/LikeButton";
import { PromptDetails } from "@/components/PromptDetails";
import { extractUserRequest } from "@/lib/prompt";
import { ROOM_MAP } from "@/config/rooms";
import { STYLE_MAP } from "@/config/styles";
import { BRAND } from "@/config/brand";
import { getViewer } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function loadItem(slug: string, viewerId?: string | null): Promise<GalleryItem | null> {
  const decoded = decodeURIComponent(slug);
  if (isSupabaseConfigured()) {
    const supabase = await createServerSupabase();
    if (!supabase) return null;
    return getPublicResult(supabase, decoded, viewerId);
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
  const viewer = await getViewer();
  const item = await loadItem(slug, viewer.userId);
  if (!item) notFound();

  // 페이지를 연 만큼 조회수를 올린다. 실패해도 화면은 그대로 보여 준다.
  if (isSupabaseConfigured()) {
    const supabase = await createServerSupabase();
    if (supabase) await bumpViewCount(supabase, decodeURIComponent(slug));
  }

  const roomLabel = item.roomLabel || ROOM_MAP[item.roomId]?.label || "공간";
  const styleLabel = item.styleLabel || STYLE_MAP[item.styleId]?.label || "스타일";

  return (
    <AppShell active="gallery" authed={Boolean(viewer.userId)}>

      <main className="mx-auto max-w-[900px] px-4 py-8 sm:px-6">
        <Link href="/gallery" className="text-[12.5px] text-muted hover:text-ink">
          ← 갤러리
        </Link>

        <h1 className="serif-display mt-2 text-[24px] leading-tight sm:text-[28px]">
          {item.title}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
          <span>{roomLabel}</span>
          <span aria-hidden>·</span>
          <span>{styleLabel}</span>
          <span aria-hidden>·</span>
          <span className="text-ink-soft">{item.authorName}</span>
          <span aria-hidden>·</span>
          {/* 방금 올린 +1까지 포함해서 보여 준다 */}
          <span>조회 {(item.viewCount + 1).toLocaleString("ko-KR")}</span>
          <span aria-hidden>·</span>
          <span>{new Date(item.createdAt).toLocaleDateString("ko-KR")}</span>

          {item.canDelete && <GalleryDeleteButton slug={item.slug} />}
        </div>

        <div className="mt-4">
          <LikeButton slug={item.slug} likeCount={item.likeCount} liked={item.likedByViewer} />
        </div>

        <div className="mt-5 overflow-hidden rounded-[var(--radius-card)] border border-line bg-sunken">
          {item.beforeUrl ? (
            <BeforeAfterSlider
              beforeSrc={item.beforeUrl}
              afterSrc={item.imageUrl}
              beforeLabel="원본 사진"
              afterLabel="AI 시안"
              hint="좌우로 움직여 보세요"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt={item.title} className="w-full object-cover" />
          )}
        </div>

        {/* 어떤 지시로 만든 시안인지 — 갤러리를 보는 사람에게 가장 궁금한 정보다 */}
        <PromptDetails
          userRequest={extractUserRequest(item.prompt)}
          fullPrompt={item.prompt}
          className="mt-4"
        />

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
    </AppShell>
  );
}
