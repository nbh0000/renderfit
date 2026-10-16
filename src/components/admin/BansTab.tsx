"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import type { Ban, Violation } from "@/lib/bans";
import { VIOLATION_LABEL } from "@/lib/moderation";
import {
  Badge,
  Empty,
  SectionTitle,
  Table,
  buttonClass,
  call,
  dangerButtonClass,
  inputClass,
  when,
} from "./ui";

/**
 * 갤러리 차단 관리.
 *
 * 자동 차단은 필터가 걸리면 스스로 걸린다. 여기서는 그 목록을 보고 풀거나,
 * 필터에 안 걸렸지만 문제인 사람을 손으로 막는다. 위반 기록에서 '이 계정 차단'을
 * 누르면 계정과 IP 가 함께 채워진다.
 */

export function BansTab() {
  const { toast } = useToast();
  const [data, setData] = useState<{
    bans: Ban[];
    violations: Violation[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState("");
  const [ip, setIp] = useState("");
  const [reason, setReason] = useState("");
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setData(await call<{ bans: Ban[]; violations: Violation[] }>("/api/admin/bans"));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, []);

  const add = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await call("/api/admin/bans", {
        method: "POST",
        body: JSON.stringify({
          userId: userId || null,
          ip: ip || null,
          reason,
          days: days ? Number(days) : null,
        }),
      });
      toast("차단했습니다.", "success");
      setUserId("");
      setIp("");
      setReason("");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const lift = async (id: string) => {
    try {
      await call(`/api/admin/bans?id=${id}`, { method: "DELETE" });
      toast("해제했습니다.", "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    }
  };

  return (
    <div>
      <section>
        <SectionTitle>손으로 차단</SectionTitle>
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_160px_1fr_90px_auto]">
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="계정 id (uuid)"
            className={inputClass}
          />
          <input
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            placeholder="IP"
            className={inputClass}
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="사유"
            className={inputClass}
          />
          <input
            value={days}
            onChange={(e) => setDays(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="일수 (비우면 영구)"
            className={inputClass}
          />
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy || !reason.trim() || (!userId.trim() && !ip.trim())}
            className={dangerButtonClass}
          >
            차단
          </button>
        </div>
      </section>

      {error && <p className="mt-4 text-[13px] text-danger">{error}</p>}
      {!data && !error && <Empty>불러오는 중…</Empty>}

      {data && (
        <>
          <section className="mt-6">
            <SectionTitle>차단 중 ({data.bans.length})</SectionTitle>
            {data.bans.length === 0 && <Empty>차단된 계정·IP 가 없습니다.</Empty>}
            {data.bans.length > 0 && (
              <Table heads={["계정", "IP", "사유", "건 사람", "해제 시각", ""]} minWidth={720}>
                {data.bans.map((ban) => (
                  <tr key={ban.id} className="border-t border-line">
                    <td className="px-3 py-1.5 font-mono text-[11px]">{ban.userId ?? "—"}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">{ban.ip ?? "—"}</td>
                    <td className="px-3 py-1.5">{ban.reason}</td>
                    <td className="px-3 py-1.5">
                      {ban.createdBy === "auto" ? <Badge tone="warn">자동</Badge> : ban.createdBy}
                    </td>
                    <td className="px-3 py-1.5">{ban.expiresAt ? when(ban.expiresAt) : "영구"}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => void lift(ban.id)}
                        className={buttonClass}
                      >
                        해제
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </section>

          <section className="mt-8">
            <SectionTitle>최근 걸린 글 ({data.violations.length})</SectionTitle>
            {data.violations.length === 0 && <Empty>아직 걸린 글이 없습니다.</Empty>}
            {data.violations.length > 0 && (
              <Table heads={["시각", "종류", "계정", "IP", "내용", ""]} minWidth={760}>
                {data.violations.map((v) => (
                  <tr key={v.id} className="border-t border-line">
                    <td className="px-3 py-1.5">{when(v.createdAt)}</td>
                    <td className="px-3 py-1.5">
                      <Badge tone={v.kind === "ad" ? "warn" : "bad"}>
                        {VIOLATION_LABEL[v.kind] ?? v.kind}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">
                      {v.userId?.slice(0, 8) ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[11px]">{v.ip ?? "—"}</td>
                    <td className="max-w-[320px] truncate px-3 py-1.5 text-muted" title={v.body}>
                      {v.body}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setUserId(v.userId ?? "");
                          setIp(v.ip ?? "");
                          setReason(`${VIOLATION_LABEL[v.kind] ?? v.kind} 글`);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                        className={buttonClass}
                      >
                        이 계정 차단
                      </button>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
