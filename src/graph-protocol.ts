export interface LogEntryLocalRef {
  name: string;
  synced: boolean;
  conflict: boolean;
}

export interface LogEntryRemoteRef {
  name: string;
  remote: string;
}

export interface ChangeNode {
  changeId: string;
  changeIdPrefix: string;
  changeIdSuffix: string;
  changeOffset: string | null;
  label: string;
  description: string;
  tooltip: string;
  currentWorkingCopy: boolean;
  localBookmarks: LogEntryLocalRef[];
  remoteBookmarks: LogEntryRemoteRef[];
  localTags: LogEntryLocalRef[];
  remoteTags: LogEntryRemoteRef[];
  workingCopies: string[];
  parentChangeIds?: string[];
  branchType?: string;
  authorName: string;
  authorEmail: string;
  authorTimestamp: string;
  fullDescription: string;
  mine: boolean;
  conflict: boolean;
  elided?: number;
}

export interface LaneNode {
  lane: number;
  changeId: string;
  colorIndex: number;
  numLanesActiveVisually: number;
}

export interface LaneEdge {
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
  | { command: "selectChange"; selectedNodes: string[] }
  | { command: "moveBookmark"; bookmark: string; targetChangeId: string }
  | { command: "createBookmark"; targetChangeId: string }
  | { command: "createTag"; targetChangeId: string }
  | { command: "deleteBookmark"; bookmark: string }
  | { command: "deleteTag"; tag: string }
  | { command: "describeChange"; changeId: string }
  | { command: "abandonChange"; changeId: string }
  | { command: "rebaseOnto"; changeId: string; targetChangeId: string; withDescendants: boolean }
  | { command: "rebaseAfter"; changeId: string; targetChangeId: string; withDescendants: boolean }
  | { command: "rebaseBefore"; changeId: string; targetChangeId: string; withDescendants: boolean }
  | { command: "squashInto"; changeId: string; targetChangeId: string }
  | { command: "duplicateOnto"; changeId: string; targetChangeId: string }
  | { command: "duplicateAfter"; changeId: string; targetChangeId: string }
  | { command: "duplicateBefore"; changeId: string; targetChangeId: string }
  | { command: "revertOnto"; changeId: string; targetChangeId: string }
  | { command: "revertAfter"; changeId: string; targetChangeId: string }
  | { command: "revertBefore"; changeId: string; targetChangeId: string }
  | { command: "copyUrl"; changeId: string }
  | { command: "updateStale" };

export type ExtensionToWebviewMessage =
  | {
      command: "updateGraph";
      changes: ChangeNode[];
      laneInfo: ChangeIdGraph;
      changeEditAction: string;
      graphStyle: string;
      maxPrefixLength: number;
      offsetWidth: number;
      preserveScroll: boolean;
    }
  | { command: "showStaleState" }
  | { command: "diffStatsResponse"; changeId: string; stats: DiffStats };
