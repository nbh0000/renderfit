"use client";

import { useEditorStore } from "@/lib/editor/store";

/**
 * 2안 비교.
 *
 * 두 방향으로 만든 시안을 나란히 놓고 고르게 한다.
 * 고르기 전에는 장면을 바꾸지 않으므로, 마음에 안 들면 그냥 닫으면 된다.
 */
export function VariantCompare() {
  const variants = useEditorStore((state) => state.variants);
  const setVariants = useEditorStore((state) => state.setVariants);
  const applyVariant = useEditorStore((state) => state.applyVariant);
  const busy = useEditorStore((state) => state.busy);

  if (!variants?.length) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#1b1a18]/85 p-5">
      <div className="w-full max-w-5xl">
        <div className="mb-3 flex items-center justify-between text-white">
          <div>
            <p className="text-[15px] font-medium">마음에 드는 시안을 고르세요</p>
            <p className="mt-0.5 text-[12px] text-white/60">
              고른 시안만 장면에 반영됩니다. 닫으면 아무것도 바뀌지 않습니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setVariants(null)}
            className="rounded-md bg-white/10 px-3 py-1.5 text-[12.5px] hover:bg-white/20"
          >
            닫기
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {variants.map((variant) => (
            <div
              key={variant.imageUrl}
              className="overflow-hidden rounded-[var(--radius-card)] border border-white/15 bg-[#26231f]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={variant.imageUrl} alt={variant.label} className="w-full" />

              <div className="flex items-center justify-between gap-2 p-2.5">
                <span className="text-[12.5px] text-white/80">{variant.label}</span>
                <span className="flex gap-1.5">
                  <a
                    href={variant.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-md bg-white/10 px-2.5 py-1 text-[12px] text-white hover:bg-white/20"
                  >
                    크게 보기
                  </a>
                  <button
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => void applyVariant(variant)}
                    className="rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                  >
                    이걸로
                  </button>
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
