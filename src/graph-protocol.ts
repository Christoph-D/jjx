import type { ChangeId, FileStatusType, FullChangeId } from "./types";

export type { FullChangeId };

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
  parentChangeIds?: string[];
}

export interface ElidedChangeNode extends ChangeNodeBase {
  // A unique ID for each elided node.
  fakeId: string;
  branchType: "~";
}

export interface RegularChangeNode extends ChangeNodeBase {
  id: ChangeId;
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

export function getUniqueId(node: ChangeNode): string {
  return node.branchType === "~" ? node.fakeId : node.id.changeId;
}

export interface LaneNode {
  lane: number;
  changeId: FullChangeId;
  colorIndex: number;
  numLanesActiveVisually: number;
}

interface LaneEdge {
  fromRow: number;
  toRow: number;
  lanePath: number[];
  fromId: FullChangeId;
  toId: FullChangeId;
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
  | { command: "fetchDiffStats"; changeId: FullChangeId }
  | { command: "editChange"; changeId: FullChangeId }
  | { command: "editChangeDirect"; changeId: FullChangeId }
  | { command: "newChildChange"; changeId: FullChangeId }
  | { command: "selectChange"; selectedNodes: string[] }
  | { command: "moveBookmark"; bookmark: string; targetChangeId: FullChangeId }
  | { command: "createBookmark"; targetChangeId: FullChangeId }
  | { command: "createTag"; targetChangeId: FullChangeId }
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
  | { command: "describeChange"; changeId: FullChangeId }
  | { command: "absorbChange"; changeId: FullChangeId }
  | { command: "abandonChange"; changeId: FullChangeId }
  | { command: "abandonChanges"; changeIds: string[] }
  | { command: "rebaseOnto"; changeId: FullChangeId; targetChangeId: FullChangeId; withDescendants: boolean }
  | { command: "rebaseAfter"; changeId: FullChangeId; targetChangeId: FullChangeId; withDescendants: boolean }
  | { command: "rebaseBefore"; changeId: FullChangeId; targetChangeId: FullChangeId; withDescendants: boolean }
  | { command: "rebaseAddParent"; changeId: FullChangeId; targetChangeId: FullChangeId }
  | { command: "rebaseRemoveParent"; changeId: FullChangeId; targetChangeId: FullChangeId }
  | { command: "squashInto"; changeId: FullChangeId; targetChangeId: FullChangeId }
  | { command: "duplicateOnto"; changeId: FullChangeId; targetChangeId: FullChangeId }
  | { command: "duplicateAfter"; changeId: FullChangeId; targetChangeId: FullChangeId }
  | { command: "duplicateBefore"; changeId: FullChangeId; targetChangeId: FullChangeId }
  | { command: "revertOnto"; changeId: FullChangeId; targetChangeId: FullChangeId }
  | { command: "revertAfter"; changeId: FullChangeId; targetChangeId: FullChangeId }
  | { command: "revertBefore"; changeId: FullChangeId; targetChangeId: FullChangeId }
  | { command: "copyUrl"; changeId: FullChangeId }
  | {
      command: "openFileDiff";
      changeId: FullChangeId;
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
  | { command: "diffStatsResponse"; changeId: FullChangeId; stats: DiffStats }
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
