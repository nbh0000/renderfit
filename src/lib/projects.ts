import type { SupabaseClient } from "@supabase/supabase-js";

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  /** 목록에서 보여줄 생성물 수 */
  jobCount?: number;
}

/* ─────────────────── 로컬 mock 저장소 (Supabase 미설정) ─────────────────── */

const globalRef = globalThis as unknown as { __interiorProjects?: Map<string, Project> };
const memory: Map<string, Project> =
  globalRef.__interiorProjects ?? (globalRef.__interiorProjects = new Map());

export function memoryListProjects(): Project[] {
  return [...memory.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function memoryCreateProject(name: string): Project {
  const project: Project = {
    id: `prj_${Math.random().toString(36).slice(2, 10)}`,
    name,
    createdAt: new Date().toISOString(),
  };
  memory.set(project.id, project);
  return project;
}

export function memoryGetProject(id: string): Project | undefined {
  return memory.get(id);
}

/* ────────────────────────────── Supabase ────────────────────────────── */

export async function listProjects(supabase: SupabaseClient): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, created_at, generation_jobs(count)")
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return (data as unknown as {
    id: string;
    name: string;
    created_at: string;
    generation_jobs: { count: number }[];
  }[]).map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    jobCount: row.generation_jobs?.[0]?.count ?? 0,
  }));
}

export async function createProject(
  supabase: SupabaseClient,
  userId: string,
  name: string
): Promise<Project | null> {
  const { data, error } = await supabase
    .from("projects")
    .insert({ user_id: userId, name })
    .select("id, name, created_at")
    .single();

  if (error || !data) return null;
  return { id: data.id as string, name: data.name as string, createdAt: data.created_at as string };
}

export async function getProject(
  supabase: SupabaseClient,
  id: string
): Promise<Project | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;
  return { id: data.id as string, name: data.name as string, createdAt: data.created_at as string };
}
