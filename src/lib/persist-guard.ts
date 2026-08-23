import { PersistError } from "@/lib/db";

/**
 * 저장 실패를 사용자에게 그대로 알린다.
 *
 * 예전에는 저장이 거절돼도 아무 일 없었던 것처럼 지나갔다. 프로젝트를 만들면 id까지
 * 돌려받고서 다음 요청에서 404가 났고, 편집기는 "저장됐다"고 믿은 채 사용자의 작업을
 * 잃었다. 이제 저장은 실패하면 던지고, 쓰기를 하는 라우트는 이 함수로 감싼다.
 *
 * 503으로 돌려주는 것은 "요청은 맞았는데 지금 못 저장했다"는 뜻이다. 400과 구분돼야
 * 편집기가 화면의 편집 내용을 지우지 않고 다시 시도할 수 있다.
 */
export async function withPersistGuard(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof PersistError)) throw error;

    console.error("[persist] 저장 실패:", error.message);
    return Response.json(
      {
        error: "저장하지 못했습니다. 편집 내용은 화면에 그대로 있으니 잠시 후 다시 시도해 주세요.",
        persisted: false,
      },
      { status: 503 }
    );
  }
}
