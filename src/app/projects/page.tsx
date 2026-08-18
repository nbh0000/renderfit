import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { NewProjectForm } from "@/components/projects/NewProjectForm";
import { getViewer } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { listProjects, memoryListProjects, type Project } from "@/lib/projects";
import { listJobs } from "@/lib/job-store";

export const metadata: Metadata = {
  title: "내 프로젝트",
  description: "클라이언트와 현장별로 시안을 정리합니다.",
};

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const viewer = await getViewer();
  if (viewer.configured && !viewer.userId) redirect("/login?next=/projects");

  let projects: Project[] = [];

  if (viewer.configured) {
    const supabase = await createServerSupabase();
    if (supabase) projects = await listProjects(supabase);
  } else {
    // 로컬 mock 모드: 인메모리 저장소에서 읽고 생성물 수를 직접 센다.
    projects = memoryListProjects().map((project) => ({
      ...project,
      jobCount: listJobs(project.id).length,
    }));
  }

  return (
    <div className="min-h-dvh">
      <AppHeader active="projects" />

      <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">내 프로젝트</h1>
            <p className="mt-1 text-[13px] text-muted">
              스튜디오에서 생성할 때 프로젝트를 고르면 이곳에 자동으로 쌓입니다.
            </p>
          </div>
          <NewProjectForm compact />
        </div>

        {projects.length === 0 ? (
          <div className="mt-8 flex min-h-[280px] flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface/60 px-6 text-center">
            <p className="text-[15px] font-semibold">첫 프로젝트를 만들고 시안을 정리해 보세요</p>
            <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">
              클라이언트 이름이나 현장 주소로 폴더를 만들면, 생성한 시안이 자동으로 그 폴더에 담깁니다.
            </p>
            <div className="mt-5">
              <NewProjectForm />
            </div>
          </div>
        ) : (
          <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <li key={project.id}>
                <Link
                  href={`/projects/${project.id}`}
                  className="block rounded-[var(--radius-card)] border border-line bg-surface p-4 transition-colors hover:border-line-strong hover:bg-sunken"
                >
                  <p className="text-[15px] font-medium">{project.name}</p>
                  <p className="mt-1 text-[12px] text-muted">
                    생성 {project.jobCount ?? 0}건 ·{" "}
                    {new Date(project.createdAt).toLocaleDateString("ko-KR")}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
