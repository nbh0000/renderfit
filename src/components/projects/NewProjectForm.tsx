"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/Toast";

export function NewProjectForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setSaving(true);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "프로젝트를 만들지 못했습니다.");
      setName("");
      router.refresh();
      toast(`'${trimmed}' 프로젝트를 만들었습니다`, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "프로젝트를 만들지 못했습니다.", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className={compact ? "flex gap-2" : "flex w-full max-w-sm gap-2"}>
      <input
        type="text"
        value={name}
        maxLength={60}
        placeholder="프로젝트 이름 (예: 마포 래미안 24평)"
        onChange={(e) => setName(e.target.value)}
        className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm"
      />
      <button
        type="submit"
        disabled={saving || !name.trim()}
        className="h-10 shrink-0 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
      >
        만들기
      </button>
    </form>
  );
}
