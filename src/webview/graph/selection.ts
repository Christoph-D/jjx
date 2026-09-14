import type { ChangeNode, FullChangeId, RegularChangeNode } from "../../graph-protocol";

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

/**
 * Returns the last selected change: the most recently added id in the
 * selection that is still present in the graph as a selectable (non-elided)
 * row, or null when the selection is empty or none of its ids remain.
 */
export function lastSelectedChangeId(
  changes: ChangeNode[],
  currentSelection: ReadonlySet<FullChangeId>,
): FullChangeId | null {
  for (const id of Array.from(currentSelection).reverse()) {
    if (changes.some((c) => c.branchType !== "~" && c.id.changeId === id)) {
      return id;
    }
  }
  return null;
}

/**
 * Computes the graph selection resulting from pressing ArrowUp (`direction`
 * -1) or ArrowDown (`direction` 1):
 * - The selection moves one selectable row from the last selected change,
 *   skipping elided ("~") rows. Elided rows after the last change mean there
 *   is nothing further to select.
 * - With no selection (or a selection that is no longer part of the graph),
 *   ArrowDown selects the top-most change and ArrowUp the bottom-most one.
 * - The selection never wraps: moving past the first or last change leaves
 *   everything unchanged, as does an all-elided graph. In those cases `null`
 *   is returned.
 *
 * The last selected change is the most recently added id in the selection
 * that is still present in the graph, so a multi-selection behaves exactly
 * like a single selection of its last member.
 */
export function computeArrowKeySelection(
  changes: ChangeNode[],
  currentSelection: ReadonlySet<FullChangeId>,
  direction: 1 | -1,
): { selection: Set<FullChangeId>; anchor: FullChangeId } | null {
  const selectable = changes.filter((c): c is RegularChangeNode => c.branchType !== "~");
  if (selectable.length === 0) {
    return null;
  }

  const lastId = lastSelectedChangeId(changes, currentSelection);
  const referencePos = lastId === null ? -1 : selectable.findIndex((c) => c.id.changeId === lastId);

  const targetPos = referencePos === -1 ? (direction === 1 ? 0 : selectable.length - 1) : referencePos + direction;
  if (targetPos < 0 || targetPos >= selectable.length) {
    return null;
  }
  const anchor = selectable[targetPos].id.changeId;
  return { selection: new Set([anchor]), anchor };
}
