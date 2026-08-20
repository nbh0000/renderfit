"use client";

import { useState } from "react";
import { useEditorStore } from "@/lib/editor/store";
import type { Asset } from "@/scene/types";

/**
 * 무료 3D 모델 검색.
 *
 * 내장 카탈로그 76종으로는 실제 배치가 안 되므로 외부 무료 소스(Poly Pizza)를 붙인다.
 * CC-BY 모델은 저작자 표시가 필요해서, 넣을 때 표기 문구를 Scene에 같이 저장한다.
 */

type ExternalAsset = Asset & { attribution?: string; license?: string; sourceUrl?: string };

export function ExternalAssetsTab() {
  const runTool = useEditorStore((state) => state.runTool);

  const [query, setQuery] = useState("");
  const [assets, setAssets] = useState<ExternalAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setNotice(null);

    try {
      const res = await fetch(`/api/assets/external?q=${encodeURIComponent(query)}`);
      const data = await res.json();

      if (data.enabled === false) {
        setNotice(data.message);
        setAssets([]);
        return;
      }

      setAssets(data.assets ?? []);
      if ((data.assets ?? []).length === 0) setNotice("검색 결과가 없습니다.");
    } catch {
      setNotice("모델을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const place = async (asset: ExternalAsset) => {
    const result = await runTool("add_object", {
      type: asset.type,
      name: asset.name,
      modelUrl: asset.modelUrl,
      attribution: asset.attribution,
      widthMm: asset.dimensions.width,
      heightMm: asset.dimensions.height,
      depthMm: asset.dimensions.depth,
    });
    setNotice(result.message);
  };

  return (
    <div className="space-y-2 p-2">
      <div className="flex gap-1">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && void search()}
          placeholder="예: sofa, dining chair, floor lamp"
          className="h-8 w-full rounded border border-line bg-surface px-2 text-[12px] outline-none"
        />
        <button
          type="button"
          onClick={() => void search()}
          disabled={loading}
          className="h-8 shrink-0 rounded bg-ink px-2.5 text-[11.5px] text-white disabled:opacity-50"
        >
          {loading ? "검색 중" : "검색"}
        </button>
      </div>

      <p className="text-[10.5px] leading-relaxed text-muted">
        무료 라이선스(CC0·CC-BY) 모델을 찾아 바로 배치합니다. 넣으면 3D에 실제 모델로 보이고,
        치수는 가구 목록에서 mm로 맞출 수 있습니다.
      </p>

      {notice && <p className="text-[10.5px] leading-relaxed text-accent">{notice}</p>}

      <div className="grid grid-cols-2 gap-1.5">
        {assets.map((asset) => (
          <button
            key={asset.id}
            type="button"
            onClick={() => void place(asset)}
            className="group overflow-hidden rounded border border-line bg-surface text-left hover:border-line-strong"
            title={asset.attribution}
          >
            <span className="block aspect-square bg-sunken">
              {asset.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={asset.thumbnailUrl}
                  alt={asset.name}
                  loading="lazy"
                  className="h-full w-full object-contain"
                />
              )}
            </span>
            <span className="block truncate px-1.5 py-1 text-[10.5px] text-ink-soft group-hover:text-ink">
              {asset.name}
            </span>
            {asset.license && (
              <span className="block truncate px-1.5 pb-1 text-[9.5px] text-muted">
                {asset.license}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
