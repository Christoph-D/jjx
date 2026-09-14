import { useEffect } from "preact/hooks";
import { editChange } from "../edit-change";
import { currentChanges, isAnyMenuOpen, isDragging, postMessage, selectedNodes, selectionAnchorId } from "../signals";
import { computeArrowKeySelection, computeShiftArrowKeySelection, lastSelectedChangeId } from "../selection";
import type { FullChangeId, RegularChangeNode } from "../../../graph-protocol";

/**
 * The keyboard support. The rows themselves are not focusable, so the keys are
 * heard on the window and steer the signals instead of DOM focus:
 * - ArrowUp/ArrowDown move the selection one selectable row, claiming the keys
 *   (no page scrolling) whenever the graph is shown. Shift+ArrowUp/ArrowDown
 *   extend the selection by one selectable row instead, like a Shift+click
 *   range from the selection anchor.
 * - Delete abandons the selected changes exactly like the "Abandon Change" and
 *   "Abandon All Selected Changes" context menu items; the extension side asks
 *   for confirmation before abandoning anything.
 * - Enter opens a single selected change exactly like a double click (the
 *   working copy only reacts to the "new" action and when it has content), and
 *   with several selected changes it creates a new change on top with all of
 *   them as parents.
 * - "n" always creates a new change on top of all selected changes.
 * - "i" opens the commit details view for the current selection.
 * - "d", "e", "b", "t" and "s" act on the last selected change (the most
 *   recently added id in the selection) exactly like the corresponding context
 *   menu items: Describe..., Edit This Change, Create Bookmark..., Create
 *   Tag... and Split... .
 *
 * Other modified keys are left alone, as are keys pressed while a menu is
 * open or a drag is in progress.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const moveSelection = (e: KeyboardEvent, direction: 1 | -1, extend: boolean) => {
      e.preventDefault();
      const outcome = extend
        ? computeShiftArrowKeySelection(currentChanges.value, selectedNodes.value, selectionAnchorId.value, direction)
        : computeArrowKeySelection(currentChanges.value, selectedNodes.value, direction);
      if (outcome === null) {
        return;
      }
      selectedNodes.value = outcome.selection;
      selectionAnchorId.value = outcome.anchor;
      postMessage({ command: "selectChange", selectedNodes: Array.from(outcome.selection) });
      // The selection is ordered from the anchor toward the row the keys moved
      // to, so its last element is the row to bring into view.
      const focusId = Array.from(outcome.selection).pop();
      if (focusId !== undefined) {
        const row = document.querySelector(`#nodes > [data-change-id="${CSS.escape(focusId)}"]`);
        row?.scrollIntoView({ block: "nearest" });
      }
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

    const activateSelection = (e: KeyboardEvent) => {
      const selection = Array.from(selectedNodes.value);
      if (selection.length === 0) {
        return;
      }
      if (selection.length === 1) {
        const change = currentChanges.value.find(
          (c): c is RegularChangeNode => c.branchType !== "~" && c.id.changeId === selection[0],
        );
        if (change === undefined) {
          return;
        }
        if (editChange(change)) {
          e.preventDefault();
        }
        return;
      }
      e.preventDefault();
      postMessage({ command: "newChildChange", changeIds: selection });
    };

    const newChangeOnSelection = (e: KeyboardEvent) => {
      const selection = Array.from(selectedNodes.value);
      if (selection.length === 0) {
        return;
      }
      e.preventDefault();
      postMessage({ command: "newChildChange", changeIds: selection });
    };

    const openDetailsView = (e: KeyboardEvent) => {
      e.preventDefault();
      postMessage({ command: "openDetailsView" });
    };

    const actOnLastSelected = (e: KeyboardEvent, send: (changeId: FullChangeId) => void) => {
      const changeId = lastSelectedChangeId(currentChanges.value, selectedNodes.value);
      if (changeId === null) {
        return;
      }
      e.preventDefault();
      send(changeId);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      if (e.shiftKey && e.key !== "ArrowUp" && e.key !== "ArrowDown") {
        return;
      }
      if (isDragging.value || isAnyMenuOpen()) {
        return;
      }
      switch (e.key) {
        case "ArrowDown":
          moveSelection(e, 1, e.shiftKey);
          return;
        case "ArrowUp":
          moveSelection(e, -1, e.shiftKey);
          return;
        case "Delete":
          abandonSelection(e);
          return;
        case "Enter":
          activateSelection(e);
          return;
        case "i":
          openDetailsView(e);
          return;
        case "n":
          newChangeOnSelection(e);
          return;
        case "d":
          actOnLastSelected(e, (changeId) => postMessage({ command: "describeChange", changeId }));
          return;
        case "e":
          actOnLastSelected(e, (changeId) => postMessage({ command: "editChangeDirect", changeId }));
          return;
        case "b":
          actOnLastSelected(e, (targetChangeId) => postMessage({ command: "createBookmark", targetChangeId }));
          return;
        case "t":
          actOnLastSelected(e, (targetChangeId) => postMessage({ command: "createTag", targetChangeId }));
          return;
        case "s":
          actOnLastSelected(e, (changeId) => postMessage({ command: "splitChange", changeId }));
          return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);
}
