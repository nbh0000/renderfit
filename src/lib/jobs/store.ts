import type { SupabaseClient } from "@supabase/supabase-js";
import type { GeneratedImage } from "@/lib/image-api";
import { patchJob } from "@/lib/job-store";
import { RESULTS_BUCKET } from "@/lib/supabase/env";

/**
 * 생성 파이프라인이 결과를 기록하는 곳.
 * Supabase가 설정돼 있으면 DB+Storage에, 아니면 인메모리에 쓴다.
 */
export interface JobStore {
  markProcessing(jobId: string): Promise<void>;
  saveResults(jobId: string, images: GeneratedImage[], watermarked: boolean): Promise<void>;
  markFailed(jobId: string, message: string, refundCredits: number): Promise<void>;
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes("svg")) return "svg";
  if (mimeType.includes("jpeg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

/* ─────────────────────────── 인메모리 (mock) ─────────────────────────── */

export function createMemoryStore(): JobStore {
  return {
    async markProcessing(jobId) {
      patchJob(jobId, { status: "processing" });
    },
    async saveResults(jobId, images, watermarked) {
      patchJob(jobId, {
        status: "succeeded",
        completedAt: new Date().toISOString(),
        results: images.map((image, i) => ({
          id: `${jobId}_${i + 1}`,
          // 로컬 mock 경로에서는 저장소가 없으므로 data URL로 돌려준다.
          url: `data:${image.mimeType};base64,${image.data.toString("base64")}`,
          width: image.width,
          height: image.height,
          watermarked,
        })),
      });
    },
    async markFailed(jobId, message, refundCredits) {
      patchJob(jobId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: message,
        creditsRefunded: refundCredits > 0,
      });
    },
  };
}

/* ────────────────────────────── Supabase ────────────────────────────── */

/**
 * @param client 서비스 롤 클라이언트(권장) 또는 사용자 세션 클라이언트
 * @param refund 크레딧 환불 함수. 호출자가 세션 유무에 맞는 RPC를 넘긴다.
 */
export function createSupabaseStore(
  client: SupabaseClient,
  userId: string,
  refund: (amount: number) => Promise<boolean>
): JobStore {
  const admin = client;
  return {
    async markProcessing(jobId) {
      await admin.from("generation_jobs").update({ status: "processing" }).eq("id", jobId);
    },

    async saveResults(jobId, images, watermarked) {
      const rows: {
        job_id: string;
        user_id: string;
        storage_path: string;
        width: number;
        height: number;
        watermarked: boolean;
        position: number;
      }[] = [];

      for (const [index, image] of images.entries()) {
        const path = `${userId}/${jobId}/${index + 1}.${extensionFor(image.mimeType)}`;
        const { error } = await admin.storage
          .from(RESULTS_BUCKET)
          .upload(path, image.data, { contentType: image.mimeType, upsert: true });
        if (error) throw new Error(`결과 이미지 저장에 실패했습니다: ${error.message}`);

        rows.push({
          job_id: jobId,
          user_id: userId,
          storage_path: path,
          width: image.width,
          height: image.height,
          watermarked,
          position: index,
        });
      }

      const { error: insertError } = await admin.from("generation_results").insert(rows);
      if (insertError) throw new Error(`결과 저장에 실패했습니다: ${insertError.message}`);

      await admin
        .from("generation_jobs")
        .update({ status: "succeeded", completed_at: new Date().toISOString() })
        .eq("id", jobId);
    },

    async markFailed(jobId, message, refundCredits) {
      const refunded = refundCredits > 0 ? await refund(refundCredits) : false;

      await admin
        .from("generation_jobs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
          error: message.slice(0, 500),
          credits_refunded: refunded,
        })
        .eq("id", jobId);
    },
  };
}
