import { signal } from "@preact/signals";
import type { VSCodeAPI } from "./types";
import type { ChangeNode, ChangeIdGraph, DiffStats } from "../../graph-protocol";

declare function acquireVsCodeApi(): VSCodeAPI;

export let vscode: VSCodeAPI;

export function initVsCodeApi() {
  vscode = acquireVsCodeApi();
}

export const currentChanges = signal<ChangeNode[]>([]);
export const currentGraph = signal<ChangeIdGraph | null>(null);
export const selectedNodes = signal<Set<string>>(new Set());
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
export const scrollY = signal(0);
export const offsetWidth = signal(0);
export const tooltipTimeout = signal<ReturnType<typeof setTimeout> | null>(null);
export const tooltipHideTimeout = signal<ReturnType<typeof setTimeout> | null>(null);
export const diffStatsPrefetchTimeout = signal<ReturnType<typeof setTimeout> | null>(null);

interface ContextMenuState {
  change: ChangeNode;
  pageX: number;
  pageY: number;
  changeDoubleClickAction: string;
}

interface RebaseMenuState {
  sourceId: string;
  targetId: string;
  targetChange: ChangeNode;
  pageX: number;
  pageY: number;
}

interface TooltipState {
  change: ChangeNode;
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
}

interface PillContextMenuState {
  type: "bookmark" | "tag";
  name: string;
  pageX: number;
  pageY: number;
  synced?: boolean;
  remotes?: string[];
  unsyncedRemotes?: string[];
  untrackedRemotes?: string[];
  pendingRemotes?: boolean;
}

export const pillContextMenu = signal<PillContextMenuState | null>(null);

interface RemoteRefContextMenuState {
  type: "bookmark" | "tag";
  name: string;
  remote: string;
  change: ChangeNode;
  pageX: number;
  pageY: number;
  changeDoubleClickAction: string;
  pendingStatus?: boolean;
  action?: "delete" | "push" | "track";
}

export const remoteRefContextMenu = signal<RemoteRefContextMenuState | null>(null);

export const pendingGraphUpdate = signal<PendingGraphUpdate | null>(null);

export const pushingBookmarks = signal<Set<string>>(new Set());
export const pushingTags = signal<Set<string>>(new Set());

export function closeAllMenus() {
  contextMenu.value = null;
  rebaseMenu.value = null;
  pillContextMenu.value = null;
  remoteRefContextMenu.value = null;
}
