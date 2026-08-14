import { signal } from "@preact/signals";
import type { SplitCheckboxState } from "../../split/hunk-model";
import {
  createSplitCheckboxState,
  getLineChecked,
  setFileChecked,
  setHunkChecked,
  setLineChecked,
  setRenameChecked,
} from "../../split/hunk-model";
import type {
  SplitCommitMetadata,
  SplitExtensionToWebviewMessage,
  SplitWebviewToExtensionMessage,
  SplitViewFileEntry,
} from "../../split-protocol";
import type { SplitHunk, SplitLine } from "../../split/hunk-model";

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
  checkState.value = createSplitCheckboxState();
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
  checkState.value = { files: { ...state.files }, lines: { ...state.lines }, renames: { ...state.renames } };
  postCurrentState();
}

/** Keeps the extension's mirror of the selection current, so a panel close can still apply it. */
function postCurrentState(): void {
  postMessage({ command: "stateChanged", state: checkState.value });
}

export function setFileCheckState(path: string, checked: boolean): void {
  const state = checkState.value;
  setFileChecked(path, state, checked);
  commitStateChange(state);
}

export function setHunkCheckState(path: string, hunk: SplitHunk, checked: boolean): void {
  const state = checkState.value;
  setHunkChecked(path, hunk, state, checked);
  commitStateChange(state);
}

/** Toggles a renamed file's "File Renamed" checkbox, independent of its content hunks. */
export function setRenameCheckState(path: string, checked: boolean): void {
  const state = checkState.value;
  setRenameChecked(path, state, checked);
  commitStateChange(state);
}

export function toggleLineChecked(path: string, line: SplitLine): void {
  const state = checkState.value;
  setLineChecked(path, line, state, !getLineChecked(path, line, state));
  commitStateChange(state);
}
