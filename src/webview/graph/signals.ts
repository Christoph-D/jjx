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
export const dropTargetId = signal<string | null>(null);
export const justFinishedDrag = signal(false);
export const maxPrefixLength = signal(4);
export const changeIdHorizontalOffset = signal(0);
export const isStale = signal(false);
export const graphStyle = signal("full");
export const changeDoubleClickAction = signal("new");
export const showTooltips = signal(true);
export const scrollY = signal(0);
export const offsetWidth = signal(0);
export const tooltipTimeout = signal<ReturnType<typeof setTimeout> | null>(null);
export const tooltipHideTimeout = signal<ReturnType<typeof setTimeout> | null>(null);
export const diffStatsPrefetchTimeout = signal<ReturnType<typeof setTimeout> | null>(null);

export interface ContextMenuState {
  change: ChangeNode;
  pageX: number;
  pageY: number;
  changeDoubleClickAction: string;
}

export interface RebaseMenuState {
  sourceId: string;
  targetId: string;
  targetChange: ChangeNode;
  pageX: number;
  pageY: number;
}

export interface TooltipState {
  change: ChangeNode;
  pageX: number;
  pageY: number;
}

export const contextMenu = signal<ContextMenuState | null>(null);
export const rebaseMenu = signal<RebaseMenuState | null>(null);
export const tooltip = signal<TooltipState | null>(null);
export const diffStatsCache = signal<Map<string, DiffStats>>(new Map());

export interface PendingGraphUpdate {
  changes: ChangeNode[];
  laneInfo: import("../../graph-protocol").ChangeIdGraph;
  changeDoubleClickAction: string;
  graphStyle: string;
  maxPrefixLength: number;
  offsetWidth: number;
  preserveScroll: boolean;
  showTooltips: boolean;
  selectedNodes: string[];
}

export const pendingGraphUpdate = signal<PendingGraphUpdate | null>(null);
