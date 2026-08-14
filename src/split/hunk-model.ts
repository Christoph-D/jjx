import { diffArrays } from "diff";
import type { FileStatusType } from "../types";

export interface SplitLine {
  kind: "context" | "add" | "del";
  oldLine?: number;
  newLine?: number;
  text: string;
}

export interface SplitHunk {
  lines: SplitLine[];
}

export interface SplitFileEntry {
  // Repository-relative path with "/" separators; doubles as the key in SplitCheckboxState.
  path: string;
  renamedFrom?: string;
  status: FileStatusType;
  binary: boolean;
  conflict: boolean;
  hunks?: SplitHunk[];
  leftBase64?: string;
  rightBase64?: string;
  // Decoded left text, ready for hunk splitting; undefined for binary files
  // and files absent on the left side.
  leftText?: string;
  // Decoded right text, ready for hunk splitting; undefined for binary files
  // and files absent on the right side.
  rightText?: string;
}

/** Checkbox state of a row: checked, unchecked, or mixed ("indeterminate"). */
export type SplitCheckState = boolean | "indeterminate";

/**
 * Checkbox state for a whole split view. Line checkboxes default to checked (true), so only
 * deviations need to be recorded. Per-line entries win over the file-level entry, which acts as
 * the fallback for lines without an explicit entry; toggling a whole file replaces any per-line
 * entries.
 */
export interface SplitCheckboxState {
  files: Record<string, boolean>;
  lines: Record<string, Record<string, boolean>>;
}

/** Splits content into lines, keeping each line's terminator so content can be rebuilt byte-exactly. */
export function splitFileLines(content: string): string[] {
  if (content === "") {
    return [];
  }
  const matches = content.match(/[^\r\n]*(?:\r\n|[\r\n]|$)/g);
  if (!matches) {
    return [];
  }
  const lines: string[] = [];
  for (const match of matches) {
    if (match !== "") {
      lines.push(match);
    }
  }
  return lines;
}

/** Computes the full ordered left/right line model (context, added, and deleted lines). */
export function buildSplitLines(left: string, right: string): SplitLine[] {
  const changes = diffArrays(splitFileLines(left), splitFileLines(right));
  const result: SplitLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const change of changes) {
    if (change.added) {
      for (const text of change.value) {
        result.push({ kind: "add", newLine: newLine++, text });
      }
    } else if (change.removed) {
      for (const text of change.value) {
        result.push({ kind: "del", oldLine: oldLine++, text });
      }
    } else {
      for (const text of change.value) {
        result.push({ kind: "context", oldLine: oldLine++, newLine: newLine++, text });
      }
    }
  }
  return result;
}

/** Groups changed lines into maximal runs; any unchanged line separates hunks. */
export function buildSplitHunks(left: string, right: string): SplitHunk[] {
  const hunks: SplitHunk[] = [];
  let current: SplitLine[] | undefined;
  for (const line of buildSplitLines(left, right)) {
    if (line.kind === "context") {
      current = undefined;
    } else {
      if (!current) {
        current = [];
        hunks.push({ lines: current });
      }
      current.push(line);
    }
  }
  return hunks;
}

/**
 * Builds a file entry from whole-file contents. Modified, added, and deleted non-binary,
 * non-conflict text files get a hunk model; everything else (renamed/binary/conflict leaves)
 * keeps whole-file contents only.
 */
export function buildSplitFileEntry(options: {
  path: string;
  status: FileStatusType;
  renamedFrom?: string;
  binary?: boolean;
  conflict?: boolean;
  left?: Buffer;
  right?: Buffer;
}): SplitFileEntry {
  const binary = options.binary ?? false;
  const conflict = options.conflict ?? false;
  const entry: SplitFileEntry = {
    path: options.path,
    renamedFrom: options.renamedFrom,
    status: options.status,
    binary,
    conflict,
    leftBase64: options.left?.toString("base64"),
    rightBase64: options.right?.toString("base64"),
  };
  if (!binary && !conflict) {
    if (options.status === "M" && options.left !== undefined && options.right !== undefined) {
      entry.hunks = buildSplitHunks(options.left.toString("utf8"), options.right.toString("utf8"));
    } else if (options.status === "D" && options.left !== undefined) {
      // Diffing against an empty right side yields a single hunk removing every left-side line.
      // Empty left content stays a whole-file leaf so an empty deleted file reconstructs as absent.
      const hunks = buildSplitHunks(options.left.toString("utf8"), "");
      if (hunks.length > 0) {
        entry.hunks = hunks;
      }
    } else if (options.status === "A" && options.right !== undefined) {
      // Diffing against an empty left side yields a single hunk adding every right-side line.
      // Empty right content stays a whole-file leaf so an empty added file reconstructs as empty.
      const hunks = buildSplitHunks("", options.right.toString("utf8"));
      if (hunks.length > 0) {
        entry.hunks = hunks;
      }
    }
  }
  return entry;
}

export function createSplitCheckboxState(): SplitCheckboxState {
  return { files: {}, lines: {} };
}

/** Stable key identifying a checkable (non-context) line within its file. */
export function lineKey(line: SplitLine): string {
  if (line.kind === "del") {
    return `del:${line.oldLine}`;
  }
  if (line.kind === "add") {
    return `add:${line.newLine}`;
  }
  return `context:${line.oldLine}-${line.newLine}`;
}

