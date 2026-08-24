import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/auth";
import { hasAdmins, isAdminEmail } from "@/lib/admin";
import { AdminDashboard } from "@/components/admin/AdminDashboard";

export const metadata: Metadata = {
  title: "관리자",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * 관리자 화면.
 *
 * 권한이 없으면 403이 아니라 404로 돌려준다 — 이런 화면이 있다는 사실 자체를 알리지
 * 않는 편이 낫다. ADMIN_EMAILS 를 설정하지 않았으면 아무도 못 들어간다.
 */
export default async function AdminPage() {
  if (!hasAdmins()) notFound();

  const viewer = await getViewer();
  if (!isAdminEmail(viewer.authEmail)) notFound();

  return <AdminDashboard />;
}
