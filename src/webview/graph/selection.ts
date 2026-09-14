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
 * Indexes the selectable (non-elided) rows in a single pass: `selectable`
 * holds them in graph order and `positionById` maps each change id to its
 * position among them, so selection lookups are O(1) instead of a linear
 * scan per selected id.
 */
function indexSelectableChanges(changes: ChangeNode[]): {
  selectable: RegularChangeNode[];
  positionById: Map<FullChangeId, number>;
} {
  const selectable: RegularChangeNode[] = [];
  const positionById = new Map<FullChangeId, number>();
  for (const change of changes) {
    if (change.branchType !== "~") {
      positionById.set(change.id.changeId, selectable.length);
      selectable.push(change);
    }
  }
  return { selectable, positionById };
}

function lastSelectedPos(positionById: Map<FullChangeId, number>, currentSelection: ReadonlySet<FullChangeId>): number {
  for (const id of Array.from(currentSelection).reverse()) {
    const pos = positionById.get(id);
    if (pos !== undefined) {
      return pos;
    }
  }
  return -1;
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
  const { positionById } = indexSelectableChanges(changes);
  for (const id of Array.from(currentSelection).reverse()) {
    if (positionById.has(id)) {
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
  const { selectable, positionById } = indexSelectableChanges(changes);
  if (selectable.length === 0) {
    return null;
  }

  const referencePos = lastSelectedPos(positionById, currentSelection);

  const targetPos = referencePos === -1 ? (direction === 1 ? 0 : selectable.length - 1) : referencePos + direction;
  if (targetPos < 0 || targetPos >= selectable.length) {
    return null;
  }
  const anchor = selectable[targetPos].id.changeId;
  return { selection: new Set([anchor]), anchor };
}

/**
 * Computes the graph selection resulting from pressing Shift+ArrowUp
 * (`direction` -1) or Shift+ArrowDown (`direction` 1):
 * - The selection extends to one selectable row beyond the last selected
 *   change, keeping the selection anchor fixed like a Shift+click range, so it
 *   grows when moving away from the anchor and shrinks when moving back toward
 *   it. Moving past the anchor extends the range in the other direction.
 * - Elided ("~") rows are skipped like with the plain arrow keys.
 * - Without a selection (or one that is no longer part of the graph),
 *   Shift+ArrowDown selects the top-most change and Shift+ArrowUp the
 *   bottom-most one, like the plain arrow keys. Without a usable anchor the
 *   last selected change becomes the anchor.
 * - The selection never wraps: moving past the first or last change leaves
 *   everything unchanged, as does an all-elided graph. In those cases `null`
 *   is returned.
 *
 * Like a Shift+click range, the selection is ordered from the anchor toward
 * the newly selected change, so its last element is the row the keys moved to.
 */
export function computeShiftArrowKeySelection(
  changes: ChangeNode[],
  currentSelection: ReadonlySet<FullChangeId>,
  anchorId: FullChangeId | null,
  direction: 1 | -1,
): { selection: Set<FullChangeId>; anchor: FullChangeId } | null {
  const { selectable, positionById } = indexSelectableChanges(changes);
  if (selectable.length === 0) {
    return null;
  }

  const referencePos = lastSelectedPos(positionById, currentSelection);
  let anchorPos = anchorId === null ? -1 : (positionById.get(anchorId) ?? -1);
  if (referencePos === -1 && anchorPos === -1) {
    const anchor = selectable[direction === 1 ? 0 : selectable.length - 1].id.changeId;
    return { selection: new Set([anchor]), anchor };
  }
  if (anchorPos === -1) {
    anchorPos = referencePos;
  }
  const fromPos = referencePos === -1 ? anchorPos : referencePos;
  const targetPos = fromPos + direction;
  if (targetPos < 0 || targetPos >= selectable.length) {
    return null;
  }
  const step = targetPos >= anchorPos ? 1 : -1;
  const selection = new Set<FullChangeId>();
  for (let i = anchorPos; ; i += step) {
    selection.add(selectable[i].id.changeId);
    if (i === targetPos) {
      break;
    }
  }
  return { selection, anchor: selectable[anchorPos].id.changeId };
}
