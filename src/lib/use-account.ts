"use client";

import { useCallback, useEffect, useState } from "react";
import { getPlan, type PlanId } from "@/config/plans";
import type { AccountState } from "./types";

/**
 * 계정 상태 훅.
 * - Supabase 모드: 서버에서 받은 프로필을 기준으로 하고, 생성 후 /api/me로 동기화한다.
 * - 로컬 mock 모드: localStorage에 저장된 가짜 계정을 쓴다 (Supabase 미설정 개발용).
 */
const STORAGE_KEY = "interior-ai:mock-account";

function persistLocal(next: AccountState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* 저장소 접근 불가 시 무시 */
  }
}

export function useAccount({ local, initial }: { local: boolean; initial: AccountState }) {
  const [account, setAccount] = useState<AccountState>(initial);
  const [loaded, setLoaded] = useState(!local);

  useEffect(() => {
    if (!local) return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setAccount(JSON.parse(saved) as AccountState);
    } catch {
      /* 기본값 유지 */
    }
    setLoaded(true);
  }, [local]);

  /** 서버 잔액과 동기화 (Supabase 모드 전용) */
  const refresh = useCallback(async () => {
    if (local) return;
    try {
      const res = await fetch("/api/me", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { plan: PlanId | null; credits: number | null };
      if (data.plan && typeof data.credits === "number") {
        setAccount({ plan: data.plan, credits: data.credits });
      }
    } catch {
      /* 네트워크 오류는 다음 갱신에서 회복된다 */
    }
  }, [local]);

  const spend = useCallback(
    (amount: number) => {
      setAccount((prev) => {
        const next = { ...prev, credits: Math.max(0, prev.credits - amount) };
        if (local) persistLocal(next);
        return next;
      });
    },
    [local]
  );

  const refund = useCallback(
    (amount: number) => {
      setAccount((prev) => {
        const next = { ...prev, credits: prev.credits + amount };
        if (local) persistLocal(next);
        return next;
      });
    },
    [local]
  );

  /** 로컬 mock 모드에서만 쓰는 플랜 전환 (개발용) */
  const switchPlan = useCallback(
    (plan: PlanId) => {
      if (!local) return;
      const next = { plan, credits: getPlan(plan).monthlyCredits };
      persistLocal(next);
      setAccount(next);
    },
    [local]
  );

  return { account, loaded, spend, refund, switchPlan, refresh };
}
