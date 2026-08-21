import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { MODE_MAP } from "@/config/modes";
import { ROOM_MAP } from "@/config/rooms";
import { STYLE_MAP } from "@/config/styles";
import { getViewer } from "@/lib/auth";
import { fetchRecentJobs } from "@/lib/jobs/read";
import { listJobs } from "@/lib/job-store";
import { createServerSupabase } from "@/lib/supabase/server";
import { extractUserRequest } from "@/lib/prompt";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { PromptDetails } from "@/components/PromptDetails";
import type { GenerationJob } from "@/lib/types";

export const metadata: Metadata = {
  title: "내 보관함",
  description: "만든 시안이 계정에 자동으로 쌓입니다.",
};

export const dynamic = "force-dynamic";

/**
 * 내 보관함.
 *
 * 생성한 시안은 프로젝트를 고르지 않아도 계정에 남는다.
 * 예전에는 프로젝트에 넣은 것만 다시 볼 수 있어서, 분류 없이 만든 시안은
 * 스튜디오를 벗어나는 순간 찾을 방법이 없었다. 이 페이지가 그 목록이다.
 */
export default async function LibraryPage() {
  const viewer = await getViewer();
  if (viewer.configured && !viewer.userId) redirect("/login?next=/library");

  let jobs: GenerationJob[] = [];

  if (viewer.configured) {
    const supabase = await createServerSupabase();
    if (supabase) jobs = await fetchRecentJobs(supabase, { limit: 60 });
  } else {
    jobs = listJobs();
  }

  const succeeded = jobs.filter((job) => job.status === "succeeded" && job.results.length > 0);
  const total = succeeded.reduce((sum, job) => sum + job.results.length, 0);

  return (
    <AppShell active="library" authed={Boolean(viewer.userId)}>
      <main className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
        <h1 className="text-[22px] font-semibold tracking-tight">내 보관함</h1>
        <p className="mt-1 text-[13px] text-muted">
          만든 시안 {total}장이 계정에 저장되어 있습니다. 따로 저장하지 않아도 자동으로 쌓입니다.
        </p>

        {succeeded.length === 0 ? (
          <div className="mt-8 flex min-h-[240px] flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface/60 px-6 text-center">
            <p className="text-[15px] font-semibold">아직 만든 시안이 없습니다</p>
            <p className="mt-1.5 text-[13px] text-muted">
              사진을 올려 시안을 만들면 여기에 자동으로 저장됩니다.
            </p>
            <Link
              href="/studio"
              className="mt-5 inline-flex h-10 items-center rounded-lg bg-accent px-4 text-[14px] font-medium text-white hover:bg-accent-hover"
            >
              시안 만들러 가기
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

                {/* 어떤 지시로 만든 결과인지 함께 남긴다 */}
                <PromptDetails
                  userRequest={extractUserRequest(job.prompt)}
                  fullPrompt={job.prompt}
                  className="mb-2"
                />

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {job.results.map((result, index) => (
                    <figure
                      key={result.id}
                      className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface"
                    >
                      {/*
                        원본이 남아 있으면 전/후 비교로 보여 준다.
                        시안만 있으면 "무엇이 어떻게 달라졌는지"를 기억에 의존해야 한다.
                      */}
                      {job.sourceImageUrl ? (
                        <BeforeAfterSlider
                          beforeSrc={job.sourceImageUrl}
                          afterSrc={result.url}
                          beforeLabel="올린 사진"
                          afterLabel={`시안 ${index + 1}`}
                        />
                      ) : (
                        <div className="aspect-[4/3] bg-sunken">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={result.url}
                            alt={`시안 ${index + 1}`}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        </div>
                      )}

                      <figcaption className="flex items-center justify-between border-t border-line px-2 py-1.5 text-[11.5px] text-muted">
                        <span>시안 {index + 1}</span>
                        <a
                          href={result.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent hover:underline"
                        >
                          원본 열기
                        </a>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </AppShell>
  );
}
