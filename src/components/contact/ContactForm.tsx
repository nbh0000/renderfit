"use client";

import { useState } from "react";
import { useToast } from "@/components/ui/Toast";
import {
  BODY_MAX,
  INQUIRY_CATEGORIES,
  INQUIRY_STATUS_LABEL,
  SUBJECT_MAX,
  type Inquiry,
  type InquiryCategory,
} from "@/lib/inquiries";

interface Props {
  defaults: { name: string; email: string };
  /** 로그인한 사람이 전에 남긴 문의 — 답변이 달렸으면 여기서 본다 */
  mine: Inquiry[];
}

const field =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13.5px] leading-relaxed placeholder:text-muted/70";

export function ContactForm({ defaults, mine }: Props) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: defaults.name,
    email: defaults.email,
    category: "general" as InquiryCategory,
    subject: "",
    body: "",
  });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "문의를 보내지 못했습니다.");
      setSent(true);
    } catch (error) {
      toast(error instanceof Error ? error.message : "문의를 보내지 못했습니다.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {sent ? (
        <div className="mt-6 rounded-[var(--radius-card)] border border-line bg-sunken px-5 py-6">
          <p className="text-[15px] font-semibold">문의를 받았습니다</p>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
            확인하는 대로 <span className="font-medium text-ink">{form.email}</span> 로
            답변드리겠습니다.
          </p>
          <button
            type="button"
            onClick={() => {
              setSent(false);
              setForm((prev) => ({ ...prev, subject: "", body: "" }));
            }}
            className="mt-4 text-[13px] text-muted underline underline-offset-2 hover:text-ink"
          >
            다른 문의 남기기
          </button>
        </div>
      ) : (
        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-[12.5px] text-muted">
              이름
              <input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                required
                className={`${field} mt-1`}
              />
            </label>
            <label className="block text-[12.5px] text-muted">
              답변 받을 이메일
              <input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                required
                className={`${field} mt-1`}
              />
            </label>
          </div>

          <div className="text-[12.5px] text-muted">
            종류
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {INQUIRY_CATEGORIES.map((category) => {
                const active = form.category === category.id;
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => set("category", category.id)}
                    aria-pressed={active}
                    className={[
                      "rounded-full border px-3 py-1.5 text-[12.5px] transition-colors",
                      active
                        ? "border-ink bg-ink text-white"
                        : "border-line text-muted hover:border-line-strong hover:text-ink",
                    ].join(" ")}
                  >
                    {category.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block text-[12.5px] text-muted">
            제목
            <input
              value={form.subject}
              onChange={(e) => set("subject", e.target.value.slice(0, SUBJECT_MAX))}
              required
              className={`${field} mt-1`}
            />
          </label>

          <label className="block text-[12.5px] text-muted">
            내용
            <textarea
              value={form.body}
              onChange={(e) => set("body", e.target.value.slice(0, BODY_MAX))}
              rows={7}
              required
              placeholder="어떤 화면에서, 무엇을 했을 때, 어떻게 됐는지 적어 주시면 빨리 도와드릴 수 있습니다."
              className={`${field} mt-1 resize-y`}
            />
            <span className="mt-1 block text-right tabular-nums">
              {form.body.length}/{BODY_MAX}
            </span>
          </label>

          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-11 items-center rounded-lg bg-accent px-5 text-[14px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? "보내는 중…" : "문의 보내기"}
          </button>
        </form>
      )}

      {mine.length > 0 && (
        <section className="mt-12" aria-labelledby="my-inquiries">
          <h2 id="my-inquiries" className="text-[15px] font-semibold">
            내 문의
          </h2>
          <ul className="mt-3 divide-y divide-line">
            {mine.map((inquiry) => (
              <li key={inquiry.id} className="py-4">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[12px] text-muted">
                  <span
                    className={
                      inquiry.status === "answered"
                        ? "rounded-full bg-success/10 px-2 py-0.5 text-success"
                        : "rounded-full bg-sunken px-2 py-0.5"
                    }
                  >
                    {INQUIRY_STATUS_LABEL[inquiry.status]}
                  </span>
                  <span>{new Date(inquiry.createdAt).toLocaleDateString("ko-KR")}</span>
                </div>
                <p className="mt-1.5 text-[14px] font-medium">{inquiry.subject}</p>
                <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-soft">
                  {inquiry.body}
                </p>
                {inquiry.reply && (
                  <div className="mt-3 rounded-lg border-l-2 border-accent bg-sunken px-4 py-3">
                    <p className="text-[11.5px] font-medium text-muted">답변</p>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">
                      {inquiry.reply}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
