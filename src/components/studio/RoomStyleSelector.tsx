"use client";

import { ROOMS, type RoomId } from "@/config/rooms";
import { STYLES, type StyleId } from "@/config/styles";
import type { UploadValue } from "./Uploader";
import { useRef } from "react";
import { validateImageFile } from "@/lib/upload";

interface Props {
  roomId: RoomId;
  onRoomChange: (id: RoomId) => void;
  styleId: StyleId;
  onStyleChange: (id: StyleId) => void;
  reference: UploadValue | null;
  onReferenceChange: (value: UploadValue | null) => void;
  onError: (message: string) => void;
  /** 현재 모드가 스타일을 쓰는지. false면 고르게 두지 않고 이유를 알린다 */
  usesStyle?: boolean;
}

export function RoomStyleSelector({
  roomId,
  onRoomChange,
  styleId,
  onStyleChange,
  reference,
  onReferenceChange,
  onError,
  usesStyle = true,
}: Props) {
  const refInput = useRef<HTMLInputElement>(null);
  const needsReference = STYLES.find((s) => s.id === styleId)?.requiresReference;

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="room" className="mb-2 block text-[13px] font-semibold">
          방 종류
        </label>
        <select
          id="room"
          value={roomId}
          onChange={(e) => onRoomChange(e.target.value as RoomId)}
          className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink"
        >
          {ROOMS.map((room) => (
            <option key={room.id} value={room.id}>
              {room.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <span className="mb-2 block text-[13px] font-semibold">스타일</span>

        {!usesStyle && (
          <p className="mb-2 rounded-lg border border-line bg-sunken px-2.5 py-2 text-[11.5px] leading-relaxed text-muted">
            지금 고른 모드는 사진의 스타일을 그대로 두는 모드라 스타일 선택이 결과에 반영되지
            않습니다. 스타일을 바꾸려면 모드를 &lsquo;리디자인&rsquo;이나 &lsquo;가상 스테이징&rsquo;으로
            바꿔 주세요.
          </p>
        )}

        <div className={`grid grid-cols-4 gap-2 ${usesStyle ? "" : "pointer-events-none opacity-40"}`}>
          {STYLES.map((style) => {
            const active = style.id === styleId;
            return (
              <button
                key={style.id}
                type="button"
                aria-pressed={active}
                onClick={() => onStyleChange(style.id)}
                className="group text-left"
                title={style.label}
              >
                <span
                  className={[
                    "block overflow-hidden rounded-lg border transition-colors",
                    active ? "border-accent ring-1 ring-accent" : "border-line group-hover:border-line-strong",
                  ].join(" ")}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={style.thumbnail}
                    alt=""
                    className="aspect-square w-full object-cover"
                    loading="lazy"
                  />
                </span>
                <span
                  className={[
                    "mt-1 block truncate text-[11px]",
                    active ? "font-semibold text-ink" : "text-muted",
                  ].join(" ")}
                >
                  {style.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {needsReference && (
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-3">
          <p className="text-[13px] font-semibold">참고 이미지</p>
          <p className="mt-0.5 text-[11.5px] text-muted">
            원하는 분위기의 이미지를 올리면 컬러와 마감재를 따라갑니다.
          </p>
          {reference ? (
            <div className="mt-2 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={reference.url}
                alt="참고 이미지"
                className="h-14 w-14 rounded-md border border-line object-cover"
              />
              <button
                type="button"
                className="text-[12px] text-accent hover:underline"
                onClick={() => {
                  URL.revokeObjectURL(reference.url);
                  onReferenceChange(null);
                }}
              >
                제거
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => refInput.current?.click()}
              className="mt-2 h-9 w-full rounded-lg border border-dashed border-line-strong text-[12.5px] text-ink-soft hover:bg-sunken"
            >
              참고 이미지 올리기
            </button>
          )}
          <input
            ref={refInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const check = validateImageFile(file);
              if (!check.ok) {
                onError(check.message!);
                return;
              }
              onReferenceChange({ file, url: URL.createObjectURL(file) });
            }}
          />
        </div>
      )}
    </div>
  );
}
