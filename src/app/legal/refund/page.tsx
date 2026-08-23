import type { Metadata } from "next";
import { Article, LegalLayout } from "@/components/legal/LegalLayout";
import { BUSINESS, businessRows } from "@/config/business";

export const metadata: Metadata = {
  title: "환불정책",
  description: "렌더핏 결제 취소 및 환불 정책",
};

const UPDATED_AT = "2026년 9월 1일";

export default function RefundPage() {
  return (
    <LegalLayout title="환불정책" updatedAt={UPDATED_AT}>
      <Article title="1. 기본 원칙">
        <p>
          {BUSINESS.service}의 유료 요금제는 월 단위 정기결제입니다. 환불은 전자상거래 등에서의
          소비자보호에 관한 법률과 콘텐츠산업 진흥법을 따릅니다.
        </p>
      </Article>

      <Article title="2. 크레딧을 쓰지 않은 경우 — 전액 환불">
        <p>
          결제 후 <strong>7일 이내</strong>이고 해당 결제 주기에 지급된 크레딧을{" "}
          <strong>한 번도 사용하지 않았다면</strong> 전액 환불합니다. 별도의 사유를 밝히지
          않아도 됩니다.
        </p>
      </Article>

      <Article title="3. 크레딧을 일부 쓴 경우">
        <p>
          결제 후 7일 이내라면, 지급된 크레딧 중 사용한 양에 해당하는 금액을 뺀 나머지를
          환불합니다. 계산은 다음과 같습니다.
        </p>
        <p className="rounded-[var(--radius-control)] border border-line bg-sunken px-3 py-2 font-mono text-[12px]">
          환불액 = 결제금액 × (남은 크레딧 ÷ 지급된 크레딧)
        </p>
        <p>
          7일이 지난 뒤에는 이미 지급된 그 달의 크레딧에 대해서는 환불하지 않습니다. 대신
          다음 결제일 전에 해지하면 그 이후로는 청구되지 않습니다.
        </p>
      </Article>

      <Article title="4. 자동 결제 해지">
        <p>
          요금제 화면에서 언제든 해지할 수 있습니다. 해지하면 다음 결제일부터 청구되지 않으며,
          이미 결제한 주기가 끝날 때까지는 남은 크레딧을 그대로 쓸 수 있습니다.
        </p>
      </Article>

      <Article title="5. 회사 사유로 인한 환불">
        <p>
          서비스 장애로 유료 기능을 상당 기간 이용하지 못했거나, AI 작업이 회사 측 사유로
          실패한 경우에는 기간에 해당하는 이용료를 환불하거나 이용 기간을 연장합니다. AI 작업이
          실패해 차감된 크레딧은 자동으로 복구되므로 별도 신청이 필요 없습니다.
        </p>
      </Article>

      <Article title="6. 환불하지 않는 경우">
        <ul className="ml-4 list-disc space-y-1">
          <li>지급된 크레딧을 모두 사용한 뒤 결과물이 마음에 들지 않는 경우</li>
          <li>
            생성물의 치수·재질이 실제와 다르다는 이유 — 생성물은 참고용 시안이며 정확성을
            보증하지 않는다는 점을 이용약관 제5조에서 미리 알리고 있습니다
          </li>
          <li>이용자가 약관을 위반해 이용이 제한된 경우</li>
        </ul>
      </Article>

      <Article title="7. 환불 신청 방법">
        <p>
          아래 이메일로 결제하신 계정과 결제일을 알려 주시면 접수 후 <strong>3영업일 이내</strong>
          에 처리합니다. 환불은 결제한 수단으로 돌려드리며, 카드 결제는 카드사 사정에 따라
          취소 반영까지 3~5영업일이 더 걸릴 수 있습니다.
        </p>
        <dl className="mt-3 grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
          {businessRows().map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-muted">{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </Article>
    </LegalLayout>
  );
}
