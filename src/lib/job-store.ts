import type { GenerationJob } from "./types";

/**
 * Phase 1 전용 인메모리 job 저장소.
 * TODO(Phase 2): Supabase `generation_jobs` 테이블 + Realtime 구독으로 교체한다.
 * (개발 중 HMR로 모듈이 재평가돼도 유지되도록 globalThis에 붙인다.)
 */
const globalRef = globalThis as unknown as {
  __interiorJobStore?: Map<string, GenerationJob>;
};

const store: Map<string, GenerationJob> =
  globalRef.__interiorJobStore ?? (globalRef.__interiorJobStore = new Map());

export function putJob(job: GenerationJob): void {
  store.set(job.id, job);
}

export function getJob(id: string): GenerationJob | undefined {
  return store.get(id);
}

export function patchJob(id: string, patch: Partial<GenerationJob>): GenerationJob | undefined {
  const current = store.get(id);
  if (!current) return undefined;
  const next = { ...current, ...patch };
  store.set(id, next);
  return next;
}

/** 최근 작업 목록 (로컬 mock 모드 전용) */
export function listJobs(projectId?: string | null): GenerationJob[] {
  const all = [...store.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (projectId === undefined) return all;
  return all.filter((job) => (job.settings.projectId ?? null) === projectId);
}

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
