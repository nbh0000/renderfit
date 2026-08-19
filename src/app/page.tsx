import Link from "next/link";
import type { Metadata } from "next";
import { AppHeader } from "@/components/AppHeader";
import { StartChat } from "@/components/StartChat";
import { BRAND } from "@/config/brand";
import { getViewer } from "@/lib/auth";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    title: `${BRAND.name} — ${BRAND.headline}`,
    description: BRAND.description,
    type: "website",
  },
};

/**
 * 메인 페이지.
 *
 * 설명·요금제·FAQ를 늘어놓지 않는다. 첫 화면의 역할은 하나 —
 * 시작 모달을 띄워 빠른 생성(/studio)으로 넘기는 것이다.
 * 자세한 내용은 각각 /pricing, /gallery 페이지가 담당한다.
 */
export default async function HomePage() {
  const viewer = await getViewer();

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader authed={Boolean(viewer.userId)} />

      <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6">
        <div className="flex w-full max-w-[680px] flex-col items-center text-center">
          <p className="text-[13px] tracking-tight text-muted">{BRAND.tagline}</p>

          <div className="mt-3 w-full">
            <StartChat />
          </div>

          <p className="mt-4 text-[12px] text-muted">
            가입하면 3장을 무료로 만들어 볼 수 있습니다.
          </p>

          <div className="mt-10 flex items-center justify-center gap-4 text-[13px] text-muted">
            <Link href="/gallery" className="hover:text-ink">
              갤러리
            </Link>
            <span aria-hidden className="text-line-strong">
              ·
            </span>
            <Link href="/pricing" className="hover:text-ink">
              요금제
            </Link>
            <span aria-hidden className="text-line-strong">
              ·
            </span>
            <Link href="/dashboard" className="hover:text-ink">
              스튜디오 (편집기)
            </Link>
          </div>
        </div>
      </main>

      <footer className="border-t border-line px-4 py-5 text-center text-[11.5px] text-muted sm:px-6">
        생성물은 참고용 시안이며 시공용 도면이 아닙니다.
      </footer>
    </div>
  );
}
