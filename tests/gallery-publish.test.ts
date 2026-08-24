import { describe, expect, it, vi } from "vitest";
import { publishResult, unpublishResultById } from "@/lib/gallery";

/**
 * 갤러리 공개가 늘 실패하던 문제.
 *
 * profile-lockdown 에서 사용자가 credits·status 를 고쳐 쓰지 못하게
 * generation_results 의 UPDATE 권한을 거둬들였는데, 갤러리 공개도 그 표를 고치는
 * 일이라 함께 막혔다. 그래서 쓰기는 서비스 롤로 하고 소유 확인은 우리가 직접 한다.
 *
 * 여기서 보는 것은 두 가지다.
 *   · 갱신에 user_id 조건이 반드시 붙는가 (남의 시안을 공개하지 못하게)
 *   · 고쳐진 행이 없을 때 실패로 돌려주는가
 *
 * 두 번째가 특히 중요하다. 권한이 없어 0행이 고쳐져도 Postgres 는 오류를 내지 않는다.
 * 그것을 성공으로 읽으면 "공개했습니다"라고 해 놓고 갤러리에는 아무것도 없다 —
 * 사용자가 원인을 알 수 없는 종류의 실패다.
 */

/** update(...).eq(...).eq(...).select(...) 를 흉내 내고 무엇이 오갔는지 기록한다 */
function fakeWriter(reply: { data?: unknown[]; error?: { code?: string; message: string } }) {
  const calls: { patch: Record<string, unknown>; where: Record<string, unknown> }[] = [];

  const client = {
    from() {
      const where: Record<string, unknown> = {};
      let patch: Record<string, unknown> = {};

      const chain = {
        update(next: Record<string, unknown>) {
          patch = next;
          return chain;
        },
        eq(column: string, value: unknown) {
          where[column] = value;
          return chain;
        },
        select() {
          calls.push({ patch, where });
          return Promise.resolve(reply);
        },
        // select() 없이 끝나는 호출(공개 해제)도 받아 준다
        then(resolve: (value: unknown) => void) {
          calls.push({ patch, where });
          resolve(reply);
        },
      };

      return chain;
    },
  };

  return { client: client as never, calls };
}

describe("갤러리 공개", () => {
  it("내 것만 공개되도록 user_id 조건을 붙인다", async () => {
    const { client, calls } = fakeWriter({ data: [{ id: "r1" }] });

    const result = await publishResult(client, "r1", "u1", "living", "modern");

    expect(result).not.toBeNull();
    expect(calls[0].where).toEqual({ id: "r1", user_id: "u1" });
    expect(calls[0].patch).toMatchObject({ is_public: true });
  });

  it("고쳐진 행이 없으면 성공으로 돌려주지 않는다", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeWriter({ data: [] });

    // 권한이 없어 0행이 고쳐진 상황. Postgres 는 오류를 내지 않는다.
    expect(await publishResult(client, "r1", "u1", "living", "modern")).toBeNull();
    warn.mockRestore();
  });

  it("slug 가 겹치면 다음 후보로 넘어간다", async () => {
    let attempt = 0;

    // 첫 시도는 중복, 두 번째는 성공하는 writer
    const writer = {
      from() {
        const where: Record<string, unknown> = {};
        let patch: Record<string, unknown> = {};
        const chain = {
          update(next: Record<string, unknown>) {
            patch = next;
            return chain;
          },
          eq(column: string, value: unknown) {
            where[column] = value;
            return chain;
          },
          select() {
            attempt += 1;
            return Promise.resolve(
              attempt === 1
                ? { data: null, error: { code: "23505", message: "duplicate key" } }
                : { data: [{ id: "r1", slug: patch.slug }], error: null }
            );
          },
        };
        return chain;
      },
    };

    const result = await publishResult(writer as never, "r1", "u1", "living", "modern");
    expect(result?.slug).toMatch(/-2$/);
  });

  it("공개 해제도 내 것만 건드린다", async () => {
    const { client, calls } = fakeWriter({ error: undefined });

    await unpublishResultById(client, "r1", "u1");

    expect(calls[0].where).toEqual({ id: "r1", user_id: "u1" });
    expect(calls[0].patch).toEqual({ is_public: false, slug: null });
  });
});
