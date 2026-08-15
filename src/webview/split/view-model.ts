import {
  SYMLINK_FILE_MODE,
  buildSplitLines,
  getFileCheckState,
  getHunkCheckState,
  getModeChecked,
  getRenameChecked,
  setFileChecked,
  setHunkChecked,
  setModeChecked,
  setRenameChecked,
  splitFileLines,
  type SplitCheckState,
  type SplitCheckboxState,
  type SplitFileEntry,
  type SplitHunk,
  type SplitLine,
} from "../../split/hunk-model";
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

/** Added and removed line counts of a change, rendered as `+N -M` with zeros omitted. */
export interface SplitChangeCounts {
  added: number;
  removed: number;
}

/**
 * A file's total added/removed line counts for its header row: the sum over its hunk groups,
 * falling back to the one-sided line count of whole-file adds/deletes without hunks. Binary
 * and conflicted files have no counts.
 */
export function splitFileChangeCounts(file: SplitFileViewModel): SplitChangeCounts {
  if (file.entry.binary) {
    return { added: 0, removed: 0 };
  }
  let added = 0;
  let removed = 0;
  for (const group of file.hunkGroups) {
    added += group.addedCount;
    removed += group.removedCount;
  }
  if (added === 0 && removed === 0) {
    // Whole-file adds/deletes without hunks still count their one-sided contents.
    const text =
      file.entry.status === "A" ? file.entry.rightText : file.entry.status === "D" ? file.entry.leftText : undefined;
    const count = text === undefined ? 0 : splitFileLines(text).length;
    if (file.entry.status === "A") {
      added += count;
    } else {
      removed += count;
    }
  }
  return { added, removed };
}

/** Sums per-file counts into the aggregate shown on the "Select Everything" row. */
export function splitChangeCountsTotal(files: readonly SplitFileViewModel[]): SplitChangeCounts {
  const total: SplitChangeCounts = { added: 0, removed: 0 };
  for (const file of files) {
    const counts = splitFileChangeCounts(file);
    total.added += counts.added;
    total.removed += counts.removed;
  }
  return total;
}

/**
 * True for text files that get a hunk breakdown: modified files (see decisions 4 & 5 in #23),
 * added files, deleted files, and renamed files (which usually produce no hunks for a pure
 * rename, leaving only the rename checkbox).
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
 * The new mode offered by a file's "File mode changed to <mode>" entry, if any; symlink type
 * changes offer none — a chmod cannot change a file's type (see SplitFileEntry.modeChangedTo).
 */
export function modeChangeOf(entry: SplitViewFileEntry): string | undefined {
  if (entry.modeChangedTo === undefined || entry.modeChangedFrom === undefined) {
    return undefined;
  }
  if (entry.modeChangedTo === SYMLINK_FILE_MODE || entry.modeChangedFrom === SYMLINK_FILE_MODE) {
    return undefined;
  }
  return entry.status === "M" || entry.renamedFrom !== undefined ? entry.modeChangedTo : undefined;
}

/** True when a file has rows to expand into: content hunks or a separate mode-change checkbox. */
export function hasExpandableSplitEntries(file: SplitFileViewModel): boolean {
  return file.hunkGroups.length > 0 || modeChangeOf(file.entry) !== undefined;
}

function buildSplitFileViewModel(entry: SplitViewFileEntry): SplitFileViewModel {
  if (!isExpandableSplitEntry(entry)) {
    return { entry, hunkGroups: [], contextCounts: [] };
  }
  const { hunkGroups, contextCounts } = buildHunkGroups(entry.leftText ?? "", entry.rightText ?? "");
  if (hunkGroups.length === 0) {
    return { entry, hunkGroups: [], contextCounts: [] };
  }
  return { entry: { ...entry, hunks: hunkGroups.map((group) => group.hunk) }, hunkGroups, contextCounts };
}

/** The state a toggle lands on: a fully unchecked row checks all of its lines, anything else unchecks. */
function toggleTargetOf(current: SplitCheckState): boolean {
  return current === false;
}

/** Toggles all of a file's checkables — lines, rename, and mode change — at once. */
export function toggleSplitFileChecked(file: SplitFileViewModel, state: SplitCheckboxState): void {
  setFileChecked(file.entry.path, state, toggleTargetOf(getFileCheckState(file.entry, state)));
}

/** Toggles all of a hunk's lines at once. */
export function toggleSplitHunkChecked(path: string, hunk: SplitHunk, state: SplitCheckboxState): void {
  setHunkChecked(path, hunk, state, toggleTargetOf(getHunkCheckState(path, hunk, state)));
}

