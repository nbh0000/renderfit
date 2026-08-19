import Link from "next/link";
import type { Metadata } from "next";
import { BRAND } from "@/config/brand";
import { StartChat } from "@/components/StartChat";
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

/**
 * 배경 — 순검정 대신 짙은 차콜에 포인트 색을 아주 옅게 번지게 한다.
 * 색을 넓게 칠하지 않고 빛처럼만 얹어 첫인상만 만들고 물러난다.
 */
function GlowBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -top-56 left-1/2 h-[680px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(63,122,102,0.5),transparent)]" />
      <div className="absolute -bottom-56 left-[-140px] h-[480px] w-[720px] rounded-full bg-[radial-gradient(closest-side,rgba(150,160,150,0.14),transparent)]" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-white/10" />
    </div>
  );
}

/**
 * 시작 화면.
 *
 * 메인만 짙은 배경으로 간다 — 첫인상은 대비로 잡고, 실제 작업 화면(스튜디오·편집기)은
 * 시안 색이 정확히 보여야 하므로 밝은 배경을 유지한다.
 */
export default async function HomePage() {
  const viewer = await getViewer();
  const authed = Boolean(viewer.userId);

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-night text-white">
      <GlowBackdrop />

      <header className="relative z-10 flex h-16 shrink-0 items-center justify-between px-5 sm:px-8">
        <Link
          href="/"
          className="text-[15px] font-semibold tracking-[0.18em] text-white hover:opacity-70"
        >
          {BRAND.wordmark}
        </Link>

        <nav className="flex items-center gap-1">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="hidden rounded-md px-2.5 py-1.5 text-[12.5px] text-white/60 transition-colors hover:bg-white/10 hover:text-white sm:block"
            >
              {link.label}
            </Link>
          ))}

          {authed ? (
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="rounded-md px-2.5 py-1.5 text-[12.5px] text-white/60 hover:bg-white/10 hover:text-white"
              >
                로그아웃
              </button>
            </form>
          ) : (
            <Link
              href="/login"
              className="ml-1 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-white transition-colors hover:bg-accent-hover"
            >
              로그인
            </Link>
          )}
        </nav>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[720px]">
          <StartChat />

          <p className="mt-8 text-center text-[12.5px] text-white/40">
            가입하면 3장을 무료로 만들어 볼 수 있습니다.
          </p>
        </div>
      </main>

      <footer className="relative z-10 shrink-0 px-5 py-4 text-center text-[11.5px] text-white/30 sm:px-8">
        생성물은 참고용 시안이며 시공용 도면이 아닙니다.
      </footer>
    </div>
  );
}
