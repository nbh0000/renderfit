/**
 * 사업자 정보.
 *
 * 한국에서 유료 서비스를 팔려면 전자상거래법에 따라 아래 항목을 화면에 표시해야 한다
 * (상호·대표자·사업자등록번호·통신판매업 신고번호·주소·연락처). 표시하지 않으면
 * 과태료 대상이고, 결제대행사(토스페이먼츠 등) 심사도 통과하지 못한다.
 *
 * ★ 출시 전에 아래 값을 실제 정보로 채워야 한다. 비워 두면 약관·정책 페이지에
 *   "준비 중"으로 표시되고, 결제 버튼은 막힌다.
 */
export const BUSINESS = {
  /** 서비스명 */
  service: "렌더핏",
  /** 상호 (법인명 또는 개인사업자 상호) */
  company: "",
  /** 대표자 성명 */
  owner: "",
  /** 사업자등록번호 (예: 123-45-67890) */
  registrationNumber: "",
  /** 통신판매업 신고번호 (예: 2026-서울강남-01234) */
  mailOrderNumber: "",
  /** 사업장 주소 */
  address: "",
  /** 고객 문의 전화 */
  phone: "",
  /** 고객 문의 이메일 */
  email: "",
  /** 개인정보 보호책임자 */
  privacyOfficer: "",
} as const;

/** 사업자 정보가 다 채워졌는가 — 유료 결제를 열기 전 조건이다 */
export function isBusinessRegistered(): boolean {
  return Boolean(
    BUSINESS.company &&
      BUSINESS.owner &&
      BUSINESS.registrationNumber &&
      BUSINESS.mailOrderNumber &&
      BUSINESS.address &&
      BUSINESS.email
  );
}

/** 화면에 뿌릴 항목 목록 (빈 값은 "준비 중"으로) */
export function businessRows(): { label: string; value: string }[] {
  const show = (value: string) => value || "준비 중";

  return [
    { label: "상호", value: show(BUSINESS.company) },
    { label: "대표자", value: show(BUSINESS.owner) },
    { label: "사업자등록번호", value: show(BUSINESS.registrationNumber) },
    { label: "통신판매업 신고번호", value: show(BUSINESS.mailOrderNumber) },
    { label: "주소", value: show(BUSINESS.address) },
    { label: "전화", value: show(BUSINESS.phone) },
    { label: "이메일", value: show(BUSINESS.email) },
    { label: "개인정보 보호책임자", value: show(BUSINESS.privacyOfficer) },
  ];
}
