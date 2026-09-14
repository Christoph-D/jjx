import { signal } from "@preact/signals";
import type { ChangeDetails, ChangedFileDelta, ChangeId } from "../../types";
import type { DetailsExtensionToWebviewMessage, DetailsWebviewToExtensionMessage } from "../../details-protocol";

export interface VSCodeAPI {
  postMessage(message: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

export let vscode: VSCodeAPI;

export function initVsCodeApi() {
  vscode = acquireVsCodeApi();
}

export function postMessage(message: DetailsWebviewToExtensionMessage): void {
  vscode.postMessage(message);
}

export type DetailsState =
  { kind: "loading" } | { kind: "noSelection" } | { kind: "error" } | { kind: "single"; change: ChangeDetails };

export const detailsState = signal<DetailsState>({ kind: "loading" });

export function applyExtensionMessage(message: DetailsExtensionToWebviewMessage): void {
  switch (message.command) {
    case "showNoSelection":
      detailsState.value = { kind: "noSelection" };
      break;
    case "updateDetails":
      detailsState.value = { kind: "single", change: message.change };
      break;
    case "showErrorState":
      detailsState.value = { kind: "error" };
      break;
  }
}

export interface FileContextMenuState {
  change: ChangeDetails;
  file: ChangedFileDelta;
  clientX: number;
  clientY: number;
}

export const fileContextMenu = signal<FileContextMenuState | null>(null);

export function closeFileContextMenu(): void {
  fileContextMenu.value = null;
}

export interface TextContextMenuState {
  text: string;
  clientX: number;
  clientY: number;
}

export const textContextMenu = signal<TextContextMenuState | null>(null);

export function closeTextContextMenu(): void {
  textContextMenu.value = null;
}

/** The context menu opened by right-clicking a Change ID or Commit ID value. */
export interface IdContextMenuState {
  kind: "change" | "commit";
  /** The full ID as shown in the view (with the `/offset` suffix only for divergent changes). */
  fullId: string;
  /** The short ID as shown elsewhere in the extension. */
  shortId: string;
  clientX: number;
  clientY: number;
}

export const idContextMenu = signal<IdContextMenuState | null>(null);

export function closeIdContextMenu(): void {
  idContextMenu.value = null;
}

/** The short change ID as the graph view shows it (prefix plus alignment suffix and offset). */
export function formatShortChangeId(changeId: ChangeId): string {
  const short = changeId.changeIdPrefix + changeId.changeIdSuffix;
  return changeId.changeOffset ? `${short}/${changeId.changeOffset}` : short;
}

/**
 * The full change ID as the graph view shows it. The stored full ID embeds the `/offset` suffix
 * whenever jj reports one — even when it is not needed to disambiguate a non-divergent change —
 * so drop it unless `changeOffset` marks the change as divergent. The stored full ID itself
 * (with the offset) is still the form jj commands expect.
 */
export function formatFullChangeId(changeId: ChangeId): string {
  return changeId.changeOffset ? changeId.changeId : changeId.changeId.split("/")[0];
}
