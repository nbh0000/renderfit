"use client";

import { useEffect } from "react";
import { useEditorStore } from "@/lib/editor/store";

/** 전문 툴 수준의 키보드 단축키 */
export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = async (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable ||
          target.tagName === "SELECT");
      if (typing) return;

      const store = useEditorStore.getState();
      const selectedId = store.selectedIds[0];
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) await store.redo();
        else await store.undo();
        return;
      }

      if (mod && event.key.toLowerCase() === "c") {
        const object = store.scene.objects?.find((o) => o.id === selectedId);
        if (object) {
          useEditorStore.setState({ clipboard: object, lastMessage: `${object.name} 복사됨` });
        }
        return;
      }

      if (mod && event.key.toLowerCase() === "v") {
        const clipboard = store.clipboard;
        if (clipboard) {
          event.preventDefault();
          await store.runTool("duplicate_object", { objectId: clipboard.id });
        }
        return;
      }

      /*
       * 걷는 중에는 단일 키 단축키를 통째로 막는다.
       *
       * WASD 로 걷는데 D 가 "복제", S 가 "크기 도구", R 이 "회전 도구"로 먹으면
       * 걸을 때마다 장면이 고쳐진다. 위의 Cmd/Ctrl 조합(되돌리기·복사·붙여넣기)은
       * 걷는 중에도 쓸 수 있어야 하므로 그보다 아래에 둔다.
       */
      if (store.viewMode === "walk") return;

      switch (event.key.toLowerCase()) {
        case "v":
          store.setTool("select");
          break;
        case "m":
          store.setTool("move");
          break;
        case "r":
          store.setTool("rotate");
          break;
        case "s":
          store.setTool("scale");
          break;
        case "g":
          store.toggleGrid();
          break;
        /*
         * 원본 도면 밑그림.
         *
         * 도면과 우리 결과를 번갈아 보며 맞추는 작업이라 켰다 껐다를 수없이 한다.
         * b 는 다른 데서 쓰지 않는 키였다.
         */
        case "b":
          await store.toggleUnderlay();
          break;
        case "1":
          store.setViewMode("image");
          break;
        case "2":
          store.setViewMode("plan");
          break;
        case "3":
          store.setViewMode("3d");
          break;
        case "4":
          store.setViewMode("walk");
          break;
        case "delete":
        case "backspace":
          if (selectedId) {
            event.preventDefault();
            await store.runTool("delete_object", { objectId: selectedId });
          }
          break;
        case "escape":
          store.select([]);
          break;
        case "d":
          if (selectedId && !mod) await store.runTool("duplicate_object", { objectId: selectedId });
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
