import { signal } from "@preact/signals";
import type { VSCodeAPI } from "./types";
import type {
  ChangeNode,
  ChangeIdGraph,
  DiffStats,
  RegularChangeNode,
  WebviewToExtensionMessage,
  FullChangeId,
  ChangedFile,
} from "../../graph-protocol";

declare function acquireVsCodeApi(): VSCodeAPI;

export let vscode: VSCodeAPI;

export function initVsCodeApi() {
  vscode = acquireVsCodeApi();
}

export function postMessage(message: WebviewToExtensionMessage): void {
  vscode.postMessage(message);
}

export const currentChanges = signal<ChangeNode[]>([]);
export const currentGraph = signal<ChangeIdGraph | null>(null);
export const selectedNodes = signal<Set<FullChangeId>>(new Set());
export const selectionAnchorId = signal<FullChangeId | null>(null);
export const isDragging = signal(false);
export const dragStartChangeId = signal<string | null>(null);
export const dragBookmarkName = signal<string | null>(null);
export const dropTargetId = signal<string | null>(null);
export const hoveredChangeId = signal<string | null>(null);
export const justFinishedDrag = signal(false);
export const maxPrefixLength = signal(4);
export const changeIdHorizontalOffset = signal(0);
export const isStale = signal(false);
export const isJJNotFound = signal(false);
export const isNoRepoFound = signal(false);
export const isError = signal(false);
export const graphStyle = signal("full");
export const changeDoubleClickAction = signal("new");
export const showTooltips = signal(true);
export const showChangedFiles = signal(false);
export const supportsTagTracking = signal(false);
export const currentWorkspace = signal<string | null>(null);
export const scrollY = signal(0);
export const offsetWidth = signal(0);
export const tooltipTimeout = signal<ReturnType<typeof setTimeout> | null>(null);
export const tooltipHideTimeout = signal<ReturnType<typeof setTimeout> | null>(null);
export const diffStatsPrefetchTimeout = signal<ReturnType<typeof setTimeout> | null>(null);

interface ContextMenuState {
  change: RegularChangeNode;
  pageX: number;
  pageY: number;
  changeDoubleClickAction: string;
}

interface RebaseMenuState {
  sourceId: FullChangeId;
  sourceIds: FullChangeId[];
  targetId: FullChangeId;
  targetChange: RegularChangeNode;
  pageX: number;
  pageY: number;
}

interface TooltipState {
  change: RegularChangeNode;
  pageX: number;
  pageY: number;
}

export const contextMenu = signal<ContextMenuState | null>(null);
export const rebaseMenu = signal<RebaseMenuState | null>(null);
export const tooltip = signal<TooltipState | null>(null);
export const diffStatsCache = signal<Map<string, DiffStats>>(new Map());

interface HighlightState {
  focalId: string;
  connectedIds: Set<string>;
}
export const connectedHighlight = signal<HighlightState | null>(null);

export interface PendingGraphUpdate {
  changes: ChangeNode[];
  laneInfo: import("../../graph-protocol").ChangeIdGraph;
  changeDoubleClickAction: string;
  graphStyle: string;
  maxPrefixLength: number;
  offsetWidth: number;
  preserveScroll: boolean;
  showTooltips: boolean;
  showChangedFiles: boolean;
  supportsTagTracking: boolean;
  currentWorkspace: string | undefined;
}

interface PillContextMenuState {
  type: "bookmark" | "tag" | "workspace";
  name: string;
  pageX: number;
  pageY: number;
  synced?: boolean;
  remotes?: string[];
  unsyncedRemotes?: string[];
  untrackedRemotes?: string[];
  pendingRemotes?: boolean;
  /** When set, the ref is being pushed: show only a "Cancel Push" action. */
  cancelPush?: boolean;
}

export const pillContextMenu = signal<PillContextMenuState | null>(null);

interface RemoteRefContextMenuState {
  type: "bookmark" | "tag";
  name: string;
  remote: string;
  change: RegularChangeNode;
  pageX: number;
  pageY: number;
  changeDoubleClickAction: string;
  pendingStatus?: boolean;
  action?: "delete" | "push" | "track";
  /** When set, the ref is being deleted from the remote: show only a "Cancel Deletion" action. */
  cancelDelete?: boolean;
}

export const remoteRefContextMenu = signal<RemoteRefContextMenuState | null>(null);

interface FileContextMenuState {
  change: RegularChangeNode;
  file: ChangedFile;
  pageX: number;
  pageY: number;
}

export const fileContextMenu = signal<FileContextMenuState | null>(null);

export const pendingGraphUpdate = signal<PendingGraphUpdate | null>(null);

export const pushingBookmarks = signal<Set<string>>(new Set());
export const pushingTags = signal<Set<string>>(new Set());
export const deletingBookmarks = signal<Set<string>>(new Set());
export const deletingTags = signal<Set<string>>(new Set());

export function closeAllMenus() {
  contextMenu.value = null;
  rebaseMenu.value = null;
  pillContextMenu.value = null;
  remoteRefContextMenu.value = null;
  fileContextMenu.value = null;
}
