"use client";

import { useState } from "react";
import { useEditorStore } from "@/lib/editor/store";
import { useToast } from "@/components/ui/Toast";

/**
 * 없는 가구를 만들어 쓴다.
 *
 * 카탈로그에 없는 물건은 검색해도 나오지 않아서 그 자리에서 막힌다.
 * 설명을 적으면 AI가 가구 사진을 만들고, 편집기가 그 실루엣을 3D 씬에 세운다.
 * (텍스트로 메시를 빚는 것이 아니라 이미지를 만들어 세우는 방식이다)
 */
const EXAMPLES = ["우드 원형 4인 식탁", "라탄 라운지 체어", "블랙 스틸 책장"];

export function GenerateAssetBox() {
  const generateAsset = useEditorStore((state) => state.generateAsset);
  const busy = useEditorStore((state) => state.busy);
  const { toast } = useToast();
  const [description, setDescription] = useState("");

  const working = Boolean(busy);

  const submit = async (text: string) => {
    const value = text.trim();
    if (!value || working) return;

    const result = await generateAsset(value);
    toast(result.message, result.ok ? "success" : "error");
    if (result.ok) setDescription("");
  };

  return (
    <div className="rounded-md border border-line bg-sunken/60 p-2">
      <p className="mb-1.5 text-[11.5px] font-medium text-ink">찾는 가구가 없나요?</p>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit(description);
        }}
        className="flex gap-1"
      >
        <input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="만들 가구를 설명해 주세요"
          maxLength={200}
          disabled={working}
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-[12px] disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={working || !description.trim()}
          className="h-8 shrink-0 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-40"
        >
          {working ? "만드는 중…" : "만들기"}
        </button>
      </form>

      <div className="mt-1.5 flex flex-wrap gap-1">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            disabled={working}
            onClick={() => void submit(example)}
            className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-muted hover:border-line-strong hover:text-ink disabled:opacity-40"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}
