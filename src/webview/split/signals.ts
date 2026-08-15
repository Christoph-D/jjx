import { signal } from "@preact/signals";
import type { SplitCheckboxState } from "../../split/hunk-model";
import {
  createSplitCheckboxState,
  getLineChecked,
  setAllFilesChecked,
  setLineChecked,
  setModeChecked,
  setRenameChecked,
} from "../../split/hunk-model";
import type {
  SplitCommitMetadata,
  SplitExtensionToWebviewMessage,
  SplitWebviewToExtensionMessage,
  SplitViewFileEntry,
} from "../../split-protocol";
import type { SplitHunk, SplitLine } from "../../split/hunk-model";
import type { SplitFileViewModel, SplitRowId } from "./view-model";
import {
  hunkKey,
  toggleSplitFileChecked,
  toggleSplitHunkChecked,
  toggleSplitModeChecked,
  toggleSplitRenameChecked,
} from "./view-model";

export interface VSCodeAPI {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

export let vscode: VSCodeAPI;

export function initVsCodeApi() {
  vscode = acquireVsCodeApi();
}

export function postMessage(message: SplitWebviewToExtensionMessage): void {
  vscode.postMessage(message);
}

export function applyExtensionMessage(message: SplitExtensionToWebviewMessage): void {
  entries.value = message.entries;
  metadata.value = message.metadata;
  // Restores the selection the extension sent along, so a webview restored after being
  // unloaded keeps the user's in-progress selection.
  checkState.value = message.selection;
  // The refreshed entry list invalidates any row selection.
  selectedRow.value = null;
  postCurrentState();
}

export const entries = signal<SplitViewFileEntry[]>([]);
export const metadata = signal<SplitCommitMetadata | null>(null);
export const checkState = signal<SplitCheckboxState>(createSplitCheckboxState());
export const expandedFiles = signal<Set<string>>(new Set());

// Hunks are expanded by default (unlike files, which track the expanded set), so
// only the collapsed ones are tracked here. Keyed by `hunkKey`.
export const collapsedHunks = signal<Set<string>>(new Set());

// The row currently selected by arrow-key navigation, outlined on screen; null until the
// first keypress or row click. Tracked by the app instead of DOM focus, so the outline does
// not depend on focus order.
export const selectedRow = signal<SplitRowId | null>(null);

/** Selects `id` (or clears the selection with null), the single source of truth for the outline. */
export function selectSplitRow(id: SplitRowId | null): void {
  selectedRow.value = id;
}

export function setFileExpanded(path: string, expanded: boolean): void {
  const next = new Set(expandedFiles.value);
  if (expanded) {
    next.add(path);
  } else {
    next.delete(path);
  }
  expandedFiles.value = next;
}

export function toggleFileExpanded(path: string): void {
  setFileExpanded(path, !expandedFiles.value.has(path));
}

/** Expands (or collapses) every expandable file at once; `paths` are the expandable file paths. */
export function setAllFilesExpanded(paths: readonly string[], expanded: boolean): void {
  expandedFiles.value = expanded ? new Set(paths) : new Set();
}

/** Collapses (or expands) a hunk, keyed like `collapsedHunks`. */
export function setHunkCollapsed(path: string, index: number, collapsed: boolean): void {
  const key = hunkKey(path, index);
  const next = new Set(collapsedHunks.value);
  if (collapsed) {
    next.add(key);
  } else {
    next.delete(key);
  }
  collapsedHunks.value = next;
}

/** Toggles a hunk's collapse state, keyed like `collapsedHunks`. */
export function toggleHunkCollapsed(path: string, index: number): void {
  setHunkCollapsed(path, index, !collapsedHunks.value.has(hunkKey(path, index)));
}

/** Reassigns the signal with a shallow clone so mutations become visible to subscribers. */
function commitStateChange(state: SplitCheckboxState): void {
  checkState.value = {
    files: { ...state.files },
    lines: { ...state.lines },
    renames: { ...state.renames },
    modes: { ...state.modes },
  };
  postCurrentState();
}

/** Keeps the extension's mirror of the selection current, so a panel close can still apply it. */
function postCurrentState(): void {
  postMessage({ command: "stateChanged", state: checkState.value });
}

/** Toggles the "Select Everything" checkbox across every file at once. */
export function setAllFilesCheckState(entries: readonly SplitViewFileEntry[], checked: boolean): void {
  const state = checkState.value;
  setAllFilesChecked(entries, state, checked);
  commitStateChange(state);
}
/** Toggles a renamed file's "File Renamed" checkbox, independent of its content hunks. */
export function setRenameCheckState(path: string, checked: boolean): void {
  const state = checkState.value;
  setRenameChecked(path, state, checked);
  commitStateChange(state);
}

/** Toggles a file's "File mode changed" checkbox, independent of its content hunks. */
export function setModeCheckState(path: string, checked: boolean): void {
  const state = checkState.value;
  setModeChecked(path, state, checked);
  commitStateChange(state);
}

/** Toggles a renamed file's "File Renamed" checkbox like a row click, independent of its content hunks. */
export function toggleRenameChecked(path: string): void {
  const state = checkState.value;
  toggleSplitRenameChecked(path, state);
  commitStateChange(state);
}

/** Toggles a file's "File mode changed" checkbox like a row click, independent of its content hunks. */
export function toggleModeChecked(path: string): void {
  const state = checkState.value;
  toggleSplitModeChecked(path, state);
  commitStateChange(state);
}

export function toggleLineChecked(path: string, line: SplitLine): void {
  const state = checkState.value;
  setLineChecked(path, line, state, !getLineChecked(path, line, state));
  commitStateChange(state);
}

/**
 * Toggles every checkable of a file like a line row: a fully unchecked file checks all of its
 * lines (plus its rename and mode change), otherwise everything is unchecked.
 */
export function toggleFileChecked(file: SplitFileViewModel): void {
  const state = checkState.value;
  toggleSplitFileChecked(file, state);
  commitStateChange(state);
}

/** Toggles every line of a hunk like a line row: fully unchecked checks them, otherwise unchecks. */
export function toggleHunkChecked(path: string, hunk: SplitHunk): void {
  const state = checkState.value;
  toggleSplitHunkChecked(path, hunk, state);
  commitStateChange(state);
}
