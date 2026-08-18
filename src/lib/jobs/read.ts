import type { SupabaseClient } from "@supabase/supabase-js";
import type { GenerationJob, JobStatus, MaterialSpec } from "@/lib/types";
import type { ModeId } from "@/config/modes";
import type { RoomId } from "@/config/rooms";
import type { StyleId } from "@/config/styles";
import type { PlanId, ResolutionId } from "@/config/plans";
import { EMPTY_MATERIALS } from "@/lib/types";
import { RESULTS_BUCKET, SOURCES_BUCKET } from "@/lib/supabase/env";

interface JobRow {
  id: string;
  status: JobStatus;
  mode_id: string;
  room_id: string;
  style_id: string;
  resolution: string;
  materials: Partial<MaterialSpec> | null;
  use_mask: boolean;
  prompt: string;
  source_path: string | null;
  project_id: string | null;
  image_count: number;
  credits_charged: number;
  credits_refunded: boolean;
  plan_at_request: string;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  generation_results: {
    id: string;
    storage_path: string;
    width: number;
    height: number;
    watermarked: boolean;
    position: number;
  }[];
}

const JOB_SELECT =
  "id, status, mode_id, room_id, style_id, resolution, materials, use_mask, prompt, source_path, project_id, image_count, credits_charged, credits_refunded, plan_at_request, error, created_at, completed_at, generation_results (id, storage_path, width, height, watermarked, position)";

/** 원본 사진은 비공개 버킷에 있으므로 열람용 서명 URL을 만든다. */
async function signedSourceUrl(
  supabase: SupabaseClient,
  path: string | null
): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from(SOURCES_BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

function publicResultUrl(supabase: SupabaseClient, path: string): string {
  return supabase.storage.from(RESULTS_BUCKET).getPublicUrl(path).data.publicUrl;
}

async function toJob(supabase: SupabaseClient, row: JobRow): Promise<GenerationJob> {
  const results = [...(row.generation_results ?? [])].sort((a, b) => a.position - b.position);

  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
    settings: {
      modeId: row.mode_id as ModeId,
      roomId: row.room_id as RoomId,
      styleId: row.style_id as StyleId,
      resolution: row.resolution as ResolutionId,
      materials: { ...EMPTY_MATERIALS, ...(row.materials ?? {}) },
      useMask: row.use_mask,
      projectId: row.project_id,
    },
    sourceImageUrl: await signedSourceUrl(supabase, row.source_path),
    prompt: row.prompt,
    results: results.map((result) => ({
      id: result.id,
      url: publicResultUrl(supabase, result.storage_path),
      width: result.width,
      height: result.height,
      watermarked: result.watermarked,
    })),
    creditsCharged: row.credits_charged,
    creditsRefunded: row.credits_refunded,
    planAtRequest: row.plan_at_request as PlanId,
    error: row.error ?? undefined,
  };
}

/** 단일 작업 조회 (RLS로 본인 것만 보인다) */
export async function fetchJob(
  supabase: SupabaseClient,
  jobId: string
): Promise<GenerationJob | null> {
  const { data, error } = await supabase
    .from("generation_jobs")
    .select(JOB_SELECT)
    .eq("id", jobId)
    .maybeSingle();

  if (error || !data) return null;
  return toJob(supabase, data as unknown as JobRow);
}

/** 최근 작업 목록. projectId를 주면 해당 프로젝트의 것만 가져온다. */
export async function fetchRecentJobs(
  supabase: SupabaseClient,
  options: { limit?: number; projectId?: string | null } = {}
): Promise<GenerationJob[]> {
  const { limit = 30, projectId } = options;

  let query = supabase.from("generation_jobs").select(JOB_SELECT);
  if (projectId !== undefined) {
    query = projectId === null ? query.is("project_id", null) : query.eq("project_id", projectId);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  return Promise.all((data as unknown as JobRow[]).map((row) => toJob(supabase, row)));
}
