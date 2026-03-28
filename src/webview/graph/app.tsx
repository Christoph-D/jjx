import { useEffect } from "preact/hooks";
import {
  currentChanges,
  currentGraph,
  graphStyle,
  changeDoubleClickAction,
  maxPrefixLength,
  offsetWidth,
  scrollY,
  isStale,
  selectedNodes,
  contextMenu,
  rebaseMenu,
  vscode,
  diffStatsCache,
  tooltip,
} from "./signals";
import { Graph } from "./components/graph";
import { ContextMenu } from "./components/context-menu";
import { RebaseMenu } from "./components/rebase-menu";
import { Tooltip } from "./components/tooltip";
import { StaleState } from "./components/stale-state";
import type { ExtensionToWebviewMessage } from "../../graph-protocol";

export function App() {
  useEffect(() => {
    window.addEventListener("message", (event) => {
      const message = event.data as ExtensionToWebviewMessage;
      switch (message.command) {
        case "updateGraph":
          isStale.value = false;
          selectedNodes.value = new Set();
          diffStatsCache.value = new Map();
          currentChanges.value = message.changes;
          currentGraph.value = message.laneInfo;
          changeDoubleClickAction.value = message.changeDoubleClickAction;
          graphStyle.value = message.graphStyle;
          maxPrefixLength.value = message.maxPrefixLength;
          offsetWidth.value = message.offsetWidth;
          scrollY.value = message.preserveScroll ? window.scrollY : 0;
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
      }, 2);
    });

    vscode.postMessage({ command: "webviewReady" });
  }, []);

  return (
    <>
      {isStale.value ? <StaleState /> : <Graph />}
      <ContextMenu />
      <RebaseMenu />
      <Tooltip />
    </>
  );
}
