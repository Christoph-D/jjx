import { useEffect } from "preact/hooks";
import { currentChanges, isAnyMenuOpen, isDragging, postMessage, selectedNodes, selectionAnchorId } from "../signals";
import { computeArrowKeySelection } from "../selection";

/**
 * The arrow-key row navigation. The rows themselves are not focusable, so the
 * keys are heard on the window and steer the selection signals instead of DOM
 * focus; the arrow keys are claimed (no page scrolling) whenever the graph is
 * shown. Modified arrows (e.g. Shift+Arrow for range selection) are left
 * alone, as are keys pressed while a menu is open or a drag is in progress.
 */
export function useKeyboardSelection() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) {
        return;
      }
      let direction: 1 | -1;
      if (e.key === "ArrowDown") {
        direction = 1;
      } else if (e.key === "ArrowUp") {
        direction = -1;
      } else {
        return;
      }
      if (isDragging.value || isAnyMenuOpen()) {
        return;
      }
      e.preventDefault();
      const outcome = computeArrowKeySelection(currentChanges.value, selectedNodes.value, direction);
      if (outcome === null) {
        return;
      }
      selectedNodes.value = outcome.selection;
      selectionAnchorId.value = outcome.anchor;
      postMessage({ command: "selectChange", selectedNodes: Array.from(outcome.selection) });
      const row = document.querySelector(`#nodes > [data-change-id="${CSS.escape(outcome.anchor)}"]`);
      row?.scrollIntoView({ block: "nearest" });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}
