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
  isDragging,
  selectedNodes,
  contextMenu,
  rebaseMenu,
  pendingGraphUpdate,
  vscode,
  diffStatsCache,
  tooltip,
  showTooltips,
} from "./signals";
import { Graph } from "./components/graph";
import { ContextMenu } from "./components/context-menu";
import { RebaseMenu } from "./components/rebase-menu";
import { Tooltip } from "./components/tooltip";
import { StaleState } from "./components/stale-state";
import { ErrorBoundary } from "./components/error-boundary";
import type { PendingGraphUpdate } from "./signals";
import type { ExtensionToWebviewMessage } from "../../graph-protocol";

export function App() {
  useEffect(() => {
    const applyGraphUpdate = (message: PendingGraphUpdate) => {
      isStale.value = false;
      const newChangeIds = new Set(message.changes.map((c) => c.changeId));
      const preserved = new Set(Array.from(selectedNodes.value).filter((id) => newChangeIds.has(id)));
      selectedNodes.value = preserved;
      diffStatsCache.value = new Map();
      currentChanges.value = message.changes;
      currentGraph.value = message.laneInfo;
      changeDoubleClickAction.value = message.changeDoubleClickAction;
      graphStyle.value = message.graphStyle;
      showTooltips.value = message.showTooltips;
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
        case "diffStatsResponse": {
          const newCache = new Map(diffStatsCache.value);
          newCache.set(message.changeId, message.stats);
          diffStatsCache.value = newCache;
          const state = tooltip.value;
          if (state && state.change.changeId === message.changeId) {
            tooltip.value = { ...state };
          }
          break;
        }
      }
    });

    const hideMenus = () => {
      contextMenu.value = null;
      rebaseMenu.value = null;
    };

    document.addEventListener("click", hideMenus);
    window.addEventListener("blur", hideMenus);

    let resizeTimeout: ReturnType<typeof setTimeout>;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        requestAnimationFrame(() => {
          currentGraph.value = { ...currentGraph.value! };
        });
      }, 100);
    });

    vscode.postMessage({ command: "webviewReady" });
  }, []);

  return (
    <ErrorBoundary>
      {isStale.value ? <StaleState /> : <Graph />}
      <ContextMenu />
      <RebaseMenu />
      <Tooltip />
    </ErrorBoundary>
  );
}
