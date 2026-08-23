import type { Metadata } from "next";
import { Article, LegalLayout } from "@/components/legal/LegalLayout";
import { BUSINESS, businessRows } from "@/config/business";

export const metadata: Metadata = {
  title: "개인정보처리방침",
  description: "렌더핏 개인정보처리방침",
};

const UPDATED_AT = "2026년 9월 1일";

export default function PrivacyPage() {
  return (
    <LegalLayout title="개인정보처리방침" updatedAt={UPDATED_AT}>
      <Article title="1. 수집하는 개인정보">
        <p>
          {BUSINESS.company || "회사"}는 {BUSINESS.service} 서비스 제공에 필요한 최소한의 정보만
          수집합니다.
        </p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <strong>계정</strong> — 구글 로그인으로 받는 이메일 주소, 이름, 프로필 이미지
          </li>
          <li>
            <strong>이용자가 올린 자료</strong> — 방 사진, 평면도 이미지
          </li>
          <li>
            <strong>서비스 이용 기록</strong> — 프로젝트·생성물·크레딧 사용 내역
          </li>
          <li>
            <strong>결제</strong> — 결제대행사가 처리하며 회사는 카드번호를 저장하지 않습니다.
            결제 식별자와 결제 내역만 보관합니다.
          </li>
        </ul>
      </Article>

      <Article title="2. 이용 목적">
        <p>
          회원 식별과 로그인 유지, 사진·도면 분석과 시안 생성, 프로젝트 저장과 불러오기,
          크레딧 차감과 복구, 결제와 환불 처리, 문의 응대에 사용합니다. 그 밖의 목적으로는
          쓰지 않으며, 목적이 바뀌면 미리 동의를 받습니다.
        </p>
      </Article>

      <Article title="3. 보유 기간">
        <ul className="ml-4 list-disc space-y-1">
          <li>계정 정보 — 회원 탈퇴 시 즉시 파기</li>
          <li>올린 사진·도면과 생성물 — 이용자가 삭제하거나 탈퇴할 때 파기</li>
          <li>결제·거래 기록 — 전자상거래법에 따라 5년</li>
          <li>소비자 불만·분쟁 처리 기록 — 전자상거래법에 따라 3년</li>
          <li>접속 기록 — 통신비밀보호법에 따라 3개월</li>
        </ul>
      </Article>

      <Article title="4. 제3자 제공과 처리 위탁">
        <p>
          회사는 개인정보를 제3자에게 판매하지 않습니다. 다만 서비스를 제공하기 위해 아래
          업체에 처리를 위탁합니다.
        </p>
        <ul className="ml-4 list-disc space-y-1">
          <li>
            <strong>Google (Gemini API)</strong> — 사진·도면 분석과 이미지 생성. 이용자가 올린
            이미지가 생성 요청과 함께 전송됩니다.
          </li>
          <li>
            <strong>Supabase</strong> — 계정·프로젝트·이미지 저장
          </li>
          <li>
            <strong>Railway</strong> — 서비스 서버 운영
          </li>
          <li>
            <strong>결제대행사</strong> — 결제 승인과 환불 처리
          </li>
        </ul>
        <p>
          위 업체 중 일부는 해외에 서버를 두고 있어 개인정보가 국외로 이전됩니다. 이전되는
          항목은 이용자가 올린 이미지와 계정 식별자이며, 이전 목적은 위에 적은 서비스 제공에
          한합니다. 동의를 거부할 수 있으나 그 경우 서비스 이용이 제한됩니다.
        </p>
      </Article>

      <Article title="5. 이용자의 권리">
        <p>
          이용자는 언제든 자신의 개인정보를 열람·정정·삭제하거나 처리 정지를 요구할 수 있고,
          회원 탈퇴로 동의를 철회할 수 있습니다. 요청은 아래 연락처로 하시면 지체 없이
          처리합니다.
        </p>
      </Article>

      <Article title="6. 파기 절차">
        <p>
          보유 기간이 지나거나 목적을 달성한 개인정보는 지체 없이 파기합니다. 전자적 파일은
          복구할 수 없는 방법으로 삭제하고, 출력물은 분쇄하거나 소각합니다.
        </p>
      </Article>

      <Article title="7. 안전성 확보 조치">
        <p>
          접근 권한을 최소한으로 두고, 전송 구간을 암호화하며, 이용자가 올린 원본 이미지는
          비공개 저장소에 두고 로그인한 본인에게만 서버를 거쳐 전달합니다. 갤러리에 공개하기로
          동의한 생성물만 외부에 노출됩니다.
        </p>
      </Article>

      <Article title="8. 쿠키">
        <p>
          로그인 상태를 유지하기 위해 필수 쿠키를 사용합니다. 광고·행태정보 수집 목적의 쿠키는
          사용하지 않습니다.
        </p>
      </Article>

      <Article title="9. 개인정보 보호책임자">
        <dl className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          {businessRows().map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted">{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3">
          개인정보 침해로 도움이 필요하면 개인정보침해신고센터(privacy.kisa.or.kr, 국번없이
          118) 또는 개인정보 분쟁조정위원회(kopico.go.kr, 1833-6972)에 문의할 수 있습니다.
        </p>
      </Article>

      <Article title="10. 방침의 변경">
        <p>
          이 방침을 변경할 때는 적용일과 변경 내용을 서비스 화면에 적용일 7일 전부터
          공지합니다.
        </p>
      </Article>
    </LegalLayout>
  );
}
