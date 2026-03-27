import { state, type VSCodeAPI, type ChangeNode, type ChangeIdGraph } from "./types";
import { updateGraph } from "./nodes";
import { updateCirclePositions, updateConnections } from "./connections";
import { hideAllMenus, handleContextMenuItemClick, handleRebaseMenuItemClick, hideMenu } from "./menu";

declare function acquireVsCodeApi(): VSCodeAPI;

const vscode = acquireVsCodeApi();
state.vscode = vscode;

function resetSelectionState() {
  state.selectedNodes.clear();
  document.querySelectorAll(".change-node").forEach((n) => {
    n.classList.remove("selected", "highlighted", "dimmed");
  });
  document.querySelectorAll(".node-circle").forEach((circle) => {
    circle.classList.remove("selected", "dimmed");
  });
  document.querySelectorAll(".connection-line").forEach((line) => {
    line.classList.remove("highlighted", "dimmed");
  });
  vscode.postMessage({
    command: "selectChange",
    selectedNodes: [],
  });
}

window.addEventListener("message", (event) => {
  const message = event.data as { command: string; [key: string]: unknown };
  switch (message.command) {
    case "updateGraph":
      resetSelectionState();
      document.getElementById("stale-state")!.style.display = "none";
      document.getElementById("graph")!.style.display = "block";
      updateGraph(
        message.changes as ChangeNode[],
        message.laneInfo as ChangeIdGraph,
        message.changeEditAction as string,
        message.graphStyle as string,
        message.maxPrefixLength as number,
        message.offsetWidth as number,
        message.preserveScroll as boolean,
      );
      break;
    case "showStaleState":
      document.getElementById("graph")!.style.display = "none";
      document.getElementById("stale-state")!.style.display = "flex";
      break;
  }
});

document.addEventListener("click", () => {
  hideAllMenus();
});

window.addEventListener("blur", () => {
  hideAllMenus();
});

document.getElementById("context-menu")!.addEventListener("click", (e) => {
  handleContextMenuItemClick(e);
});

document.getElementById("rebase-menu")!.addEventListener("click", (e) => {
  handleRebaseMenuItemClick(e);
});

document.addEventListener("click", (e) => {
  if (state.justFinishedDrag) {
    return;
  }
  const rebaseMenu = document.getElementById("rebase-menu")!;
  if (!(e.target as Element).closest?.("#rebase-menu")) {
    hideMenu(rebaseMenu);
  }
});

let resizeTimeout: ReturnType<typeof setTimeout>;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    requestAnimationFrame(() => {
      updateCirclePositions();
      updateConnections();
    });
  }, 2);
});

window.addEventListener("load", () => {
  vscode.postMessage({ command: "webviewReady" });
});

document.getElementById("update-stale-button")!.addEventListener("click", () => {
  vscode.postMessage({ command: "updateStale" });
});
