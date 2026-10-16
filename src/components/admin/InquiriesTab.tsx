"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  INQUIRY_CATEGORIES,
  INQUIRY_STATUS_LABEL,
  type Inquiry,
  type InquiryStatus,
} from "@/lib/inquiries";
import { Badge, Empty, buttonClass, call, inputClass, primaryButtonClass, when } from "./ui";

/**
 * 문의 처리.
 *
 * 왼쪽 목록에서 고르면 오른쪽에 본문과 답변 칸이 열린다. 답변을 저장하면 상태가
 * '답변함'으로 넘어가고, 로그인해서 남긴 문의라면 고객이 /contact 에서 본다.
 * 이메일로도 보내야 하므로 답변 옆에 '메일 쓰기' 링크를 둔다 — 메일 발송 연동은
 * 아직 없다.
 */

const FILTERS: { id: InquiryStatus | "all"; label: string }[] = [
  { id: "open", label: "대기" },
  { id: "answered", label: "답변함" },
  { id: "closed", label: "종료" },
  { id: "all", label: "전체" },
];

const TONE: Record<InquiryStatus, "ok" | "warn" | "bad" | "muted"> = {
  open: "bad",
  answered: "ok",
  closed: "muted",
};

export function InquiriesTab({ onCountChange }: { onCountChange?: (open: number) => void }) {
  const { toast } = useToast();
  const [filter, setFilter] = useState<InquiryStatus | "all">("open");
  const [items, setItems] = useState<Inquiry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Inquiry | null>(null);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const data = await call<{ inquiries: Inquiry[] }>(`/api/admin/inquiries?status=${filter}`);
      setItems(data.inquiries);
      setError(null);
      if (filter === "open") onCountChange?.(data.inquiries.length);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    void (async () => {
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const open = (inquiry: Inquiry) => {
    setSelected(inquiry);
    setReply(inquiry.reply ?? "");
    setNote(inquiry.adminNote ?? "");
  };

  const save = async (patch: { reply?: string; adminNote?: string; status?: InquiryStatus }) => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const data = await call<{ inquiry: Inquiry }>(`/api/admin/inquiries/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setSelected(data.inquiry);
      toast("저장했습니다.", "success");
      await load();
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const categoryLabel = (id: string) => INQUIRY_CATEGORIES.find((c) => c.id === id)?.label ?? id;

  const mailto = selected
    ? `mailto:${selected.email}?subject=${encodeURIComponent(`[렌더핏] Re: ${selected.subject}`)}&body=${encodeURIComponent(reply)}`
    : "#";

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div>
        <div className="flex gap-1">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setSelected(null);
                setFilter(option.id);
              }}
              className={[
                "rounded-[var(--radius-control)] border px-2.5 py-1 text-[12px]",
                option.id === filter
                  ? "border-ink bg-ink text-surface"
                  : "border-line text-muted hover:text-ink",
              ].join(" ")}
            >
              {option.label}
            </button>
          ))}
        </div>

        {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}
        {!items && !error && <Empty>불러오는 중…</Empty>}
        {items && items.length === 0 && <Empty>문의가 없습니다.</Empty>}

        <ul className="mt-3 divide-y divide-line rounded-[var(--radius-card)] border border-line">
          {items?.map((inquiry) => (
            <li key={inquiry.id}>
              <button
                type="button"
                onClick={() => open(inquiry)}
                className={[
                  "block w-full px-3 py-2.5 text-left hover:bg-sunken/60",
                  selected?.id === inquiry.id ? "bg-sunken" : "",
                ].join(" ")}
              >
                <div className="flex items-center gap-2 text-[11px] text-muted">
                  <Badge tone={TONE[inquiry.status]}>{INQUIRY_STATUS_LABEL[inquiry.status]}</Badge>
                  <span>{categoryLabel(inquiry.category)}</span>
                  <span className="ml-auto">{when(inquiry.createdAt)}</span>
                </div>
                <p className="mt-1 truncate text-[13px] font-medium">{inquiry.subject}</p>
                <p className="truncate text-[11.5px] text-muted">
                  {inquiry.name} · {inquiry.email}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        {!selected && <Empty>문의를 고르면 내용이 여기 나옵니다.</Empty>}
        {selected && (
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted">
              <Badge tone={TONE[selected.status]}>{INQUIRY_STATUS_LABEL[selected.status]}</Badge>
              <span>{categoryLabel(selected.category)}</span>
              <span>{when(selected.createdAt)}</span>
              {selected.userId ? <span>회원</span> : <span>비회원</span>}
            </div>
            <h2 className="mt-2 text-[16px] font-semibold">{selected.subject}</h2>
            <p className="mt-1 text-[12.5px] text-muted">
              {selected.name} ·{" "}
              <a href={`mailto:${selected.email}`} className="underline">
                {selected.email}
              </a>
            </p>
            <p className="mt-4 whitespace-pre-wrap text-[13.5px] leading-relaxed">
              {selected.body}
            </p>

            <div className="mt-6">
              <label className="text-[12px] font-medium text-muted">
                답변
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={6}
                  placeholder="고객에게 보낼 답변"
                  className={`${inputClass} mt-1 w-full resize-y`}
                />
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void save({ reply })}
                  disabled={busy || !reply.trim()}
                  className={primaryButtonClass}
                >
                  답변 저장 (답변함으로)
                </button>
                <a href={mailto} className={buttonClass}>
                  이 답변으로 메일 쓰기
                </a>
              </div>
              <p className="mt-1.5 text-[11px] text-muted">
                회원 문의는 저장하면 고객의 문의 페이지에 답변이 보입니다. 비회원 문의는 메일로 보내
                주세요.
              </p>
            </div>

            <div className="mt-5">
              <label className="text-[12px] font-medium text-muted">
                내부 메모 (고객에게 보이지 않음)
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className={`${inputClass} mt-1 w-full resize-y`}
                />
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void save({ adminNote: note })}
                  disabled={busy}
                  className={buttonClass}
                >
                  메모 저장
                </button>
                {selected.status !== "closed" && (
                  <button
                    type="button"
                    onClick={() => void save({ status: "closed" })}
                    disabled={busy}
                    className={buttonClass}
                  >
                    종료
                  </button>
                )}
                {selected.status !== "open" && (
                  <button
                    type="button"
                    onClick={() => void save({ status: "open" })}
                    disabled={busy}
                    className={buttonClass}
                  >
                    다시 대기로
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
