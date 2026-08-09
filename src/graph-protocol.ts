import type { ChangeId, FileStatusType } from "./types";

export interface LogEntryLocalRef {
  name: string;
  synced: boolean;
  conflict: boolean;
  showPushButton?: boolean;
}

export interface LogEntryRemoteRef {
  name: string;
  remote: string;
}

interface ChangedFile {
  type: FileStatusType;
  path: string;
  renamedFrom?: string;
  conflict: boolean;
}

interface ChangeNodeBase {
  id: ChangeId;
  parentChangeIds?: string[];
}

export interface ElidedChangeNode extends ChangeNodeBase {
  branchType: "~";
}

export interface RegularChangeNode extends ChangeNodeBase {
  label: string;
  description: string;
  tooltip: string;
  currentWorkingCopy: boolean;
  localBookmarks: LogEntryLocalRef[];
  remoteBookmarks: LogEntryRemoteRef[];
  localTags: LogEntryLocalRef[];
  remoteTags: LogEntryRemoteRef[];
  workingCopies: string[];
  branchType: "@" | "◆" | "○";
  authorName: string;
  authorEmail: string;
  authorTimestamp: string;
  fullDescription: string;
  mine: boolean;
  conflict: boolean;
  isEmpty: boolean;
  elided?: number;
  changedFiles?: ChangedFile[];
}

export type ChangeNode = ElidedChangeNode | RegularChangeNode;

export interface LaneNode {
  lane: number;
  changeId: string;
  colorIndex: number;
  numLanesActiveVisually: number;
}

interface LaneEdge {
  fromRow: number;
  toRow: number;
  lanePath: number[];
  fromId: string;
  toId: string;
  colorIndex: number;
  extendsToBottom?: boolean;
}

export interface ChangeIdGraph {
  nodes: LaneNode[];
  edges: LaneEdge[];
}

export interface DiffStats {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

export type WebviewToExtensionMessage =
  | { command: "webviewReady" }
  | { command: "fetchDiffStats"; changeId: string }
  | { command: "editChange"; changeId: string }
  | { command: "editChangeDirect"; changeId: string }
  | { command: "newChildChange"; changeId: string }
  | { command: "selectChange"; selectedNodes: string[] }
  | { command: "moveBookmark"; bookmark: string; targetChangeId: string }
  | { command: "createBookmark"; targetChangeId: string }
  | { command: "createTag"; targetChangeId: string }
  | { command: "pushBookmark"; bookmark: string }
  | { command: "pushBookmarkToRemote"; bookmark: string; remote: string }
  | { command: "getBookmarkTrackingRemotes"; bookmark: string }
  | { command: "trackBookmark"; bookmark: string; remote: string }
  | { command: "untrackBookmark"; bookmark: string; remote: string }
  | { command: "deleteBookmark"; bookmark: string }
  | { command: "deleteTag"; tag: string }
  | { command: "getTagPushRemotes"; tag: string }
  | { command: "pushTagToRemote"; tag: string; remote: string }
  | { command: "getTagTrackingRemotes"; tag: string }
  | { command: "trackTag"; tag: string; remote: string }
  | { command: "untrackTag"; tag: string; remote: string }
  | { command: "pushTag"; tag: string }
  | { command: "getRemoteRefStatus"; refType: "bookmark" | "tag"; name: string; remote: string }
  | { command: "pushRemoteRef"; refType: "bookmark" | "tag"; name: string; remote: string }
  | { command: "deleteRemoteRef"; refType: "bookmark" | "tag"; name: string; remote: string }
  | { command: "restoreRemoteRef"; refType: "bookmark" | "tag"; name: string; remote: string }
  | { command: "describeChange"; changeId: string }
  | { command: "absorbChange"; changeId: string }
  | { command: "abandonChange"; changeId: string }
  | { command: "abandonChanges"; changeIds: string[] }
  | { command: "rebaseOnto"; changeId: string; targetChangeId: string; withDescendants: boolean }
  | { command: "rebaseAfter"; changeId: string; targetChangeId: string; withDescendants: boolean }
  | { command: "rebaseBefore"; changeId: string; targetChangeId: string; withDescendants: boolean }
  | { command: "rebaseAddParent"; changeId: string; targetChangeId: string }
  | { command: "rebaseRemoveParent"; changeId: string; targetChangeId: string }
  | { command: "squashInto"; changeId: string; targetChangeId: string }
  | { command: "duplicateOnto"; changeId: string; targetChangeId: string }
  | { command: "duplicateAfter"; changeId: string; targetChangeId: string }
  | { command: "duplicateBefore"; changeId: string; targetChangeId: string }
  | { command: "revertOnto"; changeId: string; targetChangeId: string }
  | { command: "revertAfter"; changeId: string; targetChangeId: string }
  | { command: "revertBefore"; changeId: string; targetChangeId: string }
  | { command: "copyUrl"; changeId: string }
  | {
      command: "openFileDiff";
      changeId: string;
      path: string;
      status: FileStatusType;
      renamedFrom?: string;
    }
  | { command: "updateStale" }
  | { command: "reportError"; message: string; stack?: string };

export type ExtensionToWebviewMessage =
  | {
      command: "updateGraph";
      changes: ChangeNode[];
      laneInfo: ChangeIdGraph;
      changeDoubleClickAction: string;
      graphStyle: string;
      maxPrefixLength: number;
      offsetWidth: number;
      preserveScroll: boolean;
      showTooltips: boolean;
      showChangedFiles: boolean;
      supportsTagTracking: boolean;
    }
  | { command: "showStaleState" }
  | { command: "showJJNotFoundState" }
  | { command: "showNoRepoFoundState" }
  | { command: "showErrorState" }
  | { command: "diffStatsResponse"; changeId: string; stats: DiffStats }
  | {
      command: "bookmarkTrackingRemotesResponse";
      bookmark: string;
      remotes: string[];
      unsyncedRemotes?: string[];
      untrackedRemotes?: string[];
    }
  | { command: "tagPushRemotesResponse"; tag: string; pushRemotes: string[] }
  | { command: "pushBookmarkDone"; bookmark: string }
  | { command: "tagTrackingRemotesResponse"; tag: string; remotes: string[] }
  | { command: "pushTagDone"; tag: string }
  | {
      command: "remoteRefStatusResponse";
      refType: "bookmark" | "tag";
      name: string;
      remote: string;
      found: boolean;
      tracked: boolean;
      synced: boolean;
      present: boolean;
    };
