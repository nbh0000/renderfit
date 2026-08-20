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
        case "1":
          store.setViewMode("image");
          break;
        case "2":
          store.setViewMode("plan");
          break;
        case "3":
          store.setViewMode("3d");
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
