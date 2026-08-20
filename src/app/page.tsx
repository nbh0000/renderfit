import Link from "next/link";
import type { Metadata } from "next";
import { BRAND } from "@/config/brand";
import { STYLES } from "@/config/styles";
import { StartChat } from "@/components/StartChat";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { getViewer } from "@/lib/auth";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    title: `${BRAND.name} — ${BRAND.headline}`,
    description: BRAND.description,
    type: "website",
  },
};

/** 메인에서 바로 갈 수 있는 곳 — 링크는 최소한만 둔다 */
const LINKS = [
  { href: "/studio", label: "빠른 생성" },
  { href: "/dashboard", label: "스튜디오" },
  { href: "/gallery", label: "갤러리" },
  { href: "/pricing", label: "요금제" },
];

/** 첫 화면에 노출할 스타일 — 자주 찾는 순서 */
const FEATURED_STYLES = ["modern", "nordic", "minimal", "natural-wood", "hotel", "cafe"];

/**
 * 배경 — 흰 바탕 위에 회색 음영만 아주 옅게 깐다.
 *
 * 색을 쓰지 않고 명도 차이로만 깊이를 만든다. 인테리어 사진이 주인공이라
 * 배경이 색을 가지면 사진의 색이 흐려진다.
 */
function GlowBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -top-64 left-1/2 h-[720px] w-[1200px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(27,28,29,0.055),transparent)]" />
      <div className="absolute -bottom-56 left-[-160px] h-[480px] w-[760px] rounded-full bg-[radial-gradient(closest-side,rgba(27,28,29,0.035),transparent)]" />
    </div>
  );
}

/**
 * 시작 화면.
 *
 * 인테리어 서비스답게 결과물이 먼저 보이게 한다 — 원본/시안 비교, 스타일, 진행 단계.
 * 다만 첫 동작은 여전히 챗 하나다.
 */
export default async function HomePage() {
  const viewer = await getViewer();
  const authed = Boolean(viewer.userId);
  const styles = STYLES.filter((style) => FEATURED_STYLES.includes(style.id));

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-5 sm:px-8">
          <Link
            href="/"
            className="text-[15px] font-semibold tracking-[0.18em] text-ink hover:opacity-60"
          >
            {BRAND.wordmark}
          </Link>

          <nav className="flex items-center gap-1">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="hidden rounded-md px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:bg-sunken hover:text-ink sm:block"
              >
                {link.label}
              </Link>
            ))}

            {authed ? (
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="rounded-md px-2.5 py-1.5 text-[12.5px] text-muted hover:bg-sunken hover:text-ink"
                >
                  로그아웃
                </button>
              </form>
            ) : (
              <Link
                href="/login"
                className="ml-1 rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:opacity-85"
              >
                로그인
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* 히어로 — 왼쪽에 대화, 오른쪽에 결과물 */}
      <section className="relative overflow-hidden">
        <GlowBackdrop />

        <div className="relative z-10 mx-auto grid max-w-[1180px] items-center gap-10 px-5 py-14 sm:px-8 lg:grid-cols-[minmax(0,1fr)_440px] lg:gap-14 lg:py-20">
          <StartChat />

          <div className="space-y-3">
            <div className="overflow-hidden rounded-2xl border border-line bg-surface p-2 shadow-[0_18px_50px_rgba(27,28,29,0.08)]">
              <BeforeAfterSlider
                beforeSrc="/showcase/hero-before.jpg"
                afterSrc="/showcase/hero-after.jpg"
                beforeLabel="올린 사진"
                afterLabel="AI 시안"
                hint="스크롤해보세요"
                className="rounded-xl"
              />
            </div>
            <p className="text-center text-[11.5px] leading-relaxed text-muted">
              벽·창문·문의 위치와 카메라 앵글은 그대로 두고 가구와 마감만 바꿉니다.
            </p>
          </div>
        </div>
      </section>

      {/* 스타일 */}
      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[1180px] px-5 py-12 sm:px-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight">스타일을 고르면 됩니다</h2>
              <p className="mt-1 text-[13px] text-muted">
                16가지 중 하나를 고르면 한 번에 4장까지 만들어 비교합니다.
              </p>
            </div>
            <Link
              href="/studio"
              className="hidden shrink-0 text-[12.5px] text-muted hover:text-ink sm:block"
            >
              전체 보기 →
            </Link>
          </div>

          <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {styles.map((style) => (
              <li key={style.id}>
                <Link
                  href="/studio"
                  className="group block overflow-hidden rounded-xl border border-line bg-canvas transition-colors hover:border-line-strong"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={style.thumbnail}
                    alt={style.label}
                    className="aspect-[4/3] w-full object-cover transition-opacity group-hover:opacity-90"
                  />
                  <span className="block px-2.5 py-2 text-[12.5px] text-ink-soft group-hover:text-ink">
                    {style.label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 진행 단계 */}
      <section className="border-t border-line">
        <div className="mx-auto max-w-[1180px] px-5 py-12 sm:px-8">
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/studio"
              className="inline-flex h-11 items-center rounded-lg bg-ink px-5 text-[14px] font-medium text-white transition-opacity hover:opacity-85"
            >
              사진 올려서 시작하기
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex h-11 items-center rounded-lg border border-line-strong px-5 text-[14px] text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
            >
              실측 도면으로 작업하기
            </Link>
          </div>

          <p className="mt-4 text-center text-[12px] text-muted">
            가입하면 3장을 무료로 만들어 볼 수 있습니다.
          </p>
        </div>
      </section>

      <footer className="border-t border-line px-5 py-5 text-center text-[11.5px] text-muted sm:px-8">
        생성물은 참고용 시안이며 시공용 도면이 아닙니다.
      </footer>
    </div>
  );
}
