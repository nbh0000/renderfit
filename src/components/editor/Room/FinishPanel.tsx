"use client";

import { useState } from "react";
import { useEditorStore } from "@/lib/editor/store";
import { ensureRoom } from "@/scene/geometry";
import { materialsForSurface, type MaterialSurface } from "@/models/materials";

/**
 * 마감재 고르기 — 바닥·벽·천장.
 *
 * 지금까지 재질은 선택한 가구에만 붙일 수 있었고, 공간 자체의 마감은 고를 방법이 없었다.
 * 벽지와 장판을 바꿔 보는 것이 인테리어 시안의 절반이라 면 단위로 고르게 한다.
 *
 * 썸네일은 실제 텍스처(diffuse) 이미지를 그대로 쓴다 — 색칩만 보여 주면
 * 마루와 타일이 같아 보여서 고를 수가 없다.
 */

const SURFACES: { id: MaterialSurface; label: string }[] = [
  { id: "floor", label: "바닥" },
  { id: "wall", label: "벽" },
  { id: "ceiling", label: "천장" },
];

export function FinishPanel() {
  const scene = useEditorStore((state) => state.scene);
  const runTool = useEditorStore((state) => state.runTool);
  const [surface, setSurface] = useState<MaterialSurface>("floor");

  const room = scene?.room ? ensureRoom(scene.room) : null;
  if (!room) return null;

  const options = materialsForSurface(surface);
  const current = room.finishes?.[surface as "floor" | "wall" | "ceiling"] ?? null;

  const apply = (materialId: string) => {
    // 같은 것을 다시 누르면 벗긴다 — 되돌릴 방법이 있어야 이것저것 눌러 볼 수 있다.
    void runTool("set_surface_material", {
      surface,
      materialId: materialId === current ? null : materialId,
    });
  };

  return (
    <div className="space-y-2.5">
      <div className="flex gap-1">
        {SURFACES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSurface(item.id)}
            className={[
              "flex-1 rounded-md px-2 py-1 text-[12px] transition-colors",
              surface === item.id
                ? "bg-ink text-white"
                : "bg-sunken text-muted hover:text-ink",
            ].join(" ")}
          >
            {item.label}
          </button>
        ))}
      </div>

      <ul className="grid grid-cols-3 gap-1.5">
        {options.map((material) => {
          const active = material.id === current;
          return (
            <li key={material.id}>
              <button
                type="button"
                onClick={() => apply(material.id)}
                title={material.name}
                aria-pressed={active}
                className={[
                  "block w-full overflow-hidden rounded-md border text-left transition-colors",
                  active ? "border-accent ring-1 ring-accent" : "border-line hover:border-line-strong",
                ].join(" ")}
              >
                <span
                  className="block aspect-square w-full bg-cover bg-center"
                  style={
                    material.textureUrl
                      ? { backgroundImage: `url(${material.textureUrl})` }
                      : { backgroundColor: material.baseColor }
                  }
                />
                <span className="block truncate px-1 py-1 text-[10.5px] text-ink-soft">
                  {material.name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {options.length === 0 && (
        <p className="text-[12px] text-muted">
          이 면에 바를 마감재가 없습니다. <code>npm run assets</code>로 텍스처를 받아 주세요.
        </p>
      )}
    </div>
  );
}
