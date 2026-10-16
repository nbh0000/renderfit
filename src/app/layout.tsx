import { PageViewTracker } from "@/components/PageViewTracker";
import type { Metadata, Viewport } from "next";
import { Noto_Serif_KR } from "next/font/google";
import { ToastProvider } from "@/components/ui/Toast";
import { BRAND } from "@/config/brand";
import { JsonLd, OG_IMAGE, SITE_URL, organizationLd, webSiteLd } from "@/lib/seo";
import "./globals.css";

const notoSerifKr = Noto_Serif_KR({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-noto-serif-kr",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${BRAND.name} — ${BRAND.headline}`,
    template: `%s | ${BRAND.name}`,
  },
  description: BRAND.description,
  applicationName: BRAND.name,
  keywords: [
    "AI 인테리어",
    "인테리어 시안",
    "인테리어 렌더",
    "평면도 3D",
    "도면 렌더링",
    "홈스타일링",
    BRAND.name,
    BRAND.wordmark,
  ],
  // 하위 페이지가 title·description 만 덮어써도 카드 이미지·사이트명은 여기 것을 쓴다.
  openGraph: {
    siteName: BRAND.name,
    locale: "ko_KR",
    type: "website",
    title: `${BRAND.name} — ${BRAND.headline}`,
    description: BRAND.description,
    images: [{ ...OG_IMAGE, alt: `${BRAND.name} 시안 예시` }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND.name} — ${BRAND.headline}`,
    description: BRAND.description,
    images: [OG_IMAGE.url],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
};

export const viewport: Viewport = {
  themeColor: "#FAF9F7",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={notoSerifKr.variable}>
      <head>
        {/* Pretendard: 한국어 본문 기본 서체 */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-dvh bg-canvas text-ink antialiased">
        <JsonLd graph={[organizationLd(), webSiteLd()]} />
        <PageViewTracker />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