/** Toggles a renamed file's rename selection. */
export function toggleSplitRenameChecked(path: string, state: SplitCheckboxState): void {
  setRenameChecked(path, state, toggleTargetOf(getRenameChecked(path, state)));
}

/** Toggles a file's mode-change selection. */
export function toggleSplitModeChecked(path: string, state: SplitCheckboxState): void {
  setModeChecked(path, state, toggleTargetOf(getModeChecked(path, state)));
}

/** Stable key identifying a file's hunk by its index within the file's hunk groups. */
export function hunkKey(path: string, index: number): string {
  return `${path}:${index}`;
}

/** Identifies one selectable row of the split view: the "Select Everything" row, a file row, its mode-change and rename rows, a section row, or a line row. */
export type SplitRowId =
  | { kind: "all" }
  | { kind: "file"; path: string }
  | { kind: "mode"; path: string }
  | { kind: "rename"; path: string }
  | { kind: "hunk"; path: string; index: number }
  | { kind: "line"; path: string; hunkIndex: number; lineIndex: number };

/**
 * One row of the split view's flat navigation model: its identity plus whether it is on
 * screen. Rows hidden inside collapsed files or sections stay in the list (marked
 * invisible) so a selection that becomes hidden keeps its place and arrow keys can step to
 * the next visible row.
 */
export interface SplitRowRef {
  id: SplitRowId;
  visible: boolean;
}

/** String form of a row identity; unique per row because each kind fixes its trailing fields. */
export function splitRowKey(id: SplitRowId): string {
  switch (id.kind) {
    case "all":
      return "all";
    case "file":
      return `file:${id.path}`;
    case "mode":
      return `mode:${id.path}`;
    case "rename":
      return `rename:${id.path}`;
    case "hunk":
      return `hunk:${hunkKey(id.path, id.index)}`;
    case "line":
      return `line:${id.path}:${id.hunkIndex}:${id.lineIndex}`;
  }
}

/** True when both ids (or both nulls) identify the same row. */
export function sameSplitRow(a: SplitRowId | null, b: SplitRowId | null): boolean {
  return a === b || (a !== null && b !== null && splitRowKey(a) === splitRowKey(b));
}

/**
 * Builds every row in display order, with visibility derived from the collapse state. Context
 * separators carry no checkbox, so they take no part in the navigation model.
 */
export function buildSplitRows(
  files: readonly SplitFileViewModel[],
  expandedFiles: ReadonlySet<string>,
  collapsedHunks: ReadonlySet<string>,
): SplitRowRef[] {
  const rows: SplitRowRef[] = [{ id: { kind: "all" }, visible: true }];
  for (const file of files) {
    const path = file.entry.path;
    rows.push({ id: { kind: "file", path }, visible: true });
    if (!hasExpandableSplitEntries(file)) {
      continue;
    }
    // The contents of a collapsed file stay in the list as invisible rows.
    const contentsVisible = expandedFiles.has(path);
    if (modeChangeOf(file.entry) !== undefined) {
      rows.push({ id: { kind: "mode", path }, visible: contentsVisible });
    }
    if (file.entry.renamedFrom !== undefined) {
      rows.push({ id: { kind: "rename", path }, visible: contentsVisible });
    }
    file.hunkGroups.forEach((group, index) => {
      rows.push({ id: { kind: "hunk", path, index }, visible: contentsVisible });
      const linesVisible = contentsVisible && !collapsedHunks.has(hunkKey(path, index));
      group.hunk.lines.forEach((_, lineIndex) => {
        rows.push({ id: { kind: "line", path, hunkIndex: index, lineIndex }, visible: linesVisible });
      });
    });
  }
  return rows;
}

/**
 * Steps to the previous/next visible row for the Up/Down keys, wrapping around at both ends
 * and skipping rows hidden inside collapsed sections. With nothing selected, starts just
 * outside the list, so Down picks the first row and Up the last.
 */
export function stepSplitRow(
  rows: readonly SplitRowRef[],
  current: SplitRowId | null,
  delta: 1 | -1,
): SplitRowId | null {
  if (rows.length === 0) {
    return null;
  }
  // A selection that vanished with a refresh starts just outside the list; a hidden one keeps
  // its real place and the walk skips it.
  const found = current === null ? -1 : rows.findIndex((row) => sameSplitRow(row.id, current));
  let index = found === -1 ? (delta > 0 ? -1 : rows.length) : found;
  for (let step = 0; step < rows.length; step++) {
    index = (index + delta + rows.length) % rows.length;
    if (rows[index].visible) {
      return rows[index].id;
    }
  }
  return null;
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
