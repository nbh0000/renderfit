import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { getViewer } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { getProject, memoryGetProject } from "@/lib/projects";
import { fetchRecentJobs } from "@/lib/jobs/read";
import { listJobs } from "@/lib/job-store";
import { MODE_MAP } from "@/config/modes";
import { ROOM_MAP } from "@/config/rooms";
import { STYLE_MAP } from "@/config/styles";
import type { GenerationJob } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const viewer = await getViewer();

  let name: string | undefined;
  if (viewer.configured) {
    const supabase = await createServerSupabase();
    if (supabase) name = (await getProject(supabase, id))?.name;
  } else {
    name = memoryGetProject(id)?.name;
  }

  return { title: name ?? "프로젝트" };
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getViewer();
  if (viewer.configured && !viewer.userId) redirect(`/login?next=/projects/${id}`);

  let name: string | null = null;
  let jobs: GenerationJob[] = [];

  if (viewer.configured) {
    const supabase = await createServerSupabase();
    if (!supabase) notFound();
    const project = await getProject(supabase, id);
    if (!project) notFound();
    name = project.name;
    jobs = await fetchRecentJobs(supabase, { projectId: id });
  } else {
    const project = memoryGetProject(id);
    if (!project) notFound();
    name = project.name;
    jobs = listJobs(id);
  }

  const succeeded = jobs.filter((job) => job.status === "succeeded");

  return (
    <div className="min-h-dvh">
      <AppHeader active="projects" />

      <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
        <Link href="/projects" className="text-[12.5px] text-muted hover:text-ink">
          ← 내 프로젝트
        </Link>
        <h1 className="mt-2 text-[22px] font-semibold tracking-tight">{name}</h1>
        <p className="mt-1 text-[13px] text-muted">생성 {succeeded.length}건</p>

        {succeeded.length === 0 ? (
          <div className="mt-8 flex min-h-[240px] flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface/60 px-6 text-center">
            <p className="text-[15px] font-semibold">아직 이 프로젝트에 담긴 시안이 없습니다</p>
            <p className="mt-1.5 text-[13px] text-muted">
              스튜디오에서 이 프로젝트를 선택하고 생성하면 여기에 쌓입니다.
            </p>
            <Link
              href="/studio"
              className="mt-5 inline-flex h-10 items-center rounded-lg bg-accent px-4 text-[14px] font-medium text-white hover:bg-accent-hover"
            >
              스튜디오 열기
            </Link>
          </div>
        ) : (
          <div className="mt-6 space-y-8">
            {succeeded.map((job) => (
              <section key={job.id}>
                <div className="mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <h2 className="text-[14px] font-medium">
                    {ROOM_MAP[job.settings.roomId]?.label} · {STYLE_MAP[job.settings.styleId]?.label}
                  </h2>
                  <span className="text-[12px] text-muted">
                    {MODE_MAP[job.settings.modeId]?.label} ·{" "}
                    {new Date(job.createdAt).toLocaleString("ko-KR")}
                  </span>
                </div>

                {/* 원본 ↔ 시안 쌍으로 나열한다 */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  <figure className="overflow-hidden rounded-[var(--radius-card)] border border-line-strong bg-surface">
                    <div className="relative aspect-[4/3] bg-sunken">
                      {job.sourceImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={job.sourceImageUrl}
                          alt="원본"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="absolute inset-0 grid place-items-center text-[11.5px] text-muted">
                          원본 없음
                        </span>
                      )}
                    </div>
                    <figcaption className="border-t border-line px-2 py-1.5 text-[11.5px] text-muted">
                      원본
                    </figcaption>
                  </figure>

                  {job.results.map((result, index) => (
                    <figure
                      key={result.id}
                      className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface"
                    >
                      <div className="aspect-[4/3] bg-sunken">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={result.url}
                          alt={`시안 ${index + 1}`}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <figcaption className="border-t border-line px-2 py-1.5 text-[11.5px] text-muted">
                        시안 {index + 1}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
