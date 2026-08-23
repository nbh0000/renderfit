import Link from "next/link";
import { BUSINESS, isBusinessRegistered } from "@/config/business";

/**
 * 사이트 공통 푸터.
 *
 * 한국에서 유료 서비스를 팔려면 상호·대표자·사업자등록번호·통신판매업 신고번호·주소·
 * 연락처를 화면에 표시해야 한다(전자상거래법 제10조). 약관·개인정보처리방침·환불정책
 * 링크도 함께 둔다 — 결제대행사 심사에서 이 셋을 먼저 확인한다.
 *
 * 사업자 정보를 아직 안 채웠으면 그 자리를 비우는 대신 지금이 준비 중이라는 것을
 * 개발자가 알아볼 수 있게 남긴다. 빈 채로 결제를 열면 안 된다.
 */
export function SiteFooter() {
  const registered = isBusinessRegistered();

  return (
    <footer className="border-t border-line px-5 py-8 text-[11.5px] leading-relaxed text-muted sm:px-8">
      <div className="mx-auto flex max-w-[1180px] flex-col gap-4">
        <nav className="flex flex-wrap gap-x-4 gap-y-1.5">
          <Link href="/legal/terms" className="hover:text-ink">
            이용약관
          </Link>
          <Link href="/legal/privacy" className="font-medium text-ink-soft hover:text-ink">
            개인정보처리방침
          </Link>
          <Link href="/legal/refund" className="hover:text-ink">
            환불정책
          </Link>
          <Link href="/pricing" className="hover:text-ink">
            요금제
          </Link>
        </nav>

        {registered ? (
          <div className="space-y-0.5">
            <p>
              {BUSINESS.company} · 대표 {BUSINESS.owner} · 사업자등록번호{" "}
              {BUSINESS.registrationNumber}
            </p>
            <p>
              통신판매업 신고 {BUSINESS.mailOrderNumber} · {BUSINESS.address}
            </p>
            <p>
              문의 {BUSINESS.email}
              {BUSINESS.phone ? ` · ${BUSINESS.phone}` : ""}
            </p>
          </div>
        ) : (
          <p>사업자 정보 준비 중입니다. 유료 결제는 아직 열려 있지 않습니다.</p>
        )}

        <p>생성물은 참고용 시안이며 시공용 도면이 아닙니다. 실제 시공 전 현장 실측이 필요합니다.</p>
      </div>
    </footer>
  );
}
