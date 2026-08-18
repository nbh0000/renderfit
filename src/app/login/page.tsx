import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { getViewer } from "@/lib/auth";
import { getPlan } from "@/config/plans";
import { BRAND } from "@/config/brand";

export const metadata: Metadata = {
  title: "로그인",
  description: "구글 계정으로 로그인합니다.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const viewer = await getViewer();

  if (viewer.userId) redirect(next ?? "/studio");

  const freeCredits = getPlan("free").monthlyCredits;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <Link href="/" className="serif-display text-[18px]">
        {BRAND.name}
      </Link>

      <h1 className="mt-8 text-[22px] font-semibold tracking-tight">
        가입하면 {freeCredits}장을 무료로 만들어 볼 수 있습니다
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
        구글 계정으로 3초 만에 시작하세요. 별도 가입 절차는 없습니다.
      </p>

      <div className="mt-7">
        {viewer.configured ? (
          <GoogleSignInButton next={next ?? "/studio"} />
        ) : (
          <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface p-4 text-[13px] leading-relaxed text-muted">
            Supabase 환경변수가 설정되지 않아 로그인을 사용할 수 없습니다.
            <br />
            <code className="text-[12px]">.env.local</code>에 <code className="text-[12px]">NEXT_PUBLIC_SUPABASE_URL</code>,{" "}
            <code className="text-[12px]">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>를 넣어 주세요.
            <br />
            <br />
            지금은 로그인 없이{" "}
            <Link href="/studio" className="text-accent hover:underline">
              스튜디오를 로컬 mock 모드로
            </Link>{" "}
            둘러볼 수 있습니다.
          </div>
        )}
      </div>

      {error && (
        <p className="mt-4 text-[13px] text-danger">
          로그인 처리 중 문제가 발생했습니다. 다시 시도해 주세요.
        </p>
      )}

      <p className="mt-8 text-[12px] leading-relaxed text-muted">
        생성된 이미지는 참고용 시안이며 실제 시공 도면이 아닙니다.
      </p>
    </main>
  );
}
