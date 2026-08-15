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

/**
 * True for text files that get a hunk breakdown: modified files (see decisions 4 & 5 in #23),
 * added files, deleted files, and renamed files (which usually produce no hunks for a pure
 * rename, leaving only the "File Renamed" checkbox).
 */
export function isExpandableSplitEntry(entry: SplitViewFileEntry): boolean {
  if (entry.binary || entry.conflict) {
    return false;
  }
  if (entry.status === "M" || entry.renamedFrom !== undefined) {
    return entry.leftText !== undefined && entry.rightText !== undefined;
  }
  if (entry.status === "D") {
    // A deleted file has no right side; it expands into a single hunk removing every left-side line.
    return entry.leftText !== undefined && entry.rightText === undefined;
  }
  // An added file has no left side; it expands into a single hunk adding every right-side line.
  return entry.status === "A" && entry.leftText === undefined && entry.rightText !== undefined;
}

export function buildSplitFileViewModels(entries: readonly SplitViewFileEntry[]): SplitFileViewModel[] {
  return entries.map(buildSplitFileViewModel);
}

/**
 * The new mode offered by a file's "File mode changed to <mode>" entry, if any: only modified
 * and renamed files whose mode actually changed get one (added/deleted files never do).
 */
export function modeChangeOf(entry: SplitViewFileEntry): string | undefined {
  if (entry.modeChangedTo === undefined) {
    return undefined;
  }
  return entry.status === "M" || entry.renamedFrom !== undefined ? entry.modeChangedTo : undefined;
}

/**
 * True when a file has entries to expand into: content hunks or a mode change whose "File mode
 * changed to <mode>" checkbox is picked separately from the whole-file checkbox.
 */
export function hasExpandableSplitEntries(file: SplitFileViewModel): boolean {
  return file.hunkGroups.length > 0 || modeChangeOf(file.entry) !== undefined;
}

function buildSplitFileViewModel(entry: SplitViewFileEntry): SplitFileViewModel {
  if (!isExpandableSplitEntry(entry)) {
    return { entry, hunkGroups: [], contextCounts: [] };
  }
  // A deleted file is diffed against an empty right side (removing every left-side line) and
  // an added file against an empty left side (adding every right-side line).
  const { hunkGroups, contextCounts } = buildHunkGroups(entry.leftText ?? "", entry.rightText ?? "");
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
