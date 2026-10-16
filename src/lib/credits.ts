import { recordIncident } from "@/lib/incidents";
import { createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/**
 * 편집기에서 AI를 쓸 때 크레딧을 걷는다.
 *
 * 빠른 생성(스튜디오)은 처음부터 크레딧을 걷었는데 편집기는 한 푼도 걷지 않았다.
 * 그런데 실제 비용은 편집기 쪽이 크다 — 도면 분석은 Gemini를 두 번 부르고, 실사
 * 렌더는 이미지 생성이라 가장 비싸다. 무료 사용자가 편집기만 열어 두면 하루 종일
 * 공짜로 돌릴 수 있었다.
 *
 * 스튜디오와 같은 방식으로 건다 — 일을 시작하기 전에 먼저 깎고, 실패하면 돌려준다.
 * 먼저 깎아야 요청이 동시에 들어와도 잔액이 음수가 되지 않는다 (consume_credits가
 * 한 문장 안에서 잔액을 확인하고 깎는다).
 */

/*
 * 크레딧 표는 config/editorCosts.ts 에 있다.
 *
 * 화면도 같은 표를 봐야 "3개 든다"고 물어보고 5개가 빠지는 일이 없다. 이 파일은
 * Supabase 를 물고 있어 브라우저에서 못 불러오므로, 숫자만 떼어 두고 여기서 다시 내보낸다.
 */
export { EDITOR_COST } from "@/config/editorCosts";

export type CreditCharge = {
  /** 걷는 데 성공했으면 되돌려 줄 함수, 실패했으면 그 이유를 담은 응답 */
  refund: () => Promise<void>;
};

export type CreditResult = CreditCharge | { denied: Response };

export function isDenied(result: CreditResult): result is { denied: Response } {
  return "denied" in result;
}

/**
 * 크레딧을 먼저 깎는다.
 *
 * Supabase가 없는 로컬·데모 모드에서는 걷지 않는다 — 그때는 Mock provider라 비용도
 * 들지 않고, 키 없이 전체 흐름을 볼 수 있어야 한다.
 */
export async function chargeCredits(amount: number): Promise<CreditResult> {
  if (!isSupabaseConfigured() || amount <= 0) {
    return { refund: async () => {} };
  }

  const supabase = await createServerSupabase();
  if (!supabase) {
    return {
      denied: Response.json({ error: "서버 설정 오류입니다." }, { status: 500 }),
    };
  }

  const { error } = await supabase.rpc("consume_credits", { p_amount: amount });

  if (error) {
    const empty = error.message?.includes("INSUFFICIENT_CREDITS");
    return {
      denied: Response.json(
        {
          error: empty
            ? "크레딧이 부족합니다. 요금제를 올리거나 다음 달을 기다려 주세요."
            : "크레딧을 확인하지 못했습니다.",
          insufficient: empty,
        },
        { status: empty ? 402 : 500 }
      ),
    };
  }

  /*
   * 되돌려 주기는 한 번만 해야 한다.
   * 라우트가 여러 갈래로 빠져나가다 두 번 부르면 없던 크레딧이 생긴다.
   */
  let refunded = false;

  return {
    refund: async () => {
      if (refunded) return;
      refunded = true;

      const { error: refundError } = await supabase.rpc("refund_credits", { p_amount: amount });
      if (refundError) {
        /*
         * 되돌려 주지 못하면 사용자 크레딧이 그냥 사라진다.
         * 조용히 넘기면 "돈은 냈는데 못 썼다"는 문의로 돌아오므로 사고로 남긴다.
         */
        await recordIncident({
          kind: "credit_failed",
          message: `크레딧 ${amount}을 되돌려 주지 못했습니다 — ${refundError.message}`,
          context: { amount },
        });
      }
    },
  };
}
