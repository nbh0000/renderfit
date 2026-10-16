"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AdminDashboard } from "./AdminDashboard";
import { SettlementTab } from "./SettlementTab";
import { CustomersTab } from "./CustomersTab";
import { PaymentsTab } from "./PaymentsTab";
import { InquiriesTab } from "./InquiriesTab";
import { BansTab } from "./BansTab";

/**
 * 관리자 화면 — 탭 하나가 일 하나다.
 *
 * 주소의 ?tab= 으로 탭을 고른다. 카카오 알림에 실린 링크(/admin?tab=inquiries)로
 * 바로 문의 탭이 열려야 한다.
 */

export type AdminTab = "dashboard" | "settlement" | "customers" | "payments" | "inquiries" | "bans";

const TABS: { id: AdminTab; label: string }[] = [
  { id: "dashboard", label: "대시보드" },
  { id: "settlement", label: "정산" },
  { id: "customers", label: "고객" },
  { id: "payments", label: "결제·환불" },
  { id: "inquiries", label: "문의" },
  { id: "bans", label: "차단" },
];

function isTab(value: string | null): value is AdminTab {
  return TABS.some((tab) => tab.id === value);
}

export function AdminPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const fromUrl = params.get("tab");
  const [tab, setTab] = useState<AdminTab>(isTab(fromUrl) ? fromUrl : "dashboard");
  const [seenUrl, setSeenUrl] = useState(fromUrl);
  // 뒤로 가기로 주소가 바뀌면 탭도 따라간다 — 렌더 중에 맞춰 깜빡임을 없앤다
  if (fromUrl !== seenUrl) {
    setSeenUrl(fromUrl);
    if (isTab(fromUrl)) setTab(fromUrl);
    else if (fromUrl === null) setTab("dashboard");
  }
  const [openInquiries, setOpenInquiries] = useState<number | null>(null);

  /* 대기 중인 문의 수를 탭에 배지로 — 어느 탭에 있든 새 문의가 보이게 */
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const res = await fetch("/api/admin/inquiries?status=open", {
        cache: "no-store",
      }).catch(() => null);
      if (!res?.ok || !alive) return;
      const data = (await res.json()) as { inquiries: unknown[] };
      setOpenInquiries(data.inquiries.length);
    };
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tab]);

  const select = (next: AdminTab) => {
    setTab(next);
    router.replace(next === "dashboard" ? "/admin" : `/admin?tab=${next}`);
  };

  return (
    <main className="mx-auto max-w-[1180px] px-5 py-10 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[22px] font-semibold tracking-tight">관리자</h1>
        <nav aria-label="관리자 메뉴" className="flex flex-wrap gap-1">
          {TABS.map((item) => {
            const active = item.id === tab;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => select(item.id)}
                aria-current={active ? "page" : undefined}
                className={[
                  "inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-3 py-1.5 text-[12.5px]",
                  active
                    ? "border-ink bg-ink text-surface"
                    : "border-line text-muted hover:text-ink",
                ].join(" ")}
              >
                {item.label}
                {item.id === "inquiries" && openInquiries ? (
                  <span
                    className={[
                      "rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums",
                      active ? "bg-surface text-ink" : "bg-danger text-white",
                    ].join(" ")}
                  >
                    {openInquiries}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </header>

      <div className="mt-6">
        {tab === "dashboard" && <AdminDashboard />}
        {tab === "settlement" && <SettlementTab />}
        {tab === "customers" && <CustomersTab />}
        {tab === "payments" && <PaymentsTab />}
        {tab === "inquiries" && <InquiriesTab onCountChange={setOpenInquiries} />}
        {tab === "bans" && <BansTab />}
      </div>
    </main>
  );
}
