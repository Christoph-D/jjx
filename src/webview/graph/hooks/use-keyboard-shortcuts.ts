import { useEffect } from "preact/hooks";
import { currentChanges, isAnyMenuOpen, isDragging, postMessage, selectedNodes, selectionAnchorId } from "../signals";
import { computeArrowKeySelection } from "../selection";

/**
 * The keyboard support. The rows themselves are not focusable, so the keys are
 * heard on the window and steer the signals instead of DOM focus:
 * - ArrowUp/ArrowDown move the selection one selectable row, claiming the keys
 *   (no page scrolling) whenever the graph is shown.
 * - Delete abandons the selected changes exactly like the "Abandon Change" and
 *   "Abandon All Selected Changes" context menu items; the extension side asks
 *   for confirmation before abandoning anything.
 *
 * Modified keys (e.g. Shift+Arrow for range selection) are left alone, as are
 * keys pressed while a menu is open or a drag is in progress.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const moveSelection = (e: KeyboardEvent, direction: 1 | -1) => {
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

    const abandonSelection = (e: KeyboardEvent) => {
      const selection = Array.from(selectedNodes.value);
      if (selection.length === 0) {
        return;
      }
      e.preventDefault();
      // A single selection goes through the single-change prompt (which shows
      // the change's description), several through the multi-change prompt,
      // exactly like the two context menu items.
      if (selection.length === 1) {
        postMessage({ command: "abandonChange", changeId: selection[0] });
      } else {
        postMessage({ command: "abandonChanges", changeIds: selection });
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) {
        return;
      }
      if (isDragging.value || isAnyMenuOpen()) {
        return;
      }
      switch (e.key) {
        case "ArrowDown":
          moveSelection(e, 1);
          return;
        case "ArrowUp":
          moveSelection(e, -1);
          return;
        case "Delete":
          abandonSelection(e);
          return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}
