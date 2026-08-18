import type { ModeId } from "@/config/modes";
import type { RoomId } from "@/config/rooms";
import type { StyleId } from "@/config/styles";
import type { PlanId, ResolutionId } from "@/config/plans";

export type JobStatus = "pending" | "processing" | "succeeded" | "failed";

export interface MaterialSpec {
  /** 바닥 마감재 (예: "오크 헤링본 마루") */
  floor: string;
  /** 벽 마감재 (예: "베이지 도장") */
  wall: string;
  /** 포인트 요소 (예: "블랙 스틸 프레임 파티션") */
  accent: string;
}

export const EMPTY_MATERIALS: MaterialSpec = { floor: "", wall: "", accent: "" };

export interface GenerationSettings {
  modeId: ModeId;
  roomId: RoomId;
  styleId: StyleId;
  resolution: ResolutionId;
  materials: MaterialSpec;
  /** 보존 마스킹 사용 여부 (마스크 PNG는 별도 파일로 전달) */
  useMask: boolean;
  /** 사용자가 직접 입력한 추가 지시 (선택) */
  customPrompt?: string;
  /** 내 프로젝트 (Phase 4) */
  projectId?: string | null;
}

export interface GenerationResultImage {
  id: string;
  url: string;
  width: number;
  height: number;
  /** 무료 플랜 결과물 여부 → 워터마크 오버레이 */
  watermarked: boolean;
}

export interface GenerationJob {
  id: string;
  status: JobStatus;
  createdAt: string;
  completedAt?: string;
  settings: GenerationSettings;
  /** 원본 이미지 URL (Phase 1 mock에서는 클라이언트 objectURL을 사용) */
  sourceImageUrl: string | null;
  prompt: string;
  results: GenerationResultImage[];
  /** 차감된 크레딧. 실패 시 환불 대상 */
  creditsCharged: number;
  creditsRefunded?: boolean;
  planAtRequest: PlanId;
  error?: string;
}

export interface AccountState {
  plan: PlanId;
  credits: number;
}
