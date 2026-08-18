"use client";

import { useEffect, useMemo, useState } from "react";
import { useEditorStore, useSelectedObject } from "@/lib/editor/store";
import type { Asset } from "@/scene/types";
import { DEFAULT_MATERIALS } from "@/models/materials";
import { STYLE_PRESETS } from "@/models/styles";

type Tab = "assets" | "materials" | "styles" | "lighting" | "ai";

const TABS: { id: Tab; label: string }[] = [
  { id: "assets", label: "에셋" },
  { id: "materials", label: "재질" },
  { id: "styles", label: "스타일" },
  { id: "lighting", label: "조명" },
  { id: "ai", label: "AI" },
];

export function AssetsPanel() {
  const [tab, setTab] = useState<Tab>("assets");

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-0.5 border-b border-line px-2 py-1.5">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={[
              "rounded-md px-2 py-1 text-[11.5px] transition-colors",
              tab === item.id ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink",
            ].join(" ")}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="scrollbar-slim flex-1 overflow-y-auto">
        {tab === "assets" && <AssetsTab />}
        {tab === "materials" && <MaterialsTab />}
        {tab === "styles" && <StylesTab />}
        {tab === "lighting" && <LightingTab />}
        {tab === "ai" && <AIToolsTab />}
      </div>
    </div>
  );
}

function AssetsTab() {
  const [query, setQuery] = useState("");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const runTool = useEditorStore((state) => state.runTool);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/assets/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, limit: 24 }),
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

  return (
    <div className="p-2">
      <input
        type="search"
        value={query}
        placeholder="예: 따뜻한 베이지 소파"
        onChange={(event) => setQuery(event.target.value)}
        className="mb-2 h-8 w-full rounded-md border border-line bg-surface px-2 text-[12px]"
      />

      {loading ? (
        <p className="py-6 text-center text-[12px] text-muted">불러오는 중…</p>
      ) : assets.length === 0 ? (
        <p className="py-6 text-center text-[12px] text-muted">검색 결과가 없습니다.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-1.5">
          {assets.map((asset) => (
            <li key={asset.id}>
              <button
                type="button"
                onClick={() => runTool("add_object", { assetId: asset.id, type: asset.type, name: asset.name })}
                className="group w-full rounded-md border border-line p-1 text-left transition-colors hover:border-line-strong hover:bg-sunken"
                title={`${asset.name} 추가`}
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
      )}
    </div>
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

  return (
    <div className="p-2">
      <p className="mb-2 text-[11px] text-muted">스타일을 고르면 재질을 맞추고 AI 생성을 실행합니다.</p>
      <ul className="space-y-1.5">
        {STYLE_PRESETS.map((style) => (
          <li key={style.id}>
            <button
              type="button"
              onClick={async () => {
                await runTool("change_style", { styleId: style.id });
                await startJob("/generate", { styleId: style.id });
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
