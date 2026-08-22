"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalAssetsTab } from "./ExternalAssetsTab";
import { GenerateAssetBox } from "./GenerateAssetBox";
import { useEditorStore, useSelectedObject } from "@/lib/editor/store";
import type { Asset } from "@/scene/types";
import { DEFAULT_MATERIALS } from "@/models/materials";
import { STYLE_PRESETS } from "@/models/styles";

type Tab = "assets" | "external" | "materials" | "styles" | "lighting" | "ai";

const TABS: { id: Tab; label: string }[] = [
  { id: "assets", label: "가구" },
  { id: "external", label: "무료" },
  { id: "materials", label: "재질" },
  { id: "styles", label: "스타일" },
  { id: "lighting", label: "조명" },
  { id: "ai", label: "AI" },
];

export function AssetsPanel() {
  const [tab, setTab] = useState<Tab>("assets");

  return (
    <div className="flex h-full flex-col">
      <div className="scrollbar-slim flex shrink-0 gap-0.5 overflow-x-auto border-b border-line px-2 py-1.5">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={[
              "shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-[11.5px] transition-colors",
              tab === item.id ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink",
            ].join(" ")}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="scrollbar-slim flex-1 overflow-y-auto">
        {tab === "assets" && <AssetsTab />}
        {tab === "external" && <ExternalAssetsTab />}
        {tab === "materials" && <MaterialsTab />}
        {tab === "styles" && <StylesTab />}
        {tab === "lighting" && <LightingTab />}
        {tab === "ai" && <AIToolsTab />}
      </div>
    </div>
  );
}

/** 분류 목록 — 이름과 순서를 여기서 관리한다 */
const CATEGORIES: { id: string; label: string }[] = [
  { id: "sofa", label: "소파" },
  { id: "chair", label: "의자" },
  { id: "table", label: "테이블" },
  { id: "bed", label: "침대" },
  { id: "cabinet", label: "수납" },
  { id: "lamp", label: "조명" },
  { id: "appliance", label: "가전" },
  { id: "rug", label: "러그" },
  { id: "plant", label: "식물" },
  { id: "decoration", label: "소품" },
];