export function getLineChecked(path: string, line: SplitLine, state: SplitCheckboxState): boolean {
  if (line.kind === "context") {
    return true;
  }
  const lineState = state.lines[path]?.[lineKey(line)];
  if (lineState !== undefined) {
    return lineState;
  }
  return state.files[path] ?? true;
}

export function getHunkCheckState(path: string, hunk: SplitHunk, state: SplitCheckboxState): SplitCheckState {
  return combineCheckStates(hunk.lines.map((line) => getLineChecked(path, line, state)));
}

export function getFileCheckState(entry: SplitFileEntry, state: SplitCheckboxState): SplitCheckState {
  if (!entry.hunks || entry.hunks.length === 0) {
    return state.files[entry.path] ?? true;
  }
  return combineCheckStates(entry.hunks.map((hunk) => getHunkCheckState(entry.path, hunk, state)));
}

function combineCheckStates(states: SplitCheckState[]): SplitCheckState {
  if (states.every((s) => s === true)) {
    return true;
  }
  if (states.every((s) => s === false)) {
    return false;
  }
  return "indeterminate";
}

export function setLineChecked(path: string, line: SplitLine, state: SplitCheckboxState, checked: boolean): void {
  if (line.kind === "context") {
    return;
  }
  // The file-level entry is kept as the fallback for the file's other lines.
  (state.lines[path] ??= {})[lineKey(line)] = checked;
}

export function setHunkChecked(path: string, hunk: SplitHunk, state: SplitCheckboxState, checked: boolean): void {
  // The file-level entry is kept as the fallback for the file's other lines.
  for (const line of hunk.lines) {
    if (line.kind !== "context") {
      (state.lines[path] ??= {})[lineKey(line)] = checked;
    }
  }
}

export function setFileChecked(path: string, state: SplitCheckboxState, checked: boolean): void {
  state.files[path] = checked;
  delete state.lines[path];
}

/**
 * Reconstructs the right-side contents for all entries. The returned map is keyed by file path
 * (including rename source paths for unchecked renames); a value of undefined means the file is
 * absent on the reconstructed right side.
 */
export function reconstructRightSides(
  entries: readonly SplitFileEntry[],
  state: SplitCheckboxState,
): Map<string, Buffer | undefined> {
  const result = new Map<string, Buffer | undefined>();
  for (const entry of entries) {
    reconstructEntry(entry, state, result);
  }
  return result;
}

function decodeBase64(base64: string | undefined): Buffer | undefined {
  return base64 !== undefined ? Buffer.from(base64, "base64") : undefined;
}

function reconstructEntry(
  entry: SplitFileEntry,
  state: SplitCheckboxState,
  result: Map<string, Buffer | undefined>,
): void {
  const path = entry.path;

  if (entry.hunks !== undefined) {
    // Per-line entries win over the file-level entry, so hunk-model files are always
    // reconstructed line by line; lines without an entry fall back to the file-level state.
    const content = reconstructHunkModel(entry, state);
    // A deleted file whose lines are all removed, and an added file whose lines are all
    // excluded, are absent — not emptied — on the reconstructed right side.
    result.set(path, (entry.status === "D" || entry.status === "A") && content.length === 0 ? undefined : content);
    return;
  }

  const fileState = state.files[path];
  const checked = fileState ?? true;
  switch (entry.status) {
    case "A":
      result.set(path, checked ? decodeBase64(entry.rightBase64) : undefined);
      return;
    case "D":
      result.set(path, checked ? undefined : decodeBase64(entry.leftBase64));
      return;
    default:
      if (entry.renamedFrom !== undefined) {
        result.set(entry.renamedFrom, checked ? undefined : decodeBase64(entry.leftBase64));
        result.set(path, checked ? decodeBase64(entry.rightBase64) : undefined);
      } else {
        result.set(path, checked ? decodeBase64(entry.rightBase64) : decodeBase64(entry.leftBase64));
      }
      return;
  }
}

function reconstructHunkModel(entry: SplitFileEntry, state: SplitCheckboxState): Buffer {
  const leftLines = splitFileLines(decodeBase64(entry.leftBase64)?.toString("utf8") ?? "");
  const out: string[] = [];
  let leftCount = 0;
  let rightCount = 0;
  for (const hunk of entry.hunks ?? []) {
    const first = hunk.lines[0];
    if (first === undefined) {
      continue;
    }
    // Context lines before the hunk: anchored on the first deleted line's old line number, or on
    // the first added line's new line number for pure insertions.
    const contextCount =
      first.kind === "del" ? (first.oldLine ?? 0) - 1 - leftCount : (first.newLine ?? 0) - 1 - rightCount;
    if (contextCount > 0) {
      for (const line of leftLines.slice(leftCount, leftCount + contextCount)) {
        out.push(line);
      }
      leftCount += contextCount;
      rightCount += contextCount;
    }
    for (const line of hunk.lines) {
      if (line.kind === "del") {
        if (!getLineChecked(entry.path, line, state)) {
          out.push(line.text);
        }
        leftCount++;
      } else if (line.kind === "add") {
        if (getLineChecked(entry.path, line, state)) {
          out.push(line.text);
        }
        rightCount++;
      } else {
        out.push(line.text);
        leftCount++;
        rightCount++;
      }
    }
  }
  for (const line of leftLines.slice(leftCount)) {
    out.push(line);
  }
  return Buffer.from(out.join(""), "utf8");
}
