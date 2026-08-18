import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlan, type PlanId } from "@/config/plans";
import { createServerSupabase } from "./supabase/server";
import { isSupabaseConfigured } from "./supabase/env";

export interface Profile {
  id: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  plan: PlanId;
  credits: number;
  periodStart: string;
}

export interface Viewer {
  /** Supabase가 연결돼 있는지 (아니면 로컬 mock 모드) */
  configured: boolean;
  userId: string | null;
  profile: Profile | null;
}

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  plan: string;
  credits: number;
  period_start: string;
}

function toProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    plan: getPlan(row.plan).id,
    credits: row.credits,
    periodStart: row.period_start,
  };
}

/** period_start로부터 한 달이 지났는지 (월 갱신, 이월 없음) */
function needsRenewal(periodStart: string): boolean {
  const start = new Date(periodStart);
  const due = new Date(start);
  due.setMonth(due.getMonth() + 1);
  return Date.now() >= due.getTime();
}

/**
 * 프로필을 읽고, 필요하면 월 크레딧을 갱신한다.
 * 프로필 행이 없으면(트리거 미설치 등) 새로 만든다.
 */
export async function loadProfile(
  supabase: SupabaseClient,
  userId: string,
  identity?: { email?: string | null; fullName?: string | null; avatarUrl?: string | null }
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url, plan, credits, period_start")
    .eq("id", userId)
    .maybeSingle();

  if (error) return null;

  let row = data as ProfileRow | null;

  if (!row) {
    const { data: created, error: insertError } = await supabase
      .from("profiles")
      .insert({
        id: userId,
        email: identity?.email ?? null,
        full_name: identity?.fullName ?? null,
        avatar_url: identity?.avatarUrl ?? null,
      })
      .select("id, email, full_name, avatar_url, plan, credits, period_start")
      .single();
    if (insertError || !created) return null;
    row = created as ProfileRow;
  }

  const profile = toProfile(row);
  const plan = getPlan(profile.plan);

  // 유료 플랜만 월 갱신 대상. 무료 플랜의 3장은 가입 시 1회 지급이다.
  if (plan.grant === "monthly" && needsRenewal(profile.periodStart)) {
    const { data: renewed, error: renewError } = await supabase.rpc("renew_credits", {
      p_amount: plan.monthlyCredits,
    });
    if (!renewError && typeof renewed === "number") {
      return { ...profile, credits: renewed, periodStart: new Date().toISOString() };
    }
  }

  return profile;
}

/** 서버 컴포넌트/라우트에서 현재 사용자를 읽는다. */
export async function getViewer(): Promise<Viewer> {
  if (!isSupabaseConfigured()) {
    return { configured: false, userId: null, profile: null };
  }

  const supabase = await createServerSupabase();
  if (!supabase) return { configured: false, userId: null, profile: null };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { configured: true, userId: null, profile: null };

  const profile = await loadProfile(supabase, user.id, {
    email: user.email,
    fullName: (user.user_metadata?.full_name as string | undefined) ?? null,
    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  });

  return { configured: true, userId: user.id, profile };
}
