import { useEffect, useRef } from "preact/hooks";
import { closeTextContextMenu, textContextMenu } from "../signals";
import { positionMenu } from "./position-menu";

// The default (Electron) context menu is suppressed for the whole webview; this menu
// replaces its only useful entry by offering to copy the text selection that was
// right-clicked.
export function TextContextMenu() {
  const state = textContextMenu.value;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!state) {
      return;
    }
    const menu = ref.current;
    let raf: number | undefined;
    if (menu) {
      menu.style.visibility = "hidden";
      raf = requestAnimationFrame(() => {
        if (!ref.current) {
          return;
        }
        positionMenu(ref.current, state.clientX, state.clientY);
        ref.current.style.visibility = "";
      });
    }
    const handlePointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        closeTextContextMenu();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeTextContextMenu();
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", closeTextContextMenu);
    return () => {
      if (raf !== undefined) {
        cancelAnimationFrame(raf);
      }
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", closeTextContextMenu);
    };
  }, [state]);

  if (!state) {
    return null;
  }

  return (
    <div id="text-context-menu" class="detailsContextMenu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <div
        class="detailsContextMenuItem"
        data-action="copyText"
        onClick={() => {
          void navigator.clipboard.writeText(state.text);
          closeTextContextMenu();
        }}
      >
        Copy
      </div>
    </div>
  );
}
