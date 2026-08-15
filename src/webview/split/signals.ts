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
import type { SplitFileViewModel } from "./view-model";
import {
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
  postCurrentState();
}

export const entries = signal<SplitViewFileEntry[]>([]);
export const metadata = signal<SplitCommitMetadata | null>(null);
export const checkState = signal<SplitCheckboxState>(createSplitCheckboxState());
export const expandedFiles = signal<Set<string>>(new Set());

// Hunks are expanded by default (unlike files, which track the expanded set), so
// only the collapsed ones are tracked here. Keyed by `hunkKey`.
export const collapsedHunks = signal<Set<string>>(new Set());

export function toggleFileExpanded(path: string): void {
  const next = new Set(expandedFiles.value);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  expandedFiles.value = next;
}

/** Expands (or collapses) every expandable file at once; `paths` are the expandable file paths. */
export function setAllFilesExpanded(paths: readonly string[], expanded: boolean): void {
  expandedFiles.value = expanded ? new Set(paths) : new Set();
}

export function hunkKey(path: string, index: number): string {
  return `${path}:${index}`;
}

export function toggleHunkCollapsed(path: string, index: number): void {
  const key = hunkKey(path, index);
  const next = new Set(collapsedHunks.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  collapsedHunks.value = next;
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
