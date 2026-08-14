import { diffArrays, type ArrayChange } from "diff";
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
 * entries. The rename checkboxes of renamed files are recorded separately (keyed by the renamed
 * file's path) and fall back to the file-level entry the same way.
 */
export interface SplitCheckboxState {
  files: Record<string, boolean>;
  lines: Record<string, Record<string, boolean>>;
  renames: Record<string, boolean>;
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

/** A maximal run of changed lines: removed lines and added lines at one boundary. */
interface ChangeRun {
  dels: string[];
  adds: string[];
}

type CtxBlock = { kind: "ctx"; texts: string[] };
type RunBlock = { kind: "run" } & ChangeRun;

/** A diff as alternating blocks of unchanged lines and runs of changed lines. */
type DiffBlock = CtxBlock | RunBlock;

/** Groups the differ's chunks into runs of changed lines separated by unchanged lines. */
function chunkTokensToBlocks(changes: ArrayChange<string>[]): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  for (const change of changes) {
    if (change.added) {
      appendRun(blocks).adds.push(...change.value);
    } else if (change.removed) {
      appendRun(blocks).dels.push(...change.value);
    } else {
      const last = blocks[blocks.length - 1];
      if (last?.kind === "ctx") {
        last.texts.push(...change.value);
      } else {
        blocks.push({ kind: "ctx", texts: [...change.value] });
      }
    }
  }
  return blocks;
}

/** Opens a run block for appending; a removed chunk followed by an added chunk joins one run. */
function appendRun(blocks: DiffBlock[]): ChangeRun {
  const last = blocks[blocks.length - 1];
  if (last?.kind === "run") {
    return last;
  }
  const run: RunBlock = { kind: "run", dels: [], adds: [] };
  blocks.push(run);
  return run;
}

/** True if the run can slide down past the first unchanged line of the gap behind it. */
function canSlideDown(run: ChangeRun, gapText: string): boolean {
  if (run.dels.length > 0 && run.adds.length > 0) {
    // Both sides release their leading line, which re-pairs as a new unchanged pair.
    return run.dels[0] === run.adds[0];
  }
  // A one-sided run releases its leading line, paired with the gap line it slides past.
  const leading = run.dels[0] ?? run.adds[0];
  return leading !== undefined && leading === gapText;
}

/** True if the run can slide up past the last unchanged line of the gap ahead of it. */
function canSlideUp(run: ChangeRun, gapText: string): boolean {
  if (run.dels.length > 0 && run.adds.length > 0) {
    // Both sides release their trailing line, which re-pairs as a new unchanged pair.
    return run.dels[run.dels.length - 1] === run.adds[run.adds.length - 1];
  }
  // A one-sided run releases its trailing line, paired with the gap line it slides past.
  const trailing = run.dels.length > 0 ? run.dels[run.dels.length - 1] : run.adds[run.adds.length - 1];
  return trailing !== undefined && trailing === gapText;
}

/**
 * Slides the run down past the first line of its following gap. The gap line joins the run and
 * the run's released line re-pairs with the gap's other side, landing in the preceding
 * unchanged lines — so the gap between the run and the next run shrinks by one line.
 */
function slideDown(run: ChangeRun, preceding: string[], gap: string[]): void {
  const gapText = gap.shift() as string;
  if (run.dels.length > 0 && run.adds.length > 0) {
    preceding.push(run.dels.shift() as string);
    run.adds.shift();
    run.dels.push(gapText);
    run.adds.push(gapText);
  } else if (run.dels.length > 0) {
    preceding.push(run.dels.shift() as string);
    run.dels.push(gapText);
  } else {
    preceding.push(run.adds.shift() as string);
    run.adds.push(gapText);
  }
}

/**
 * Slides the run up past the last line of its preceding gap — the mirror of slideDown; the gap
 * between the previous run and this run shrinks by one line.
 */
function slideUp(run: ChangeRun, gap: string[], following: string[]): void {
  const gapText = gap.pop() as string;
  if (run.dels.length > 0 && run.adds.length > 0) {
    run.dels.pop();
    following.unshift(run.adds.pop() as string);
    run.dels.unshift(gapText);
    run.adds.unshift(gapText);
  } else if (run.dels.length > 0) {
    following.unshift(run.dels.pop() as string);
    run.dels.unshift(gapText);
  } else {
    following.unshift(run.adds.pop() as string);
    run.adds.unshift(gapText);
  }
}

/**
 * Merges runs of changed lines that only stay apart because the differ paired the "wrong" one of
 * several equal lines, like a modification the differ splits into a separate addition and
 * deletion around an unchanged line (git's change compaction pairs such lines into one hunk).
 * Two runs separated only by unchanged lines are slid together whenever sliding can close the
 * whole gap; runs that cannot reach each other keep the differ's pairing.
 */
function mergeRuns(blocks: DiffBlock[]): DiffBlock[] {
  let i = 0;
  while (i + 2 < blocks.length) {
    const left = blocks[i];
    const gap = blocks[i + 1];
    const right = blocks[i + 2];
    if (left.kind !== "run" || gap.kind !== "ctx" || gap.texts.length === 0 || right.kind !== "run") {
      i++;
      continue;
    }
    if (!closeGap(blocks, i, left, gap, right)) {
      i++;
      continue;
    }
    // The merged run may now reach its predecessor, whose trailing run changed with the merge,
    // so the scan resumes just behind the merged run instead of running past it.
    i = Math.max(0, i - 2);
  }
  return blocks;
}

/** The unchanged block at i, if any; run/gap neighbors of a merge attempt are looked up this way. */
function ctxAt(blocks: DiffBlock[], i: number): CtxBlock | undefined {
  const block = blocks[i];
  return i >= 0 && i < blocks.length && block !== undefined && block.kind === "ctx" ? block : undefined;
}

/**
 * Tries to close the unchanged gap between the runs at i and i+2 by sliding them together; on
 * success merges the runs in place and returns true, on failure leaves the blocks untouched.
 */
function closeGap(blocks: DiffBlock[], i: number, left: RunBlock, gap: CtxBlock, right: RunBlock): boolean {
  // Slides mutate the blocks around the gap, so a partial attempt that fails to close the gap
  // is abandoned by working on copies of just the affected window.
  const precedingBlock = ctxAt(blocks, i - 1);
  const followingBlock = ctxAt(blocks, i + 3);
  const preceding = [...(precedingBlock?.texts ?? [])];
  const leftCopy: RunBlock = { kind: "run", dels: [...left.dels], adds: [...left.adds] };
  const gapTexts = [...gap.texts];
  const rightCopy: RunBlock = { kind: "run", dels: [...right.dels], adds: [...right.adds] };
  const following = [...(followingBlock?.texts ?? [])];
  // Slide the later run up first so deletions land ahead of additions in the merged run.
  while (gapTexts.length > 0 && canSlideUp(rightCopy, gapTexts[gapTexts.length - 1])) {
    slideUp(rightCopy, gapTexts, following);
  }
  while (gapTexts.length > 0 && canSlideDown(leftCopy, gapTexts[0])) {
    slideDown(leftCopy, preceding, gapTexts);
  }
  if (gapTexts.length > 0) {
    return false;
  }
  left.dels = [...leftCopy.dels, ...rightCopy.dels];
  left.adds = [...leftCopy.adds, ...rightCopy.adds];
  // Splice the merged run in place; lines released by sliding land in the unchanged blocks
  // around it, synthesizing those blocks at the file's edges when needed.
  blocks.splice(i, 3, left);
  if (precedingBlock !== undefined) {
    precedingBlock.texts = preceding;
  } else if (preceding.length > 0) {
    blocks.splice(i, 0, { kind: "ctx", texts: preceding });
  }
  if (followingBlock !== undefined) {
    followingBlock.texts = following;
  } else if (following.length > 0) {
    blocks.splice(i + 1, 0, { kind: "ctx", texts: following });
  }
  return true;
}

/** Computes the full ordered left/right line model (context, added, and deleted lines). */
export function buildSplitLines(left: string, right: string): SplitLine[] {
  const blocks = mergeRuns(chunkTokensToBlocks(diffArrays(splitFileLines(left), splitFileLines(right))));
  const result: SplitLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const block of blocks) {
    if (block.kind === "ctx") {
      for (const text of block.texts) {
        result.push({ kind: "context", oldLine: oldLine++, newLine: newLine++, text });
      }
    } else {
      // Deleted lines come first within a run, mirroring git's rendering of modifications.
      for (const text of block.dels) {
        result.push({ kind: "del", oldLine: oldLine++, text });
      }
      for (const text of block.adds) {
        result.push({ kind: "add", newLine: newLine++, text });
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
 * Builds a file entry from whole-file contents. Modified, added, deleted, and renamed non-binary,
 * non-conflict text files get a hunk model; everything else (binary/conflict leaves and pure
 * renames, whose sides are identical) keeps whole-file contents only.
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
    if (
      (options.status === "M" || options.renamedFrom !== undefined) &&
      options.left !== undefined &&
      options.right !== undefined
    ) {
      // Renames diff the old path's content against the new path's; a pure rename yields no
      // hunks, so only the rename itself remains to be picked.
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
  return { files: {}, lines: {}, renames: {} };
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

/** Checkbox state of a file's rename ("File Renamed"); defaults to checked like line states. */
export function getRenameChecked(path: string, state: SplitCheckboxState): boolean {
  const renameState = state.renames[path];
  if (renameState !== undefined) {
    return renameState;
  }
  return state.files[path] ?? true;
}

export function getFileCheckState(entry: SplitFileEntry, state: SplitCheckboxState): SplitCheckState {
  if (entry.renamedFrom !== undefined) {
    // A renamed file's rename is its own checkable next to any content hunks, so the file-level
    // state combines both (a pure rename has no hunks and reduces to the rename state).
    const renameState = getRenameChecked(entry.path, state);
    if (!entry.hunks || entry.hunks.length === 0) {
      return renameState;
    }
    return combineCheckStates([renameState, ...entry.hunks.map((hunk) => getHunkCheckState(entry.path, hunk, state))]);
  }
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
  delete state.renames[path];
}

/** Records the "File Renamed" checkbox without touching the content hunk selection. */
export function setRenameChecked(path: string, state: SplitCheckboxState, checked: boolean): void {
  state.renames[path] = checked;
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

  if (entry.renamedFrom !== undefined) {
    // The rename is its own checkable next to any content hunks: when checked, the reconstructed
    // content lands at the new path (rename in the first commit); when unchecked, it stays at the
    // old path so the rename falls to the second commit. Selected content hunks apply to
    // whichever path the file lives on.
    const renameChecked = getRenameChecked(path, state);
    const content = entry.hunks !== undefined ? reconstructHunkModel(entry, state) : decodeBase64(entry.rightBase64);
    const oldContent = entry.hunks !== undefined ? content : decodeBase64(entry.leftBase64);
    result.set(entry.renamedFrom, renameChecked ? undefined : oldContent);
    result.set(path, renameChecked ? content : undefined);
    return;
  }

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
      result.set(path, checked ? decodeBase64(entry.rightBase64) : decodeBase64(entry.leftBase64));
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
