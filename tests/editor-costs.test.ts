import { describe, expect, it } from "vitest";
import { COMMAND_CHARGE, EDITOR_COST, chargeForJob } from "@/config/editorCosts";

/**
 * 크레딧이 나가는 일은 묻고 나서 한다.
 *
 * 편집기의 AI 기능은 누르면 곧바로 크레딧이 빠졌다. 실사 렌더 한 번에 2개가 나가는데도
 * 누르기 전에는 얼마가 드는지 알 수 없었다.
 *
 * 확인 창이 "2개 든다"고 해 놓고 서버가 3개를 걷으면 그게 더 나쁘다. 그래서 화면과
 * 서버가 같은 표를 보는지, 경로마다 값이 맞는지 여기서 못 박는다.
 */

describe("경로별 크레딧", () => {
  it("실사 렌더가 미리보기보다 비싸다", () => {
    // 실사 렌더는 이미지 생성이라 가장 비싸다
    expect(chargeForJob("/render/final").cost).toBe(EDITOR_COST.renderFinal);
    expect(chargeForJob("/render/preview").cost).toBe(EDITOR_COST.renderPreview);
    expect(chargeForJob("/render/final").cost).toBeGreaterThan(
      chargeForJob("/render/preview").cost
    );
  });

  it("final 을 preview 로 잘못 읽지 않는다", () => {
    // 둘 다 /render 로 시작한다 — 순서를 뒤집으면 2개짜리를 1개라고 안내한다
    expect(chargeForJob("/render/final").label).toBe("실사 렌더");
    expect(chargeForJob("/render/preview").label).toBe("미리보기 렌더");
  });

  it("생성에도 값이 붙는다", () => {
    expect(chargeForJob("/generate").cost).toBeGreaterThan(0);
    expect(chargeForJob("/generate-asset").cost).toBe(EDITOR_COST.generateAsset);
  });

  it("generate-asset 을 generate 로 잘못 읽지 않는다", () => {
    expect(chargeForJob("/generate-asset").label).toBe("가구 만들기");
  });

  it("AI 명령에도 값이 있다", () => {
    expect(COMMAND_CHARGE.cost).toBe(EDITOR_COST.command);
    expect(COMMAND_CHARGE.label.length).toBeGreaterThan(0);
  });

  it("돈이 안 드는 일은 묻지 않는다", () => {
    // 성가시기만 하다 — 0 이면 확인 창이 뜨지 않는다
    /* 도면 들여오기는 계산으로 하는 일이라 크레딧을 매기지 않는다 */
    expect(chargeForJob("/plan/ingest").cost).toBe(0);
    expect(chargeForJob("/save").cost).toBe(0);
    expect(chargeForJob("/export").cost).toBe(0);
    expect(chargeForJob("").cost).toBe(0);
  });

  it("값이 붙은 작업에는 이름도 있다", () => {
    // 이름이 없으면 확인 창에 빈 제목이 뜬다
    for (const path of ["/render/final", "/render/preview", "/generate", "/generate-asset"]) {
      const charge = chargeForJob(path);
      expect(charge.cost).toBeGreaterThan(0);
      expect(charge.label.length).toBeGreaterThan(0);
    }
  });
});

describe("서버와 화면이 같은 표를 본다", () => {
  it("서버 모듈이 config 의 표를 그대로 내보낸다", async () => {
    /*
     * 두 군데에 적어 두면 "2개 든다"고 물어보고 3개가 빠지는 일이 반드시 생긴다.
     * 서버는 config 를 다시 내보내기만 해야 한다.
     */
    const server = await import("@/lib/credits");
    expect(server.EDITOR_COST).toBe(EDITOR_COST);
  });
});
