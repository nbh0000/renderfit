import Link from "next/link";
import type { ReactNode } from "react";

/**
 * 약관·정책 문서의 공통 틀.
 *
 * 세 문서(이용약관·개인정보처리방침·환불정책)가 같은 모양이어야 읽는 사람이 어디를
 * 보고 있는지 헷갈리지 않고, 결제대행사 심사에서도 서로를 오가며 확인한다.
 */
export function LegalLayout({
  title,
  updatedAt,
  children,
}: {
  title: string;
  /** 시행일 — 약관은 언제부터 적용되는지 반드시 밝혀야 한다 */
  updatedAt: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-[760px] px-5 py-12 sm:px-8">
      <Link href="/" className="text-[12px] text-muted hover:text-ink">
        ← 렌더핏
      </Link>

      <h1 className="mt-4 text-[24px] font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-[12.5px] text-muted">시행일 {updatedAt}</p>

      <div className="mt-8 space-y-7 text-[13.5px] leading-relaxed text-ink-soft">{children}</div>

      <nav className="mt-12 flex gap-4 border-t border-line pt-5 text-[12px] text-muted">
        <Link href="/legal/terms" className="hover:text-ink">
          이용약관
        </Link>
        <Link href="/legal/privacy" className="hover:text-ink">
          개인정보처리방침
        </Link>
        <Link href="/legal/refund" className="hover:text-ink">
          환불정책
        </Link>
      </nav>
    </main>
  );
}

/** 조항 하나 */
export function Article({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}
