"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useEditorStore } from "@/lib/editor/store";

/**
 * 크레딧이 나가기 전에 묻는다.
 *
 * 편집기의 AI 기능은 누르면 곧바로 크레딧이 빠졌다. 실사 렌더 한 번에 2개가 나가는데도
 * 누르기 전에는 얼마가 드는지 알 수 없었고, 잘못 눌러도 되돌릴 방법이 없었다.
 * 남의 돈이 걸린 일은 묻고 나서 한다.
 *
 * 잔액은 창을 열 때 서버에서 새로 받는다. 편집기가 들고 있는 값을 쓰면 다른 탭에서
 * 쓴 것을 모르고, "남은 5개"라고 띄운 뒤 모자라서 실패하는 일이 생긴다.
 */
export function ConfirmCharge() {
  const pending = useEditorStore((state) => state.pendingCharge);
  const confirm = useEditorStore((state) => state.confirmCharge);
  const cancel = useEditorStore((state) => state.cancelCharge);

  const [balance, setBalance] = useState<number | null>(null);
  const [working, setWorking] = useState(false);

  /* 창이 열릴 때마다 잔액을 새로 받는다 */
  useEffect(() => {
    if (!pending) {
      setBalance(null);
      setWorking(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch("/api/me", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { credits?: number | null };
        if (!cancelled && typeof data.credits === "number") setBalance(data.credits);
      } catch {
        // 잔액을 못 받아도 창은 뜬다 — 얼마 드는지만 알려 주고 진행 여부는 묻는다
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pending]);

  /* Esc 로 닫는다 — 확인 창은 닫는 길이 늘 있어야 한다 */
  useEffect(() => {
    if (!pending) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, cancel]);

  if (!pending) return null;

  /** 잔액을 아는데 모자라면, 눌러 봐야 실패한다 — 미리 막고 충전으로 보낸다 */
  const short = balance !== null && balance < pending.cost;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-4">
      <div className="w-full max-w-[320px] rounded-[var(--radius-card)] border border-line bg-surface p-4 shadow-lg">
        <p className="text-[13px] font-semibold text-ink">{pending.label}</p>

        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-soft">
          이 작업은 크레딧 <strong className="font-semibold text-ink">{pending.cost}개</strong>를
          씁니다.
          <br />
          {balance === null ? (
            <span className="text-muted">남은 크레딧을 확인하는 중입니다…</span>
          ) : (
            <>
              남은 크레딧{" "}
              <strong className={short ? "font-semibold text-red-600" : "font-semibold text-ink"}>
                {balance}개
              </strong>
              {short ? " — 모자랍니다." : "."}
            </>
          )}
        </p>

        <div className="mt-4 flex justify-end gap-1.5">
          <button
            type="button"
            onClick={cancel}
            className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-soft transition-colors hover:bg-sunken"
          >
            취소
          </button>

          {short ? (
            <Link
              href="/pricing"
              className="rounded-md bg-accent px-2.5 py-1.5 text-[12px] font-medium text-white"
            >
              크레딧 충전
            </Link>
          ) : (
            <button
              type="button"
              disabled={working}
              onClick={() => {
                setWorking(true);
                void confirm();
              }}
              className="rounded-md bg-accent px-2.5 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {working ? "시작하는 중…" : "진행"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
