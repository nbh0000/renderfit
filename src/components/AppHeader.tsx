import Link from "next/link";
import { BRAND } from "@/config/brand";

interface Props {
  /** 우측에 추가로 붙일 요소 (크레딧 배지 등) */
  right?: React.ReactNode;
  active?: "dashboard" | "studio" | "projects" | "pricing" | "gallery";
}

const NAV = [
  { key: "dashboard", href: "/dashboard", label: "스튜디오 (편집기)" },
  { key: "studio", href: "/studio", label: "빠른 생성" },
  { key: "projects", href: "/projects", label: "폴더" },
  { key: "gallery", href: "/gallery", label: "갤러리" },
  { key: "pricing", href: "/pricing", label: "요금제" },
] as const;

export function AppHeader({ right, active }: Props) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="serif-display shrink-0 text-[17px]">
          {BRAND.name}
        </Link>
        <nav className="scrollbar-slim -mx-1 flex items-center gap-1 overflow-x-auto">
          {NAV.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={[
                "shrink-0 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                active === item.key ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink",
              ].join(" ")}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-2 text-[13px] text-ink-soft">
          {right}
        </div>
      </div>
    </header>
  );
}
