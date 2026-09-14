import { useEffect, useRef } from "preact/hooks";
import { closeIdContextMenu, idContextMenu, postMessage } from "../signals";
import { positionMenu } from "./position-menu";

// The context menu for the Change ID / Commit ID values: right-clicking an unselected ID
// offers copying it in full (omitting an unneeded change-ID offset, like the ID rows) and
// in the short form used elsewhere in the extension.
export function IdContextMenu() {
  const state = idContextMenu.value;
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
        closeIdContextMenu();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeIdContextMenu();
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", closeIdContextMenu);
    return () => {
      if (raf !== undefined) {
        cancelAnimationFrame(raf);
      }
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", closeIdContextMenu);
    };
  }, [state]);

  if (!state) {
    return null;
  }

  const copy = (id: string) => {
    postMessage({ command: "copyId", id });
    closeIdContextMenu();
  };

  return (
    <div id="id-context-menu" class="detailsContextMenu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <div class="detailsContextMenuItem" data-action="copyId" onClick={() => copy(state.fullId)}>
        Copy
      </div>
      <div class="detailsContextMenuItem" data-action="copyShortId" onClick={() => copy(state.shortId)}>
        Copy Short {state.kind === "change" ? "Change" : "Commit"} ID
      </div>
    </div>
  );
}