function AssetsTab() {
  const [query, setQuery] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>("sofa");
  const runTool = useEditorStore((state) => state.runTool);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        // 검색어가 없으면 전체를 받아 분류별로 나눈다.
        const response = await fetch("/api/assets/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, limit: query ? 24 : 200 }),
        });
        const data = (await response.json()) as { assets: Asset[] };
        if (!cancelled) setAssets(data.assets ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const grouped = useMemo(() => {
    const map = new Map<string, Asset[]>();
    for (const asset of assets) {
      const list = map.get(asset.category) ?? [];
      list.push(asset);
      map.set(asset.category, list);
    }
    return map;
  }, [assets]);

  const searching = query.trim().length > 0;

  return (
    <div className="p-2">
      <input
        type="search"
        value={query}
        placeholder="가구 검색 (예: 베이지 소파)"
        onChange={(event) => setQuery(event.target.value)}
        className="mb-2 h-8 w-full rounded-md border border-line bg-surface px-2 text-[12px]"
      />

      <div className="mb-2">
        <GenerateAssetBox />
      </div>

      {loading ? (
        <p className="py-6 text-center text-[12px] text-muted">불러오는 중…</p>
      ) : assets.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-muted">검색 결과가 없습니다.</p>
      ) : searching ? (
        <AssetGrid assets={assets} onAdd={runTool} />
      ) : (
        <ul className="space-y-0.5">
          {CATEGORIES.map((category) => {
            const items = grouped.get(category.id) ?? [];
            if (items.length === 0) return null;
            const expanded = open === category.id;

            return (
              <li key={category.id}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : category.id)}
                  className="flex w-full items-center justify-between rounded px-1.5 py-1.5 text-left text-[12px] hover:bg-sunken"
                >
                  <span className={expanded ? "font-medium text-ink" : "text-ink-soft"}>
                    {category.label}
                  </span>
                  <span className="flex items-center gap-1.5 text-[10.5px] text-muted">
                    {items.length}
                    <span className={expanded ? "rotate-90" : ""}>›</span>
                  </span>
                </button>

                {expanded && (
                  <div className="pb-1.5 pt-1">
                    <AssetGrid assets={items} onAdd={runTool} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-2 text-[10.5px] leading-relaxed text-muted">
        클릭하면 장면에 추가되고, 3D 뷰로 끌어다 놓으면 그 자리에 배치됩니다.
      </p>
    </div>
  );
}

function AssetGrid({
  assets,
  onAdd,
}: {
  assets: Asset[];
  onAdd: (tool: string, args: Record<string, unknown>) => unknown;
}) {
  return (
    <ul className="grid grid-cols-2 gap-1.5">
      {assets.map((asset) => (
        <li key={asset.id}>
          <button
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData("text/asset-id", asset.id);
              event.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() =>
              onAdd("add_object", { assetId: asset.id, type: asset.type, name: asset.name })
            }
            className="group w-full cursor-grab rounded-md border border-line p-1 text-left transition-colors hover:border-line-strong hover:bg-sunken active:cursor-grabbing"
            title={`${asset.name} — 클릭해서 추가하거나 3D 뷰로 끌어다 놓으세요`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset.thumbnailUrl ?? ""}
              alt=""
              className="aspect-square w-full rounded bg-sunken object-cover"
              loading="lazy"
            />
            <p className="mt-1 truncate text-[11px]">{asset.name}</p>
            <p className="truncate text-[10px] text-muted">
              {asset.dimensions.width}×{asset.dimensions.depth}mm
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
}

function MaterialsTab() {
  const selected = useSelectedObject();
  const runTool = useEditorStore((state) => state.runTool);

  return (
    <div className="p-2">
      <p className="mb-2 text-[11px] text-muted">
        {selected ? `${selected.name}에 적용` : "객체를 먼저 선택하세요"}
      </p>
      <ul className="grid grid-cols-3 gap-1.5">
        {DEFAULT_MATERIALS.map((material) => (
          <li key={material.id}>
            <button
              type="button"
              disabled={!selected}
              onClick={() =>
                selected && runTool("change_material", { objectId: selected.id, materialId: material.id })
              }
              className="w-full rounded-md border border-line p-1 text-left transition-colors hover:border-line-strong disabled:opacity-40"
            >
              <span
                className="block aspect-square w-full rounded"
                style={{ backgroundColor: material.baseColor }}
              />
              <span className="mt-1 block truncate text-[10.5px]">{material.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StylesTab() {
  const scene = useEditorStore((state) => state.scene);
  const startJob = useEditorStore((state) => state.startJob);
  const runTool = useEditorStore((state) => state.runTool);
  const [prompt, setPrompt] = useState("");

  return (
    <div className="p-2">
      <p className="mb-2 text-[11px] text-muted">스타일을 고르면 재질을 맞추고 AI 생성을 실행합니다.</p>

      <div className="mb-3 rounded-md border border-line p-2">
        <p className="text-[11.5px] font-medium">직접 지시 (선택)</p>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, 500))}
          rows={3}
          placeholder="예: 벽은 라임 워시 마감, 조명은 노을빛으로 따뜻하게"
          className="mt-1.5 w-full resize-none rounded border border-line bg-canvas px-2 py-1.5 text-[12px] leading-relaxed"
        />
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[10.5px] text-muted">{prompt.length}/500</span>
          <button
            type="button"
            disabled={!prompt.trim()}
            onClick={() => void startJob("/generate", { prompt: prompt.trim() })}
            className="rounded border border-line px-2 py-1 text-[11px] text-ink-soft hover:bg-sunken disabled:opacity-40"
          >
            이 지시로 생성
          </button>
        </div>
      </div>

      <ul className="space-y-1.5">
        {STYLE_PRESETS.map((style) => (
          <li key={style.id}>
            <button
              type="button"
              onClick={async () => {
                await runTool("change_style", { styleId: style.id });
                await startJob("/generate", {
                  styleId: style.id,
                  prompt: prompt.trim() || undefined,
                });
              }}
              className={[
                "flex w-full items-center gap-2 rounded-md border p-2 text-left transition-colors",
                scene?.styleId === style.id
                  ? "border-accent bg-accent-soft"
                  : "border-line hover:bg-sunken",
              ].join(" ")}
            >
              <span className="flex shrink-0 overflow-hidden rounded">
                {style.palette.map((color) => (
                  <span key={color} className="h-7 w-3.5" style={{ backgroundColor: color }} />
                ))}
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-medium">{style.label}</span>
                <span className="block truncate text-[10.5px] text-muted">
                  {style.aliases[0]}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LightingTab() {
  const scene = useEditorStore((state) => state.scene);
  const runTool = useEditorStore((state) => state.runTool);
  const lights = scene?.lights ?? [];

  return (
    <div className="space-y-3 p-2">
      {lights.map((light) => (
        <section key={light.id} className="rounded-md border border-line p-2">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-medium">{light.name}</p>
            <span className="text-[10.5px] text-muted">{light.type}</span>
          </div>

          <label className="mt-2 block text-[11px] text-muted">
            밝기 {light.intensity.toFixed(2)}
            <input
              type="range"
              min={0}
              max={3}
              step={0.05}
              value={light.intensity}
              onChange={(event) =>
                runTool("change_lighting", {
                  lightId: light.id,
                  intensity: Number(event.target.value),
                })
              }
              className="mt-1 w-full accent-[var(--color-accent)]"
            />
          </label>

          <label className="mt-2 block text-[11px] text-muted">
            색온도 {light.temperature}K
            <input
              type="range"
              min={2200}
              max={6500}
              step={100}
              value={light.temperature}
              onChange={(event) =>
                runTool("change_lighting", {
                  lightId: light.id,
                  temperature: Number(event.target.value),
                })
              }
              className="mt-1 w-full accent-[var(--color-accent)]"
            />
          </label>
        </section>
      ))}
    </div>
  );
}

function AIToolsTab() {
  const startJob = useEditorStore((state) => state.startJob);
  const selected = useSelectedObject();
  const scene = useEditorStore((state) => state.scene);
  const hasImage = Boolean(scene?.source?.imageUrl);

  const tools = useMemo(
    () => [
      {
        label: "공간 다시 분석",
        description: "사진에서 객체와 깊이를 다시 인식합니다.",
        disabled: !hasImage,
        run: () => startJob("/analyze"),
      },
      {
        label: "현재 스타일로 재생성",
        description: "Scene 구성을 유지한 채 이미지를 다시 만듭니다.",
        disabled: !hasImage,
        run: () => startJob("/generate", {}),
      },
      {
        label: "선택 영역 다시 그리기",
        description: selected ? `${selected.name} 영역만 인페인팅합니다.` : "객체를 먼저 선택하세요.",
        disabled: !selected || !hasImage,
        run: () => startJob("/generate", { prompt: `${selected?.name} 영역을 자연스럽게 다시 그린다.` }),
      },
    ],
    [hasImage, selected, startJob]
  );

  return (
    <div className="space-y-1.5 p-2">
      {tools.map((tool) => (
        <button
          key={tool.label}
          type="button"
          disabled={tool.disabled}
          onClick={() => void tool.run()}
          className="w-full rounded-md border border-line p-2 text-left transition-colors hover:bg-sunken disabled:opacity-45"
        >
          <p className="text-[12px] font-medium">{tool.label}</p>
          <p className="mt-0.5 text-[10.5px] leading-relaxed text-muted">{tool.description}</p>
        </button>
      ))}
    </div>
  );
}
