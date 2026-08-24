"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * 페이지를 볼 때마다 한 번씩 남긴다.
 *
 * 관리자 대시보드의 방문 수가 여기서 나온다. `sendBeacon`을 쓰면 사용자가 곧바로
 * 페이지를 떠나도 기록이 날아가지 않고, 화면을 그리는 일도 막지 않는다.
 *
 * 같은 주소를 다시 그릴 때 두 번 세지 않도록 마지막 주소를 기억한다.
 */
export function PageViewTracker() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || last.current === pathname) return;
    last.current = pathname;

    const body = JSON.stringify({ name: "page_view", path: pathname });

    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
        return;
      }
      void fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        keepalive: true,
      });
    } catch {
      // 통계가 안 남는 것으로 사용자를 방해하지 않는다
    }
  }, [pathname]);

  return null;
}
