export interface VSCodeAPI {
  postMessage(message: unknown): void;
}

export const rootChangeId = "z".repeat(32);
export const SWIMLANE_WIDTH = 14;
export const CIRCLE_RADIUS = 5;
export const EDGE_EXTENSION = 20;
export const CHANGE_ID_RIGHT_PADDING = 6;

export const colorRegistry = [
  "rgba(from var(--vscode-charts-blue) r g b / 100%)",
  "rgba(from var(--vscode-charts-purple) r g b / 100%)",
  "rgba(from var(--vscode-charts-orange) r g b / 100%)",
  "rgba(from var(--vscode-charts-green) r g b / 100%)",
  "rgba(from var(--vscode-charts-red) r g b / 100%)",
];

export interface LaneNode {
  lane: number;
  colorIndex: number;
  numLanesActiveVisually: number;
}

export interface LaneEdge {
  fromRow: number;
  fromId: string;
  toId: string;
  colorIndex: number;
  lanePath: number[];
  extendsToBottom: boolean;
}

export interface ChangeIdGraph {
  nodes: LaneNode[];
  edges: LaneEdge[];
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
  localBookmarks: { name: string; conflict: boolean; synced: boolean }[];
  remoteBookmarks: { name: string; remote: string }[];
  localTags: { name: string; conflict: boolean; synced: boolean }[];
  remoteTags: { name: string; remote: string }[];
  workingCopies: string[];
  parentChangeIds?: string[];
  branchType?: string;
  authorName: string;
  authorEmail: string;
  authorTimestamp: string;
  fullDescription: string;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  mine: boolean;
  conflict: boolean;
  elided?: number;
}
