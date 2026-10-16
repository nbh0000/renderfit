"use client";

import { useEditorStore } from "@/lib/editor/store";
import { LevelTabs } from "./Plan/LevelTabs";
import { ViewSwitch } from "./ViewSwitch";

/**
 * 캔버스 바로 위의 띠.
 *
 * 왼쪽에 층 탭, 오른쪽에 보기 전환. 둘 다 "지금 무엇을 보고 있는가"라서 한 줄에 모은다.
 *
 * 층 탭은 평면이 보이는 모드에서만 뜬다 — 3D 나 이미지 뷰에서 층을 바꿔 봐야 화면에
 * 달라지는 것이 없어서, 눌러도 아무 일이 없는 탭만 남는다. 보기 전환은 어느 모드에서든
 * 있어야 한다. 그게 없으면 3D 에 들어간 뒤 도면으로 돌아올 길이 사라진다.
 */
export function CanvasTopBar() {
  const viewMode = useEditorStore((state) => state.viewMode);
  const showLevels = viewMode === "plan" || viewMode === "split";

  return (
    <div className="flex shrink-0 items-center gap-0.5 border-b border-line bg-surface px-2 py-1">
      {showLevels && <LevelTabs />}
      <div className="mx-auto" />
      <ViewSwitch />
    </div>
  );
}
