import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import { ContactForm } from "@/components/contact/ContactForm";
import { getViewer } from "@/lib/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { listMyInquiries, type Inquiry } from "@/lib/inquiries";
import { BUSINESS } from "@/config/business";

export const metadata: Metadata = {
  title: "문의하기",
  description: "이용·결제·환불·오류에 대해 문의를 남기면 확인 후 답변드립니다.",
};

export const dynamic = "force-dynamic";

export default async function ContactPage() {
  const viewer = await getViewer();

  let mine: Inquiry[] = [];
  if (isSupabaseConfigured() && viewer.userId) {
    const supabase = await createServerSupabase();
    if (supabase) mine = await listMyInquiries(supabase, viewer.userId);
  }

  return (
    <AppShell active="contact" authed={Boolean(viewer.userId)}>
      <main className="mx-auto max-w-[720px] px-4 py-10 sm:px-6">
        <h1 className="serif-display text-[26px] leading-tight sm:text-[30px]">문의하기</h1>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
          이용 방법, 결제·환불, 오류 신고 등 무엇이든 남겨 주세요. 확인하는 대로 적어 주신 이메일로
          답변드립니다.
          {BUSINESS.email ? ` 급한 문의는 ${BUSINESS.email} 로 보내 주셔도 됩니다.` : ""}
        </p>

        <ContactForm
          defaults={{
            name: viewer.profile?.fullName ?? "",
            email: viewer.profile?.email ?? viewer.authEmail ?? "",
          }}
          mine={mine}
        />
      </main>
    </AppShell>
  );
}
