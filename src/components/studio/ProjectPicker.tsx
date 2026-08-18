"use client";

import { useCallback, useEffect, useState } from "react";
import type { Project } from "@/lib/projects";

interface Props {
  value: string | null;
  onChange: (projectId: string | null) => void;
  onError: (message: string) => void;
}

/** 생성물이 자동으로 분류될 프로젝트를 고른다. 여기서 바로 새 폴더도 만들 수 있다. */
export function ProjectPicker({ value, onChange, onError }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/folders", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { projects: Project[] };
      setProjects(data.projects ?? []);
    } catch {
      /* 목록을 못 불러와도 생성 자체는 가능하다 */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "프로젝트를 만들지 못했습니다.");
      setProjects((prev) => [data.project as Project, ...prev]);
      onChange((data.project as Project).id);
      setName("");
      setCreating(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : "프로젝트를 만들지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <label htmlFor="project" className="text-[13px] font-semibold">
          프로젝트
        </label>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          className="text-[12px] text-accent hover:underline"
        >
          {creating ? "취소" : "새 프로젝트"}
        </button>
      </div>

      {creating ? (
        <div className="mt-2 flex gap-1.5">
          <input
            type="text"
            value={name}
            autoFocus
            maxLength={60}
            placeholder="예: 반포 자이 34평"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void create();
            }}
            className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-[13px]"
          />
          <button
            type="button"
            onClick={create}
            disabled={saving || !name.trim()}
            className="h-9 shrink-0 rounded-lg bg-accent px-3 text-[13px] text-white disabled:opacity-50"
          >
            만들기
          </button>
        </div>
      ) : (
        <select
          id="project"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="mt-2 h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
        >
          <option value="">분류 없음</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
