import type { SplitCheckboxState, SplitFileEntry } from "./split/hunk-model";

/**
 * A {@link SplitFileEntry} reduced to the data the Split view needs. The base64 contents
 * (used for reconstruction on the extension side) are stripped to keep IPC messages small;
 * the decoded text is kept so the view can build the hunk model.
 */
export type SplitViewFileEntry = Omit<SplitFileEntry, "hunks" | "leftBase64" | "rightBase64">;

export interface SplitCommitMetadata {
  // Short, human-readable change id of the commit being split.
  shortChangeId: string;
  // First line of the change description.
  descriptionFirstLine: string;
}

export type SplitWebviewToExtensionMessage =
  | { command: "webviewReady" }
  // Sent on every checkbox change so the extension holds the latest selection even when
  // the panel is closed without confirming (webviews cannot deliver messages during disposal).
  | { command: "stateChanged"; state: SplitCheckboxState }
  // Sent when the user confirms the selection; `state` is the full checked-state model
  // consumable by the Phase E reconstruction.
  | { command: "split"; state: SplitCheckboxState }
  // Sent when the user aborts without a repo operation.
  | { command: "cancel" };

export type SplitExtensionToWebviewMessage = {
  command: "updateSplitFiles";
  entries: SplitViewFileEntry[];
  metadata: SplitCommitMetadata;
};

/** Strips the fields the Split view does not need before sending entries over IPC. */
export function toSplitViewEntries(entries: readonly SplitFileEntry[]): SplitViewFileEntry[] {
  return entries.map((entry) => ({
    path: entry.path,
    renamedFrom: entry.renamedFrom,
    status: entry.status,
    binary: entry.binary,
    conflict: entry.conflict,
    modeChangedFrom: entry.modeChangedFrom,
    modeChangedTo: entry.modeChangedTo,
    leftText: entry.leftText,
    rightText: entry.rightText,
  }));
}
