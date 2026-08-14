import { buildSplitLines, type SplitFileEntry, type SplitHunk, type SplitLine } from "../../split/hunk-model";
import type { SplitViewFileEntry } from "../../split-protocol";

export interface SplitHunkGroup {
  hunk: SplitHunk;
  addedCount: number;
  removedCount: number;
}

export interface SplitFileViewModel {
  // The view entry; for expandable files it carries the computed hunks so the
  // tri-state helpers from the hunk model can be used directly.
  entry: SplitFileEntry;
  hunkGroups: SplitHunkGroup[];
  // Counts of unchanged lines before, between, and after the hunks (length is
  // hunkGroups.length + 1).
  contextCounts: number[];
}

/** True for modified text files that get a hunk breakdown (see decisions 4 & 5 in #23). */
export function isExpandableSplitEntry(entry: SplitViewFileEntry): boolean {
  return (
    entry.status === "M" &&
    !entry.binary &&
    !entry.conflict &&
    entry.leftText !== undefined &&
    entry.rightText !== undefined
  );
}

export function buildSplitFileViewModels(entries: readonly SplitViewFileEntry[]): SplitFileViewModel[] {
  return entries.map(buildSplitFileViewModel);
}

function buildSplitFileViewModel(entry: SplitViewFileEntry): SplitFileViewModel {
  if (!isExpandableSplitEntry(entry)) {
    return { entry, hunkGroups: [], contextCounts: [] };
  }
  const { hunkGroups, contextCounts } = buildHunkGroups(entry.leftText!, entry.rightText!);
  if (hunkGroups.length === 0) {
    return { entry, hunkGroups: [], contextCounts: [] };
  }
  return { entry: { ...entry, hunks: hunkGroups.map((group) => group.hunk) }, hunkGroups, contextCounts };
}

/**
 * Groups the full line model into maximal runs of changed lines (hunks) and counts the
 * unchanged lines surrounding them.
 */
function buildHunkGroups(
  leftText: string,
  rightText: string,
): { hunkGroups: SplitHunkGroup[]; contextCounts: number[] } {
  const hunkGroups: SplitHunkGroup[] = [];
  const contextCounts: number[] = [];
  let contextRun = 0;
  let currentLines: SplitLine[] | undefined;
  let addedCount = 0;
  let removedCount = 0;
  for (const line of buildSplitLines(leftText, rightText)) {
    if (line.kind === "context") {
      contextRun++;
      if (currentLines === undefined) {
        continue;
      }
      hunkGroups.push({ hunk: { lines: currentLines }, addedCount, removedCount });
      currentLines = undefined;
      addedCount = 0;
      removedCount = 0;
    } else {
      if (currentLines === undefined) {
        contextCounts.push(contextRun);
        contextRun = 0;
        currentLines = [];
      }
      currentLines.push(line);
      if (line.kind === "add") {
        addedCount++;
      } else {
        removedCount++;
      }
    }
  }
  if (currentLines !== undefined) {
    hunkGroups.push({ hunk: { lines: currentLines }, addedCount, removedCount });
  }
  contextCounts.push(contextRun);
  return { hunkGroups, contextCounts };
}
