"use client";

import { useEditorStore, type ViewMode } from "@/lib/editor/store";
import { Icon, type IconName } from "./icons";

/**
 * 보기 전환 — 이미지 / 평면도 / 측면도 / 3D / 평면+3D / 걷기.
 *
 * 원래는 리본 툴바의 "보기" 묶음이었다. 그런데 이건 그리기 도구가 아니라 **지금 무엇을
 * 보고 있는가**이고, 작업하는 내내 가장 자주 누르는 버튼이다. 리본 맨 위에 두면
 * 도면에서 눈을 떼고 화면 꼭대기까지 올라갔다 와야 한다.
 *
 * 그래서 캔버스 바로 위 띠, 층 탭과 같은 줄 오른쪽 끝에 둔다 — 도면을 보던 시선에서
 * 가장 가까운 자리이고, 층 탭과 나란히 있어 "무엇을 어떻게 보는가"가 한 줄에 모인다.
 */

const VIEWS: { id: ViewMode; label: string; icon: IconName }[] = [
  { id: "image", label: "이미지", icon: "image" },
  { id: "plan", label: "평면도", icon: "plan" },
  { id: "elevation", label: "측면도", icon: "elevation" },
  { id: "3d", label: "3D", icon: "cube" },
  { id: "split", label: "평면+3D", icon: "split" },
  { id: "walk", label: "걷기", icon: "walk" },
];

export function ViewSwitch() {
  const viewMode = useEditorStore((state) => state.viewMode);
  const setViewMode = useEditorStore((state) => state.setViewMode);

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {VIEWS.map((view) => {
        const active = viewMode === view.id;
        return (
          <button
            key={view.id}
            type="button"
            onClick={() => setViewMode(view.id)}
            title={view.label}
            className={[
              "flex h-6 items-center gap-1 rounded-md px-2 text-[11.5px] transition-colors",
              active
                ? "bg-accent-soft font-medium text-accent"
                : "text-muted hover:bg-sunken hover:text-ink",
            ].join(" ")}
          >
            <Icon name={view.icon} />
            {/*
              좁은 화면에서는 아이콘만 남긴다.
              여섯 개를 글자까지 늘어놓으면 층 탭을 밀어내는데, 층 탭은 지금 어디를
              그리고 있는지라 사라지면 안 된다.
            */}
            <span className="hidden lg:inline">{view.label}</span>
          </button>
        );
      })}
    </div>
  );
}
