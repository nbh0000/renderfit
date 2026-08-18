"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";

export interface ProjectSummary {
  id: string;
  name: string;
  status: string;
  thumbnailUrl: string | null;
  summary: string;
  objectCount: number;
  updatedAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "작업 전",
  analyzing: "분석 중",
  generating: "생성 중",
  ready: "편집 가능",
};

export function DashboardClient({
  projects,
  providers,
}: {
  projects: ProjectSummary[];
  providers: Record<string, string>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const createProject = async () => {
    setCreating(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "새 프로젝트" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "프로젝트를 만들지 못했습니다.");
      router.push(`/editor/${data.project.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "프로젝트를 만들지 못했습니다.", "error");
      setCreating(false);
    }
  };

  const seedDemo = async () => {
    setCreating(true);
    try {
      const response = await fetch("/api/demo/seed", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "데모 생성에 실패했습니다.");
      toast("데모 프로젝트를 만들었습니다", "success");
      router.push(`/editor/${data.project.id}`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "데모 생성에 실패했습니다.", "error");
      setCreating(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">디자인 프로젝트</h1>
          <p className="mt-1 text-[13px] text-muted">
            사진을 올리고 AI로 만든 장면을 객체 단위로 편집합니다.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="프로젝트 이름"
            className="h-10 w-44 rounded-lg border border-line bg-surface px-3 text-sm"
          />
          <button
            type="button"
            disabled={creating}
            onClick={() => void createProject()}
            className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            새 프로젝트
          </button>
          <button
            type="button"
            disabled={creating}
            onClick={() => void seedDemo()}
            className="h-10 rounded-lg border border-line-strong px-4 text-sm hover:bg-sunken disabled:opacity-50"
          >
            데모 프로젝트
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {Object.entries(providers).map(([key, value]) => (
          <span
            key={key}
            className={[
              "rounded-full border px-2 py-0.5 text-[11px]",
              value.startsWith("mock") || value === "local"
                ? "border-line bg-sunken text-muted"
                : "border-accent/30 bg-accent-soft text-accent",
            ].join(" ")}
            title={`${key}: ${value}`}
          >
            {key} · {value}
          </span>
        ))}
      </div>

      {projects.length === 0 ? (
        <div className="mt-8 flex min-h-[260px] flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface/60 px-6 text-center">
          <p className="text-[15px] font-semibold">첫 프로젝트를 만들어 보세요</p>
          <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-muted">
            방 사진 한 장이면 됩니다. API key가 없어도 데모 프로젝트로 전체 편집 흐름을 확인할 수 있습니다.
          </p>
        </div>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                href={`/editor/${project.id}`}
                className="block overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface transition-colors hover:border-line-strong"
              >
                <span className="block aspect-[4/3] bg-sunken">
                  {project.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={project.thumbnailUrl}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="grid h-full place-items-center text-[12px] text-muted">
                      사진 없음
                    </span>
                  )}
                </span>
                <span className="block p-3">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[14px] font-medium">{project.name}</span>
                    <span className="shrink-0 rounded-full bg-sunken px-2 py-0.5 text-[10.5px] text-muted">
                      {STATUS_LABEL[project.status] ?? project.status}
                    </span>
                  </span>
                  <span className="mt-1 block truncate text-[11.5px] text-muted">
                    {project.summary}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted">
                    {new Date(project.updatedAt).toLocaleString("ko-KR")}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
