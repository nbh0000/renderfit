import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StudioClient } from "@/components/studio/StudioClient";
import { getViewer } from "@/lib/auth";
import { getPlan } from "@/config/plans";

export const metadata: Metadata = {
  title: "스튜디오",
  description: "사진·도면·스케치를 올려 구조를 유지한 인테리어 시안을 생성합니다.",
};

export default async function StudioPage() {
  const viewer = await getViewer();

  // Supabase가 연결돼 있으면 로그인 필수. 미설정이면 로컬 mock 모드로 열어 준다.
  if (viewer.configured && !viewer.userId) {
    redirect("/login?next=/studio");
  }

  const local = !viewer.configured;

  return (
    <StudioClient
      local={local}
      initialAccount={{
        plan: viewer.profile?.plan ?? "free",
        credits: viewer.profile?.credits ?? getPlan("free").monthlyCredits,
      }}
      user={
        viewer.profile
          ? {
              name: viewer.profile.fullName ?? viewer.profile.email ?? "사용자",
              avatarUrl: viewer.profile.avatarUrl,
            }
          : null
      }
    />
  );
}
