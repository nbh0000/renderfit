import { BRAND } from "@/config/brand";
import { PLANS } from "@/config/plans";
import { STYLES } from "@/config/styles";
import { SERVICE_FAQ, PRICING_FAQ } from "@/config/faq";
import { SITE_URL } from "@/lib/seo";

/**
 * llms.txt — AI 검색·답변 엔진이 서비스를 요약할 때 먼저 읽는 문서.
 * (https://llmstxt.org 제안 형식)
 *
 * 화면 문구와 어긋나지 않게 config 에서 값을 뽑아 매 요청마다 만든다.
 */
export const dynamic = "force-static";

export function GET() {
  const won = (n: number) => (n === 0 ? "무료" : `월 ${n.toLocaleString("ko-KR")}원`);

  const lines = [
    `# ${BRAND.name} (${BRAND.wordmark})`,
    "",
    `> ${BRAND.description}`,
    "",
    `${BRAND.headline}. 벽·창문·문의 위치와 카메라 앵글은 그대로 두고 가구와 마감만 바꿉니다. ` +
      "평면도(이미지·DXF)를 올리면 벽·문·창을 mm 단위로 읽어 2D 도면과 3D 편집기로 넘기며, " +
      "자동으로 읽은 결과는 사람이 검수 화면에서 확인한 뒤에만 확정됩니다. 도면의 좌표는 " +
      "LLM 이 추측하지 않고 파서와 전용 벡터화 모델만 만듭니다.",
    "",
    "## 주요 페이지",
    "",
    `- [메인](${SITE_URL}/): 서비스 소개, 원본/시안 비교, 자주 묻는 질문`,
    `- [갤러리](${SITE_URL}/gallery): 공개된 방 종류별·스타일별 인테리어 시안`,
    `- [요금제](${SITE_URL}/pricing): 플랜별 크레딧·기능·정책`,
    `- [이용약관](${SITE_URL}/legal/terms)`,
    `- [개인정보처리방침](${SITE_URL}/legal/privacy)`,
    `- [환불정책](${SITE_URL}/legal/refund)`,
    "",
    "## 요금제",
    "",
    ...PLANS.map(
      (plan) =>
        `- ${plan.label} (${won(plan.priceMonthly)}, ${plan.grant === "signup" ? "가입 시" : "월"} ${plan.monthlyCredits}크레딧): ${plan.highlights.join(", ")}`
    ),
    "",
    "1장 생성에 1크레딧, 고해상도는 2크레딧. 크레딧은 매월 갱신되며 이월되지 않습니다.",
    "",
    "## 인테리어 스타일",
    "",
    STYLES.map((style) => style.label).join(", "),
    "",
    "## 자주 묻는 질문",
    "",
    ...[...SERVICE_FAQ, ...PRICING_FAQ].flatMap((item) => [`### ${item.q}`, "", item.a, ""]),
    "## 참고",
    "",
    "- 생성물은 참고용 시안이며 실제 시공 도면이 아닙니다. 시공 전에는 현장 실측으로 확인해야 합니다.",
    `- 사이트맵: ${SITE_URL}/sitemap.xml`,
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
