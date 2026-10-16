import { estimateCostKrw } from "@/config/costs";
import { createAdminSupabase } from "@/lib/supabase/server";

/**
 * 외부 AI API 호출 기록.
 *
 * 부를 때마다 한 줄 남긴다 — 횟수와 추정 비용을 대시보드가 합산한다.
 * 기록이 실패해도 부르는 쪽을 막지 않는다 (통계 때문에 생성이 멈추면 안 된다).
 */

export type ApiCallKind = "image_generate" | "product_image" | "furniture_estimate";

export interface ApiCallInput {
  model: string;
  kind: ApiCallKind;
  userId?: string | null;
  /** 만든 이미지 장 수. 텍스트 호출은 0 */
  images?: number;
  ok: boolean;
  durationMs?: number;
}

export function recordApiCall(input: ApiCallInput): void {
  void (async () => {
    try {
      const admin = createAdminSupabase();
      if (!admin) return;

      const images = input.images ?? 0;
      await admin.from("api_calls").insert({
        provider: "gemini",
        model: input.model,
        kind: input.kind,
        user_id: input.userId ?? null,
        images,
        ok: input.ok,
        // 실패한 호출은 보통 과금되지 않는다
        cost_krw: input.ok ? estimateCostKrw(input.model, images) : 0,
        duration_ms: input.durationMs ?? null,
      });
    } catch (error) {
      console.warn(
        "[api-usage] 남기지 못했습니다:",
        error instanceof Error ? error.message : error
      );
    }
  })();
}
