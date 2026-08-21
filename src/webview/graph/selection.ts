import type { ChangeNode, FullChangeId } from "../../graph-protocol";

export const elidedRangeSelectionWarning =
  "Shift+click doesn't support selecting a range that includes elided commits.";

export interface SelectionModifiers {
  shiftKey: boolean;
  toggleKey: boolean;
}

export type SelectionOutcome =
  { kind: "applied"; selection: Set<FullChangeId>; anchor: FullChangeId } | { kind: "warning"; message: string };

/**
 * Computes the graph selection resulting from a click on the row at
 * `clickedIndex`:
 * - Shift+click selects the contiguous range between the selection anchor
 *   (the last clicked commit) and the clicked commit, keeping the anchor.
 *   The selection is ordered from the anchor toward the clicked commit.
 * - Ctrl/Cmd+click toggles the clicked commit in the selection.
 * - A plain click selects only the clicked commit.
 *
 * Ranges that span elided ("~") rows cannot be selected; the selection is
 * left unchanged and a warning message is returned instead.
 */
export function computeSelection(
  changes: ChangeNode[],
  clickedIndex: number,
  anchorId: FullChangeId | null,
  currentSelection: Set<FullChangeId>,
  modifiers: SelectionModifiers,
): SelectionOutcome {
  const clicked = changes[clickedIndex];
  const clickedId = clicked !== undefined && clicked.branchType !== "~" ? clicked.id.changeId : null;
  if (clickedId === null) {
    return { kind: "warning", message: elidedRangeSelectionWarning };
  }

  if (modifiers.shiftKey) {
    if (anchorId !== null) {
      const anchorIndex = changes.findIndex((c) => c.branchType !== "~" && c.id.changeId === anchorId);
      if (anchorIndex !== -1) {
        const step = clickedIndex >= anchorIndex ? 1 : -1;
        const selection = new Set<FullChangeId>();
        for (let i = anchorIndex; ; i += step) {
          const change = changes[i];
          if (change === undefined || change.branchType === "~") {
            return { kind: "warning", message: elidedRangeSelectionWarning };
          }
          selection.add(change.id.changeId);
          if (i === clickedIndex) {
            break;
          }
        }
        return { kind: "applied", selection, anchor: anchorId };
      }
    }
    return { kind: "applied", selection: new Set([clickedId]), anchor: clickedId };
  }

  if (modifiers.toggleKey) {
    const selection = new Set(currentSelection);
    if (selection.has(clickedId)) {
      selection.delete(clickedId);
    } else {
      selection.add(clickedId);
    }
    return { kind: "applied", selection, anchor: clickedId };
  }

  return { kind: "applied", selection: new Set([clickedId]), anchor: clickedId };
}
