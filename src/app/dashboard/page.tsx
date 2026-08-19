import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { DashboardClient, type ProjectSummary } from "@/components/dashboard/DashboardClient";
import { getViewer } from "@/lib/auth";
import { listProjects } from "@/services/projectService";
import { summarizeScene } from "@/scene/serialization";
import { providerStatus } from "@/ai/providers";

export const metadata: Metadata = {
  title: "대시보드",
  description: "AI로 만든 인테리어 장면을 객체 단위로 편집합니다.",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const viewer = await getViewer();
  // Supabase가 연결된 배포 환경에서는 로그인이 필요하다 (프로젝트는 소유자 단위로 저장된다).
  if (viewer.configured && !viewer.userId) redirect("/login?next=/dashboard");

  const projects = await listProjects(viewer.userId);

  const summaries: ProjectSummary[] = projects.map((project) => ({
    id: project.id,
    name: project.name,
    status: project.status,
    thumbnailUrl: project.thumbnailUrl,
    summary: summarizeScene(project.scene),
    objectCount: project.scene.objects.length,
    updatedAt: project.updatedAt,
  }));

  return (
    <div className="min-h-dvh">
      <AppHeader active="dashboard" authed={Boolean(viewer.userId)} />
      <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6">
        <DashboardClient projects={summaries} providers={providerStatus()} />
      </main>
    </div>
  );
}
