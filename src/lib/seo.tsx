/**
 * 검색엔진·AI 검색(ChatGPT, Perplexity, Google AI Overview 등)이 서비스를 정확히
 * 이해하고 인용할 수 있게 하는 구조화 데이터(JSON-LD) 도구.
 *
 * 화면에 보이는 문구와 여기 적는 내용이 어긋나면 검색엔진이 스팸으로 보므로,
 * 값은 전부 config/brand.ts·config/plans.ts 같은 원본에서 가져온다.
 */
import { BRAND } from "@/config/brand";
import { BUSINESS } from "@/config/business";
import { PLANS } from "@/config/plans";

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

/** 대표 이미지 — OG·JSON-LD 공통 */
export const OG_IMAGE = { url: "/showcase/hero-after.jpg", width: 1600, height: 1067 } as const;

export function absoluteUrl(path: string): string {
  return path.startsWith("http") ? path : `${SITE_URL}${path}`;
}

export interface FaqItem {
  q: string;
  a: string;
}

/* ── 스키마 조각 ── */

export function organizationLd() {
  return {
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: BRAND.name,
    alternateName: BRAND.wordmark,
    url: SITE_URL,
    logo: absoluteUrl(OG_IMAGE.url),
    description: BRAND.description,
    ...(BUSINESS.email ? { email: BUSINESS.email } : {}),
    ...(BUSINESS.phone ? { telephone: BUSINESS.phone } : {}),
  };
}

export function webSiteLd() {
  return {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: BRAND.name,
    alternateName: BRAND.fullName,
    url: SITE_URL,
    inLanguage: "ko-KR",
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

/** 서비스 자체 — 무엇을 하는 도구인지, 요금이 얼마부터인지 */
export function softwareApplicationLd() {
  const priced = PLANS.map((plan) => plan.priceMonthly);
  return {
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#app`,
    name: BRAND.name,
    alternateName: BRAND.wordmark,
    applicationCategory: "DesignApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    image: absoluteUrl(OG_IMAGE.url),
    description: BRAND.description,
    inLanguage: "ko-KR",
    featureList: [
      "사진 한 장으로 구조를 유지한 인테리어 스타일 시안 생성",
      "평면도(DXF·이미지) 들여오기와 검수",
      "2D 도면·3D 편집기에서 가구 배치 편집",
      "포토리얼 렌더 생성",
      "16가지 인테리어 스타일 선택",
    ],
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "KRW",
      lowPrice: Math.min(...priced),
      highPrice: Math.max(...priced),
      offerCount: PLANS.length,
    },
    publisher: { "@id": `${SITE_URL}/#organization` },
  };
}

/** 요금제 하나하나를 Offer 로 — 요금 페이지에 붙인다 */
export function pricingOffersLd() {
  return PLANS.map((plan) => ({
    "@type": "Offer",
    "@id": `${SITE_URL}/pricing#${plan.id}`,
    name: `${BRAND.name} ${plan.label}`,
    description: plan.highlights.join(", "),
    price: plan.priceMonthly,
    priceCurrency: "KRW",
    url: `${SITE_URL}/pricing`,
    availability: "https://schema.org/InStock",
    itemOffered: { "@id": `${SITE_URL}/#app` },
    ...(plan.priceMonthly > 0
      ? {
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: plan.priceMonthly,
            priceCurrency: "KRW",
            billingDuration: "P1M",
            unitText: "월",
          },
        }
      : {}),
  }));
}

export function faqPageLd(items: FaqItem[]) {
  return {
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export function breadcrumbLd(trail: { name: string; path: string }[]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  };
}

/** 갤러리 시안 한 장 */
export function galleryImageLd(item: {
  slug: string;
  title: string;
  description: string;
  imageUrl: string;
  width?: number;
  height?: number;
  authorName: string;
  createdAt: string;
  roomLabel: string;
  styleLabel: string;
}) {
  const url = `${SITE_URL}/gallery/${encodeURIComponent(item.slug)}`;
  return {
    "@type": "ImageObject",
    "@id": `${url}#image`,
    name: item.title,
    description: item.description,
    contentUrl: absoluteUrl(item.imageUrl),
    url,
    ...(item.width ? { width: item.width } : {}),
    ...(item.height ? { height: item.height } : {}),
    author: { "@type": "Person", name: item.authorName },
    datePublished: item.createdAt,
    keywords: [item.roomLabel, item.styleLabel, "인테리어 시안", "AI 인테리어"].join(", "),
    creditText: BRAND.name,
    acquireLicensePage: `${SITE_URL}/pricing`,
    isPartOf: { "@id": `${SITE_URL}/#website` },
  };
}

/* ── 렌더 ── */

/**
 * `<script type="application/ld+json">` 하나에 @graph 로 묶어 낸다.
 * `</script>` 가 본문에 끼어 스크립트가 닫히는 일을 막기 위해 `<` 를 이스케이프한다.
 */
export function JsonLd({ graph }: { graph: object[] }) {
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(
    /</g,
    "\u003c"
  );
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
