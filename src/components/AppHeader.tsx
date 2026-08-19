import Link from "next/link";
import { BRAND } from "@/config/brand";

interface Props {
  /** 우측에 추가로 붙일 요소 (크레딧 배지 등) */
  right?: React.ReactNode;
  active?: "dashboard" | "studio" | "projects" | "pricing" | "gallery";
  /**
   * 로그인 여부. false면 우측에 로그인 링크를 띄운다.
   * 계정 UI를 직접 넘기는 화면(스튜디오 등)은 생략한다.
   */
  authed?: boolean;
}

/**
 * 로고와 메뉴가 같은 크기·같은 색으로 붙어 있으면 어디까지가 이름인지 읽히지 않는다.
 * 로고(세리프 + 마크) → 구분선 → 메뉴(작은 산세리프) 순으로 위계를 준다.
 */
const NAV = [
  { key: "studio", href: "/studio", label: "빠른 생성" },
  { key: "projects", href: "/projects", label: "폴더" },
  { key: "gallery", href: "/gallery", label: "갤러리" },
] as const;

/** 작업 메뉴가 아닌 항목은 우측 끝에 따로 모은다 */
const EDITOR = { key: "dashboard", href: "/dashboard", label: "스튜디오" } as const;
const PRICING = { key: "pricing", href: "/pricing", label: "요금제" } as const;

export function AppHeader({ right, active, authed }: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center px-4 sm:px-6">
        {/* 로고 — 마크 없이 영문 워드마크만 쓴다 */}
        <Link
          href="/"
          className="shrink-0 text-[17px] font-semibold leading-none tracking-[0.16em] text-ink transition-opacity hover:opacity-70"
          aria-label={BRAND.wordmark}
        >
          {BRAND.wordmark}
        </Link>

        {/* 구분선 */}
        <span aria-hidden className="mx-4 hidden h-5 w-px shrink-0 bg-line-strong sm:block" />

        <nav className="scrollbar-slim -mx-1 flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {NAV.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active === item.key ? "page" : undefined}
              className={[
                "shrink-0 rounded-md px-2.5 py-1.5 text-[12.5px] tracking-tight transition-colors",
                active === item.key
                  ? "bg-sunken font-medium text-ink"
                  : "text-ink-soft hover:bg-sunken/70 hover:text-ink",
              ].join(" ")}
            >
              {item.label}
            </Link>
          ))}

          {/* 좁은 화면에서는 우측 묶음을 감추므로 메뉴 끝에 넣어 준다 */}
          {[EDITOR, PRICING].map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active === item.key ? "page" : undefined}
              className={[
                "shrink-0 rounded-md px-2.5 py-1.5 text-[12.5px] tracking-tight transition-colors sm:hidden",
                active === item.key
                  ? "bg-sunken font-medium text-ink"
                  : "text-ink-soft hover:text-ink",
              ].join(" ")}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* 우측 끝: 편집기 · 요금제 · 계정 */}
        <div className="ml-auto flex shrink-0 items-center gap-1.5 pl-3 text-[13px] text-ink-soft">
          <Link
            href={EDITOR.href}
            aria-current={active === EDITOR.key ? "page" : undefined}
            className={[
              "hidden shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] tracking-tight transition-colors sm:inline-flex",
              active === EDITOR.key
                ? "border-line-strong bg-sunken font-medium text-ink"
                : "border-line text-ink-soft hover:border-line-strong hover:text-ink",
            ].join(" ")}
          >
            <span aria-hidden className="text-[13px] leading-none">
              ▦
            </span>
            {EDITOR.label}
          </Link>

          <Link
            href={PRICING.href}
            aria-current={active === PRICING.key ? "page" : undefined}
            className={[
              "hidden shrink-0 rounded-md px-2.5 py-1.5 text-[12.5px] tracking-tight transition-colors sm:block",
              active === PRICING.key
                ? "bg-sunken font-medium text-ink"
                : "text-ink-soft hover:bg-sunken/70 hover:text-ink",
            ].join(" ")}
          >
            {PRICING.label}
          </Link>

          {authed === false && (
            <Link
              href="/login"
              className="shrink-0 rounded-md bg-ink px-3 py-1.5 text-[12.5px] font-medium tracking-tight text-canvas transition-opacity hover:opacity-90"
            >
              로그인
            </Link>
          )}

          {/* 계정 UI를 직접 넘긴 화면(스튜디오 등)은 그쪽 로그아웃을 쓴다 */}
          {authed === true && !right && (
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="shrink-0 rounded-md px-2.5 py-1.5 text-[12.5px] tracking-tight text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
              >
                로그아웃
              </button>
            </form>
          )}

          {right}
        </div>
      </div>
    </header>
  );
}
