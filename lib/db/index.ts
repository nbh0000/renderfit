import { promises as fs } from "node:fs";
import path from "node:path";
import type { DesignProject, SceneOperation, SceneVersion } from "@/scene/types";
import { createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/**
 * DesignProject 저장소.
 *
 * Supabase가 설정돼 있으면 PostgreSQL에, 아니면 로컬 파일(.data/projects)에 저장한다.
 * 두 구현 모두 같은 인터페이스를 쓰므로 서비스 코드는 저장소를 신경 쓰지 않는다.
 */
/**
 * 저장이 실패했다는 뜻.
 *
 * 라우트는 이것을 잡아 503으로 돌려주고, 편집기는 화면의 편집 내용을 지우지 않은 채
 * 저장에 실패했다고 알린다. 다른 오류(잘못된 요청 등)와 구분해야 하므로 따로 둔다.
 */
export class PersistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersistError";
  }
}

export interface ProjectRepository {
  readonly name: string;
  list(ownerId: string | null): Promise<DesignProject[]>;
  get(id: string, ownerId: string | null): Promise<DesignProject | null>;
  save(project: DesignProject): Promise<void>;
  delete(id: string, ownerId: string | null): Promise<void>;
}

const PROJECT_ROOT = path.join(process.cwd(), ".data", "projects");

export class LocalProjectRepository implements ProjectRepository {
  readonly name = "local";

  private file(id: string): string {
    return path.join(PROJECT_ROOT, `${id.replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
  }

  async list(): Promise<DesignProject[]> {
    try {
      const files = await fs.readdir(PROJECT_ROOT);
      const projects = await Promise.all(
        files
          .filter((file) => file.endsWith(".json"))
          .map(async (file) => {
            try {
              const raw = await fs.readFile(path.join(PROJECT_ROOT, file), "utf8");
              return JSON.parse(raw) as DesignProject;
            } catch {
              return null;
            }
          })
      );
      return projects
        .filter((project): project is DesignProject => Boolean(project))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch {
      return [];
    }
  }

  async get(id: string): Promise<DesignProject | null> {
    try {
      const raw = await fs.readFile(this.file(id), "utf8");
      return JSON.parse(raw) as DesignProject;
    } catch {
      return null;
    }
  }

  async save(project: DesignProject): Promise<void> {
    await fs.mkdir(PROJECT_ROOT, { recursive: true });
    await fs.writeFile(this.file(project.id), JSON.stringify(project, null, 2), "utf8");
  }

  async delete(id: string): Promise<void> {
    await fs.rm(this.file(id), { force: true });
  }
}

interface ProjectRow {
  id: string;
  owner_id: string | null;
  name: string;
  status: string;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
  scene: unknown;
  operations: unknown;
  redo_stack: unknown;
  versions: unknown;
}

export class SupabaseProjectRepository implements ProjectRepository {
  readonly name = "supabase";

  private toProject(row: ProjectRow): DesignProject {
    return {
      id: row.id,
      ownerId: row.owner_id,
      name: row.name,
      status: row.status as DesignProject["status"],
      thumbnailUrl: row.thumbnail_url,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      scene: row.scene as DesignProject["scene"],
      operations: (row.operations ?? []) as SceneOperation[],
      redoStack: (row.redo_stack ?? []) as SceneOperation[],
      versions: (row.versions ?? []) as SceneVersion[],
    };
  }

  async list(ownerId: string | null): Promise<DesignProject[]> {
    const supabase = await createServerSupabase();
    if (!supabase || !ownerId) return [];

    const { data, error } = await supabase
      .from("design_projects")
      .select("*")
      .eq("owner_id", ownerId)
      .order("updated_at", { ascending: false });

    if (error || !data) return [];
    return (data as unknown as ProjectRow[]).map((row) => this.toProject(row));
  }

  async get(id: string, ownerId: string | null): Promise<DesignProject | null> {
    const supabase = await createServerSupabase();
    if (!supabase) return null;

    const query = supabase.from("design_projects").select("*").eq("id", id);
    const { data, error } = await (ownerId ? query.eq("owner_id", ownerId) : query).maybeSingle();

    if (error || !data) return null;
    return this.toProject(data as unknown as ProjectRow);
  }

  /**
   * 프로젝트를 저장한다. 실패하면 던진다.
   *
   * supabase-js는 쓰기가 거절돼도 예외를 던지지 않고 { error }를 돌려준다. 예전에는
   * 그 결과를 버렸는데, 그래서 RLS 거절이나 네트워크 오류가 아무 일 없었던 것처럼
   * 지나갔다 — 프로젝트를 만들면 id까지 돌려받고서 다음 요청에서 404가 났고, 편집기는
   * "저장됐다"고 믿은 채로 사용자의 작업을 잃었다. 조용히 지나가느니 던지는 편이 낫다.
   */
  async save(project: DesignProject): Promise<void> {
    const supabase = await createServerSupabase();
    if (!supabase) return;

    const { error } = await supabase.from("design_projects").upsert({
      id: project.id,
      owner_id: project.ownerId,
      name: project.name,
      status: project.status,
      thumbnail_url: project.thumbnailUrl,
      created_at: project.createdAt,
      updated_at: project.updatedAt,
      scene: project.scene,
      operations: project.operations,
      redo_stack: project.redoStack,
      versions: project.versions,
    });

    if (error) throw new PersistError(error.message);
  }

  async delete(id: string, ownerId: string | null): Promise<void> {
    const supabase = await createServerSupabase();
    if (!supabase) return;

    const query = supabase.from("design_projects").delete().eq("id", id);
    const { error } = await (ownerId ? query.eq("owner_id", ownerId) : query);

    if (error) throw new PersistError(error.message);
  }
}

let cached: ProjectRepository | null = null;

export function getProjectRepository(): ProjectRepository {
  if (cached) return cached;
  cached = isSupabaseConfigured() ? new SupabaseProjectRepository() : new LocalProjectRepository();
  return cached;
}
