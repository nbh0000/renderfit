"use client";

import { useState } from "react";
import { PYEONG_PRESETS, SPACE_LIMITS } from "@/config/space";
import { normalizeSpaceSize, summarizeSpaceSize } from "@/lib/space";
import type { SpaceSize } from "@/lib/types";

/**
 * 공간 크기 입력.
 *
 * 평수(대략) 또는 실측 치수(mm) 중 하나로 받아 생성 프롬프트에 넘긴다.
 * 입력하지 않으면 크기 지시 없이 생성되므로, 기본은 꺼진 상태다.
 */
export function SpaceSizeInput({
  value,
  onChange,
}: {
  value: SpaceSize | null;
  onChange: (size: SpaceSize | null) => void;
}) {
  const [unit, setUnit] = useState<SpaceSize["unit"]>(value?.unit ?? "pyeong");
  const [pyeong, setPyeong] = useState(value?.pyeong ? String(value.pyeong) : "");
  const [width, setWidth] = useState(value?.width ? String(value.width) : "");
  const [length, setLength] = useState(value?.length ? String(value.length) : "");
  const [height, setHeight] = useState(value?.height ? String(value.height) : "");

  /** 입력값을 모아 상위로 올린다 (범위를 벗어나면 null → 크기 지정 없음) */
  const push = (next: {
    unit?: SpaceSize["unit"];
    pyeong?: string;
    width?: string;
    length?: string;
    height?: string;
  }) => {
    const merged = {
      unit: next.unit ?? unit,
      pyeong: Number(next.pyeong ?? pyeong),
      width: Number(next.width ?? width),
      length: Number(next.length ?? length),
      height: Number(next.height ?? height),
    };
    onChange(normalizeSpaceSize(merged));
  };

  const summary = value ? summarizeSpaceSize(value) : "";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex rounded-md border border-line p-0.5">
          {(
            [
              ["pyeong", "평수"],
              ["mm", "치수(mm)"],
            ] as [SpaceSize["unit"], string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setUnit(id);
                push({ unit: id });
              }}
              className={[
                "rounded px-2.5 py-1 text-[12px] transition-colors",
                unit === id ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>

        {summary ? (
          <span className="text-[11.5px] text-muted">{summary}</span>
        ) : (
          <span className="text-[11.5px] text-muted">선택 입력</span>
        )}
      </div>

      {unit === "pyeong" ? (
        <div className="space-y-1.5">
          <label className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              placeholder="예: 24"
              value={pyeong}
              min={SPACE_LIMITS.minPyeong}
              max={SPACE_LIMITS.maxPyeong}
              onChange={(event) => {
                setPyeong(event.target.value);
                push({ pyeong: event.target.value });
              }}
              className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-right text-[13px] tabular-nums"
            />
            <span className="shrink-0 text-[12px] text-muted">평</span>
          </label>

          <div className="flex flex-wrap gap-1">
            {PYEONG_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setPyeong(String(preset));
                  push({ pyeong: String(preset) });
                }}
                className={[
                  "rounded-md border px-2 py-1 text-[11.5px] transition-colors",
                  Number(pyeong) === preset
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-line text-muted hover:text-ink",
                ].join(" ")}
              >
                {preset}평
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <SizeField
            label="가로"
            value={width}
            placeholder="3600"
            onChange={(next) => {
              setWidth(next);
              push({ width: next });
            }}
          />
          <SizeField
            label="세로"
            value={length}
            placeholder="4200"
            onChange={(next) => {
              setLength(next);
              push({ length: next });
            }}
          />
        </div>
      )}

      <SizeField
        label="천장"
        value={height}
        placeholder="2400 (선택)"
        onChange={(next) => {
          setHeight(next);
          push({ height: next });
        }}
      />

      <p className="text-[11px] leading-relaxed text-muted">
        입력하면 그 면적에 실제로 들어가는 크기·개수로 가구를 배치합니다. 비워 두면 사진만 보고
        판단합니다.
      </p>
    </div>
  );
}

function SizeField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-7 shrink-0 text-[11.5px] text-muted">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-md border border-line bg-surface px-2.5 text-right text-[13px] tabular-nums"
      />
      <span className="shrink-0 text-[11.5px] text-muted">mm</span>
    </label>
  );
}
