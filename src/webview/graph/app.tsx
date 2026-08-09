import { useEffect } from "preact/hooks";
import { effect } from "@preact/signals";
import {
  currentChanges,
  currentGraph,
  graphStyle,
  changeDoubleClickAction,
  maxPrefixLength,
  offsetWidth,
  scrollY,
  isStale,
  isJJNotFound,
  isNoRepoFound,
  isError,
  isDragging,
  selectedNodes,
  pendingGraphUpdate,
  pushingBookmarks,
  pushingTags,
  supportsTagTracking,
  postMessage,
  diffStatsCache,
  tooltip,
  showTooltips,
  showChangedFiles,
  pillContextMenu,
  remoteRefContextMenu,
  closeAllMenus,
} from "./signals";
import { Graph } from "./components/graph";
import { ContextMenu } from "./components/context-menu";
import { RebaseMenu } from "./components/rebase-menu";
import { PillContextMenu } from "./components/pill-context-menu";
import { RemoteRefContextMenu } from "./components/remote-ref-context-menu";
import { Tooltip } from "./components/tooltip";
import { StaleState } from "./components/stale-state";
import { JJNotFoundState } from "./components/jj-not-found-state";
import { NoRepoFoundState } from "./components/no-repo-found-state";
import { ErrorState } from "./components/error-state";
import { ErrorBoundary } from "./components/error-boundary";
import type { PendingGraphUpdate } from "./signals";
import { getUniqueId, type ExtensionToWebviewMessage } from "../../graph-protocol";

export function App() {
  useEffect(() => {
    const applyGraphUpdate = (message: PendingGraphUpdate) => {
      isStale.value = false;
      isJJNotFound.value = false;
      isNoRepoFound.value = false;
      isError.value = false;
      const newChangeIds = new Set<string>(message.changes.map((c) => getUniqueId(c)));
      const preserved = new Set(Array.from(selectedNodes.value).filter((id) => newChangeIds.has(id)));
      selectedNodes.value = preserved;
      diffStatsCache.value = new Map();
      const activeTooltip = tooltip.value;
      if (activeTooltip) {
        const updatedChange = message.changes.find((c) => getUniqueId(c) === activeTooltip.change.id.changeId);
        if (updatedChange && updatedChange.branchType !== "~") {
          tooltip.value = { ...activeTooltip, change: updatedChange };
          postMessage({ command: "fetchDiffStats", changeId: updatedChange.id.changeId });
        } else {
          tooltip.value = null;
        }
      }
      currentChanges.value = message.changes;
      currentGraph.value = message.laneInfo;
      changeDoubleClickAction.value = message.changeDoubleClickAction;
      graphStyle.value = message.graphStyle;
      showTooltips.value = message.showTooltips;
      showChangedFiles.value = message.showChangedFiles;
      supportsTagTracking.value = message.supportsTagTracking;
      maxPrefixLength.value = message.maxPrefixLength;
      offsetWidth.value = message.offsetWidth;
      scrollY.value = message.preserveScroll ? window.scrollY : 0;
    };

    effect(() => {
      if (!isDragging.value && pendingGraphUpdate.value) {
        const update = pendingGraphUpdate.value;
        pendingGraphUpdate.value = null;
        applyGraphUpdate(update);
      }
    });

    window.addEventListener("message", (event) => {
      const message = event.data as ExtensionToWebviewMessage;
      switch (message.command) {
        case "updateGraph":
          if (isDragging.value) {
            pendingGraphUpdate.value = message;
            break;
          }
          applyGraphUpdate(message);
          break;
        case "showStaleState":
          isStale.value = true;
          break;
        case "showJJNotFoundState":
          isJJNotFound.value = true;
          break;
        case "showNoRepoFoundState":
          isNoRepoFound.value = true;
          break;
        case "showErrorState":
          isError.value = true;
          break;
        case "diffStatsResponse": {
          const newCache = new Map(diffStatsCache.value);
          newCache.set(message.changeId, message.stats);
          diffStatsCache.value = newCache;
          const state = tooltip.value;
          if (state && state.change.id.changeId === message.changeId) {
            tooltip.value = { ...state };
          }
          break;
        }
        case "bookmarkTrackingRemotesResponse": {
          const state = pillContextMenu.value;
          if (state && state.type === "bookmark" && state.name === message.bookmark && state.pendingRemotes) {
            pillContextMenu.value = {
              ...state,
              remotes: message.remotes.length > 0 ? message.remotes : undefined,
              unsyncedRemotes:
                message.unsyncedRemotes && message.unsyncedRemotes.length > 0 ? message.unsyncedRemotes : undefined,
              untrackedRemotes:
                message.untrackedRemotes && message.untrackedRemotes.length > 0 ? message.untrackedRemotes : undefined,
              pendingRemotes: undefined,
            };
          }
          break;
        }
        case "tagPushRemotesResponse": {
          const state = pillContextMenu.value;
          if (state && state.type === "tag" && state.name === message.tag && state.pendingRemotes) {
            pillContextMenu.value = {
              ...state,
              remotes: message.pushRemotes.length > 0 ? message.pushRemotes : undefined,
              pendingRemotes: undefined,
            };
          }
          break;
        }
        case "tagTrackingRemotesResponse": {
          const state = pillContextMenu.value;
          if (state && state.type === "tag" && state.name === message.tag && state.pendingRemotes) {
            pillContextMenu.value = {
              ...state,
              remotes: message.remotes.length > 0 ? message.remotes : undefined,
              pendingRemotes: undefined,
            };
          }
          break;
        }
        case "pushBookmarkDone": {
          const newSet = new Set(pushingBookmarks.value);
          newSet.delete(message.bookmark);
          pushingBookmarks.value = newSet;
          break;
        }
        case "pushTagDone": {
          const newSet = new Set(pushingTags.value);
          newSet.delete(message.tag);
          pushingTags.value = newSet;
          break;
        }
        case "remoteRefStatusResponse": {
          const state = remoteRefContextMenu.value;
          if (
            !state ||
            !state.pendingStatus ||
            state.type !== message.refType ||
            state.name !== message.name ||
            state.remote !== message.remote
          ) {
            break;
          }
          // A tracked, unsynced remote ref can be pushed (or deleted when the
          // local ref is gone). In every other case (untracked, already synced,
          // or lookup failure) offer to track the ref from this remote instead.
          const actionable = message.found && message.tracked && !message.synced;
          remoteRefContextMenu.value = {
            ...state,
            pendingStatus: undefined,
            action: actionable ? (message.present ? "push" : "delete") : "track",
          };
          break;
        }
      }
    });

    document.addEventListener("click", closeAllMenus);
    window.addEventListener("blur", closeAllMenus);

    let resizeTimeout: ReturnType<typeof setTimeout>;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        requestAnimationFrame(() => {
          currentGraph.value = { ...currentGraph.value! };
        });
      }, 100);
    });

    postMessage({ command: "webviewReady" });
  }, []);

  return (
    <ErrorBoundary>
      {isStale.value ? (
        <StaleState />
      ) : isJJNotFound.value ? (
        <JJNotFoundState />
      ) : isNoRepoFound.value ? (
        <NoRepoFoundState />
      ) : isError.value ? (
        <ErrorState />
      ) : (
        <Graph />
      )}
      <ContextMenu />
      <RebaseMenu />
      <PillContextMenu />
      <RemoteRefContextMenu />
      <Tooltip />
    </ErrorBoundary>
  );
}
