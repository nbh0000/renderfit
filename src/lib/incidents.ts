import { createAdminSupabase } from "@/lib/supabase/server";
import { notify, type AlertLevel } from "@/lib/alerts";

/**
 * 사고를 남기고, 심한 것은 사람에게 알린다.
 *
 * 지금까지는 console.error 가 전부였다. 유료로 열면 자동결제가 실패하거나 크레딧이
 * 잘못 나가도 우리가 모른 채 지나가는데, 그게 가장 비싼 실수다.
 *
 * 기록은 절대 부르는 쪽을 막지 않는다 — 사고를 적으려다 또 사고가 나면 곤란하다.
 */

export type IncidentKind =
  /** 자동결제·첫 결제 승인 실패 */
  | "payment_failed"
  /** 결제는 됐는데 요금제·크레딧 반영이 안 됨 — 가장 급하다 */
  | "payment_orphaned"
  /** 크레딧 차감·복구 실패 */
  | "credit_failed"
  /** AI 잡 실패 (분석·렌더·생성) */
  | "job_failed"
  /** 프로젝트 저장 실패 */
  | "save_failed";

export interface Incident {
  kind: IncidentKind;
  severity?: AlertLevel;
  userId?: string | null;
  projectId?: string | null;
  message: string;
  context?: Record<string, unknown>;
}

/** 종류별 기본 심각도 — 돈이 걸린 것은 무조건 error */
const DEFAULT_SEVERITY: Record<IncidentKind, AlertLevel> = {
  payment_failed: "error",
  payment_orphaned: "error",
  credit_failed: "error",
  job_failed: "warn",
  save_failed: "warn",
};

/** 알림까지 보낼 만큼 심한가 */
function shouldNotify(severity: AlertLevel): boolean {
  return severity === "error";
}

function titleOf(kind: IncidentKind): string {
  switch (kind) {
    case "payment_failed":
      return "결제 실패";
    case "payment_orphaned":
      return "결제됐는데 요금제 반영 실패";
    case "credit_failed":
      return "크레딧 처리 실패";
    case "job_failed":
      return "AI 작업 실패";
    case "save_failed":
      return "저장 실패";
  }
}

export async function recordIncident(incident: Incident): Promise<void> {
  const severity = incident.severity ?? DEFAULT_SEVERITY[incident.kind];

  try {
    const admin = createAdminSupabase();

    if (admin) {
      await admin.from("incidents").insert({
        kind: incident.kind,
        severity,
        user_id: incident.userId ?? null,
        project_id: incident.projectId ?? null,
        message: incident.message.slice(0, 500),
        context: incident.context ?? {},
      });
    }

    if (shouldNotify(severity)) {
      const site = process.env.NEXT_PUBLIC_SITE_URL ?? "";
      await notify({
        level: severity,
        title: titleOf(incident.kind),
        body: incident.message.slice(0, 300),
        url: site ? `${site}/admin` : undefined,
      });
    }
  } catch (error) {
    // 기록에 실패해도 부르는 쪽은 계속 간다
    console.error(
      "[incident] 남기지 못했습니다:",
      error instanceof Error ? error.message : "알 수 없는 오류",
      incident.kind,
      incident.message
    );
  }
}
