"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEditorStore } from "@/lib/editor/store";

/**
 * 도면 파일 들여오기 — DXF·DWG·스캔 이미지.
 *
 * ── 왜 크롭을 사람에게 맡기나 ──
 *
 * 래스터(스캔·캡처) 도면의 정확도를 가장 크게 좌우하는 것은 알고리즘이 아니라
 * **어디를 도면으로 볼 것인가** 다. 표제란·범례·여백·다른 도면이 함께 들어오면
 * 벡터화 모델이 그 선까지 벽으로 읽는다. 자동으로 잘라 보려다 도면 한 귀퉁이를
 * 날리는 것보다, 사용자가 5초 끌어 주는 편이 훨씬 정확하다.
 *
 * 잡은 사각형은 서버가 잡(plan_ingest_jobs.crop)에 남긴다 — 다시 돌릴 때 같은 자리에서
 * 시작하고, 결과가 이상할 때 "어디를 도면으로 봤나" 를 되짚을 수 있다.
 *
 * DXF·DWG 는 크롭이 없다. 좌표가 파일 안에 그대로 있어 자를 것이 없다.
 */

/** 원본 이미지 픽셀 기준 사각형 (왼쪽 위가 원점 — 화면 좌표계다) */
type Rect = { x: number; y: number; width: number; height: number };

type Summary = {
  rooms: number;
  walls: number;
  openings: number;
  fixtures: number;
  flags: number;
  /* 검수 화면 주소. 여기를 지나야 편집기·3D 로 넘어간다 */
  reviewUrl: string;
};

