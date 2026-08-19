import Link from "next/link";
import { BRAND } from "@/config/brand";

/**
 * 좌측 내비게이션.
 *
 * 상단 가로 메뉴 대신 왼쪽 고정 사이드바를 쓴다 — 작업 화면(스튜디오·편집기)으로
 * 오가는 동선이 짧아지고, 본문은 가운데에 넓게 남는다.
 */

export type SidebarKey = "home" | "studio" | "projects" | "gallery" | "pricing" | "editor";

const SECTIONS: { title?: string; items: { key: SidebarKey; href: string; label: string }[] }[] = [
  {
    items: [
      { key: "home", href: "/", label: "시작하기" },
      { key: "studio", href: "/studio", label: "빠른 생성" },
    ],
  },
  {
    title: "작업",
    items: [
      { key: "editor", href: "/dashboard", label: "스튜디오 (편집기)" },
      { key: "projects", href: "/projects", label: "내 폴더" },
    ],
  },
  {
    title: "둘러보기",
    items: [
      { key: "gallery", href: "/gallery", label: "갤러리" },
      { key: "pricing", href: "/pricing", label: "요금제" },
    ],
  },
];

export function AppSidebar({ active, authed }: { active?: SidebarKey; authed?: boolean }) {
  return (
    <aside className="hidden w-[232px] shrink-0 flex-col border-r border-line bg-sunken/60 md:flex">
      <div className="px-4 py-4">
        <Link
          href="/"
          className="text-[15px] font-semibold tracking-[0.16em] text-ink hover:opacity-70"
        >
          {BRAND.wordmark}
        </Link>
      </div>

      <nav className="scrollbar-slim min-h-0 flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        {SECTIONS.map((section, index) => (
          <div key={section.title ?? index}>
            {section.title && (
              <p className="px-2 pb-1 text-[11px] font-medium tracking-tight text-muted">
                {section.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    aria-current={active === item.key ? "page" : undefined}
                    className={[
                      "block rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
                      active === item.key
                        ? "bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                        : "text-ink-soft hover:bg-surface/70 hover:text-ink",
                    ].join(" ")}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-line p-2">
        {authed ? (
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-muted hover:bg-surface hover:text-ink"
            >
              로그아웃
            </button>
          </form>
        ) : (
          <Link
            href="/login"
            className="block rounded-lg bg-accent px-2.5 py-2 text-center text-[12.5px] font-medium text-white hover:bg-accent-hover"
          >
            로그인
          </Link>
        )}
      </div>
    </aside>
  );
}

/** 모바일에서는 사이드바 대신 상단에 최소한의 이동 수단을 둔다 */
export function MobileTopBar({ authed }: { authed?: boolean }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4 md:hidden">
      <Link href="/" className="text-[14px] font-semibold tracking-[0.16em] text-ink">
        {BRAND.wordmark}
      </Link>
      <nav className="scrollbar-slim -mx-1 flex flex-1 items-center gap-1 overflow-x-auto">
        {SECTIONS.flatMap((section) => section.items).map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="shrink-0 rounded-md px-2 py-1 text-[12.5px] text-ink-soft hover:bg-sunken"
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {!authed && (
        <Link href="/login" className="shrink-0 text-[12.5px] font-medium text-ink">
          로그인
        </Link>
      )}
    </div>
  );
}
