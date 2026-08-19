import Link from "next/link";
import type { Metadata } from "next";
import { AppSidebar, MobileTopBar } from "@/components/AppSidebar";
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
 * 시작 화면.
 *
 * 왼쪽에 고정 내비게이션, 가운데에 챗 입력 하나. 설명은 늘어놓지 않는다.
 */
export default async function HomePage() {
  const viewer = await getViewer();
  const authed = Boolean(viewer.userId);

  return (
    <div className="flex h-dvh bg-canvas">
      <AppSidebar active="home" authed={authed} />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar authed={authed} />

        <main className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-10 sm:px-8">
          <div className="w-full max-w-[720px]">
            <StartChat />

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[12.5px] text-muted">
              <span>가입하면 3장을 무료로 만들어 볼 수 있습니다.</span>
              <Link href="/gallery" className="hover:text-ink">
                갤러리 보기
              </Link>
            </div>
          </div>
        </main>

        <footer className="shrink-0 border-t border-line px-4 py-3 text-center text-[11.5px] text-muted sm:px-8">
          생성물은 참고용 시안이며 시공용 도면이 아닙니다.
        </footer>
      </div>
    </div>
  );
}