export function PlanImport({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const projectId = useEditorStore((state) => state.projectId);

  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [dragging, setDragging] = useState<{ x: number; y: number } | null>(null);
  /*
   * 화면에 그려진 그림이 원본의 몇 배인가.
   *
   * 그릴 때 ref 로 직접 재면 안 된다 — 렌더 도중 DOM 을 읽는 셈이라 React 가 막는다.
   * 그림이 뜬 순간과 끌기 시작하는 순간에 재서 들고 있는다.
   */
  const [scale, setScale] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  const isImage = Boolean(file && file.type.startsWith("image/"));

  const pick = (chosen: File | undefined | null) => {
    if (!chosen) return;
    if (preview) URL.revokeObjectURL(preview);

    setFile(chosen);
    setCrop(null);
    setError(null);
    setSummary(null);
    setPreview(chosen.type.startsWith("image/") ? URL.createObjectURL(chosen) : null);
  };

  /* 화면 좌표 → 원본 이미지 픽셀. 잡에 남는 값은 언제나 원본 기준이어야 한다 */
  const toNatural = (event: React.PointerEvent<HTMLDivElement>) => {
    const image = imageRef.current;
    if (!image) return null;

    const box = image.getBoundingClientRect();
    const scale = image.naturalWidth / box.width;

    return {
      x: Math.max(0, Math.min(image.naturalWidth, (event.clientX - box.left) * scale)),
      y: Math.max(0, Math.min(image.naturalHeight, (event.clientY - box.top) * scale)),
    };
  };

  const send = async () => {
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (projectId) form.append("projectId", projectId);

      /*
       * 크롭은 이미지일 때만, 그것도 사용자가 실제로 끈 경우에만 보낸다.
       * 반쯤 잡힌 사각형을 보내면 엉뚱한 자리를 도면으로 삼는다.
       */
      if (crop && crop.width > 8 && crop.height > 8) {
        form.append("cropX", String(Math.round(crop.x)));
        form.append("cropY", String(Math.round(crop.y)));
        form.append("cropWidth", String(Math.round(crop.width)));
        form.append("cropHeight", String(Math.round(crop.height)));
      }

      const response = await fetch("/api/plan/ingest", { method: "POST", body: form });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? data.message ?? "도면을 읽지 못했습니다.");
      }

      const doc = data.doc as {
        rooms: unknown[];
        walls: unknown[];
        openings: unknown[];
        fixtures: unknown[];
        review: { flags: unknown[] };
      };

      setSummary({
        rooms: doc.rooms.length,
        walls: doc.walls.length,
        openings: doc.openings.length,
        fixtures: doc.fixtures.length,
        flags: doc.review.flags.length,
        reviewUrl: String(data.reviewUrl ?? ""),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "도면을 읽지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0a0a0a]/92 p-6">
      <div className="w-full max-w-lg rounded-[var(--radius-card)] border border-line bg-surface p-6">
        <h2 className="text-[17px] font-semibold">도면 파일 들여오기</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          DXF/DWG 원본을 올리면 가장 정확합니다. 이미지·PDF는 검수 단계가 필요합니다.
        </p>

        {!file && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="mt-5 h-11 w-full rounded-lg bg-accent text-[14px] font-medium text-white hover:bg-accent-hover"
          >
            파일 선택
          </button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".dxf,.dwg,image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(event) => pick(event.target.files?.[0])}
        />

        {file && (
          <p className="mt-4 truncate text-[12.5px] text-ink-soft">
            {file.name}
            <button
              type="button"
              className="ml-2 text-accent hover:underline"
              onClick={() => fileRef.current?.click()}
            >
              바꾸기
            </button>
          </p>
        )}

        {/* ── 크롭 ── */}
        {isImage && preview && (
          <div className="mt-3">
            {/*
              바깥이 아니라 **그림에 딱 맞는 상자**를 끌게 한다.

              한때 object-contain 으로 넓게 깔았더니, 위아래 여백까지 상자에 들어가
              화면 좌표를 원본 픽셀로 옮길 때 그 여백만큼 어긋났다. 도면 영역이 통째로
              밀려 잡히는 셈이라, 그림 크기 그대로인 상자를 만들어 그 안에서만 끈다.
            */}
            <div className="flex justify-center rounded-md border border-line bg-sunken p-2">
            <div
              className="relative select-none"
              onPointerDown={(event) => {
                const image = imageRef.current;
                if (image) setScale(image.getBoundingClientRect().width / image.naturalWidth);

                const point = toNatural(event);
                if (!point) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging(point);
                setCrop({ x: point.x, y: point.y, width: 0, height: 0 });
              }}
              onPointerMove={(event) => {
                if (!dragging) return;
                const point = toNatural(event);
                if (!point) return;
                setCrop({
                  x: Math.min(dragging.x, point.x),
                  y: Math.min(dragging.y, point.y),
                  width: Math.abs(point.x - dragging.x),
                  height: Math.abs(point.y - dragging.y),
                });
              }}
              onPointerUp={() => setDragging(null)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imageRef}
                src={preview}
                alt="올린 도면"
                draggable={false}
                className="block max-h-64 max-w-full"
                onLoad={(event) => {
                  const image = event.currentTarget;
                  setScale(image.getBoundingClientRect().width / image.naturalWidth);
                }}
              />

              {crop && crop.width > 0 && (
                <div
                  className="pointer-events-none absolute border-2 border-accent bg-accent/10"
                  style={{
                    left: crop.x * scale,
                    top: crop.y * scale,
                    width: crop.width * scale,
                    height: crop.height * scale,
                  }}
                />
              )}
            </div>
            </div>

            <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-muted">
              <span>
                {crop && crop.width > 8
                  ? `도면 영역 ${Math.round(crop.width)} × ${Math.round(crop.height)}px`
                  : "그림 위에서 도면 부분을 끌어 주세요 (건너뛰면 전체를 도면으로 봅니다)"}
              </span>
              {crop && (
                <button type="button" className="text-accent hover:underline" onClick={() => setCrop(null)}>
                  지우기
                </button>
              )}
            </div>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-md bg-sunken px-3 py-2 text-[12px] leading-relaxed text-danger">
            {error}
          </p>
        )}

        {summary && (
          <div className="mt-4 rounded-md bg-sunken px-3 py-2 text-[12px] leading-relaxed text-ink-soft">
            실 {summary.rooms}개 · 벽 {summary.walls}개 · 개구부 {summary.openings}개 · 설비{" "}
            {summary.fixtures}개를 읽었습니다.
            {/*
              자동 결과는 절대 확정하지 않는다. 읽은 것을 편집기에 바로 얹지 않고,
              사람이 검수 화면에서 확인을 눌러야 넘어간다.
            */}
            <br />
            확인이 필요한 곳 {summary.flags}군데를 표시해 두었습니다. 검수 화면에서 고치고
            확인을 누르면 편집기로 넘어갑니다.
          </div>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => {
              if (preview) URL.revokeObjectURL(preview);
              onClose();
            }}
            className="h-10 flex-1 rounded-lg border border-line text-[13px] hover:bg-sunken"
          >
            {summary ? "닫기" : "취소"}
          </button>
          {summary?.reviewUrl ? (
            <button
              type="button"
              onClick={() => {
                if (preview) URL.revokeObjectURL(preview);
                router.push(summary.reviewUrl);
              }}
              className="h-10 flex-1 rounded-lg bg-accent text-[13px] font-medium text-white hover:bg-accent-hover"
            >
              검수하러 가기
            </button>
          ) : (
            <button
              type="button"
              disabled={!file || busy}
              onClick={() => void send()}
              className="h-10 flex-1 rounded-lg bg-accent text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? "읽는 중…" : "들여오기"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
