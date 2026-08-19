import { AppSidebar, MobileTopBar, type SidebarKey } from "./AppSidebar";

/**
 * 앱 공통 레이아웃 — 왼쪽 고정 내비게이션 + 본문.
 * 편집기는 전체 화면을 쓰므로 이 셸을 쓰지 않는다.
 */
export function AppShell({
  active,
  authed,
  right,
  children,
}: {
  active?: SidebarKey;
  authed?: boolean;
  /** 우상단에 붙일 요소 (크레딧 배지 등) */
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh bg-canvas">
      <AppSidebar active={active} authed={authed} />

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar authed={authed} />

        {right && (
          <div className="flex h-14 shrink-0 items-center justify-end gap-2 border-b border-line px-4 text-[13px] text-ink-soft sm:px-6">
            {right}
          </div>
        )}

        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
