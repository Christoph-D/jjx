import { useEffect } from "preact/hooks";
import {
  currentChanges,
  currentGraph,
  graphStyle,
  changeEditAction,
  maxPrefixLength,
  offsetWidth,
  scrollY,
  isStale,
  selectedNodes,
  contextMenu,
  rebaseMenu,
  isDragging,
  vscode,
} from "./signals";
import { Graph } from "./components/graph";
import { ContextMenu } from "./components/context-menu";
import { RebaseMenu } from "./components/rebase-menu";
import { Tooltip } from "./components/tooltip";
import { StaleState } from "./components/stale-state";
import type { ChangeNode, ChangeIdGraph } from "./types";

export function App() {
  useEffect(() => {
    window.addEventListener("message", (event) => {
      const message = event.data as { command: string; [key: string]: unknown };
      switch (message.command) {
        case "updateGraph":
          isStale.value = false;
          selectedNodes.value = new Set();
          currentChanges.value = message.changes as ChangeNode[];
          currentGraph.value = message.laneInfo as ChangeIdGraph;
          changeEditAction.value = message.changeEditAction as string;
          graphStyle.value = message.graphStyle as string;
          maxPrefixLength.value = message.maxPrefixLength as number;
          offsetWidth.value = message.offsetWidth as number;
          scrollY.value = message.preserveScroll ? window.scrollY : 0;
          break;
        case "showStaleState":
          isStale.value = true;
          break;
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
