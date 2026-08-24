import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 오류 하나가 API 호출 여러 건으로 불어나지 않는지 본다.
 *
 * 구글 콘솔에 하루 503이 60건 넘게 잡힌 적이 있다. 사람이 60번 누른 게 아니라,
 * 실패 한 번을 우리 코드가 여덟 번으로 불린 것이었다 — 모델이 받아 주는 config를
 * 찾느라 네 단계를 훑고(붐빈 것은 config 문제가 아닌데도), 그러고 나서 처음부터
 * 한 번 더 훑었다. 클릭 한 번이 8건, 2안 비교면 16건이다.
 *
 * 그래서 호출 "횟수"를 못 박아 둔다. 이 수가 늘면 콘솔의 오류 수도 그만큼 늘어난다.
 */

/** SDK를 가짜로 바꿔 놓고 호출 횟수를 센다 */
const generateContent = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
}));

const params = {
  prompt: "거실을 밝게",
  image: { data: "AAAA", mimeType: "image/png" },
  size: 1024,
  count: 1,
};

/** 모듈 안의 "이 모델은 이 config가 통하더라" 기억까지 매번 지운다 */
async function loadModule() {
  vi.resetModules();
  return import("@/lib/image-api");
}

beforeEach(() => {
  generateContent.mockReset();
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.GEMINI_IMAGE_MODEL;
});

describe("이미지 생성 재시도", () => {
  it("붐벼서 난 오류(503)에 config 단계를 훑지 않는다", async () => {
    vi.useFakeTimers();
    try {
      const { generateImages } = await loadModule();
      generateContent.mockRejectedValue(
        new Error('{"error":{"code":503,"message":"The model is overloaded.","status":"UNAVAILABLE"}}')
      );

      const promise = generateImages(params).catch((error: Error) => error);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result).toBeInstanceOf(Error);
      // 시도 1 + 재시도 3 = 4. 단계 훑기가 살아 있으면 16이 된다.
      expect(generateContent).toHaveBeenCalledTimes(4);
      expect((result as Error).message).toContain("일시적으로 응답하지 않았습니다");
    } finally {
      vi.useRealTimers();
    }
  });

  it("설정을 모른다는 오류(400)에는 단계를 낮춰 가며 다시 부른다", async () => {
    const { generateImages } = await loadModule();
    generateContent.mockRejectedValue(
      new Error('{"error":{"code":400,"message":"Unknown name \\"imageSize\\"","status":"INVALID_ARGUMENT"}}')
    );

    await expect(generateImages(params)).rejects.toThrow();
    // config 4단계를 다 훑는다. 재시도는 없다 — 다시 불러도 같은 설정이면 같은 답이다.
    expect(generateContent).toHaveBeenCalledTimes(4);
  });

  it("한 번 통한 config 단계를 기억해 같은 실패를 되풀이하지 않는다", async () => {
    const { generateImages } = await loadModule();

    /** 첫 두 단계는 모른다고 하고, 세 번째부터 받아 주는 모델 */
    generateContent.mockImplementation(async ({ config }: { config?: { imageConfig?: unknown } }) => {
      if (config?.imageConfig) {
        throw new Error('{"error":{"code":400,"status":"INVALID_ARGUMENT","message":"Unknown name"}}');
      }
      return { candidates: [{ content: { parts: [{ inlineData: { data: "AAAA", mimeType: "image/svg+xml" } }] } }] };
    });

    await generateImages(params);
    expect(generateContent).toHaveBeenCalledTimes(3);

    generateContent.mockClear();
    await generateImages(params);
    // 두 번째 요청은 통하는 단계에서 바로 시작한다.
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});
