import {
  rootChangeId,
  SWIMLANE_WIDTH,
  CHANGE_ID_RIGHT_PADDING,
  state,
  type ChangeIdGraph,
  type ChangeNode,
} from "./types";
import { abbreviateName } from "./utils";
import { createCircle } from "./svg";
import { updateCirclePositions, updateConnections } from "./connections";
import { highlightConnectedNodes, showTooltip, hideTooltip, isMenuOpen, shouldShowTooltip } from "./interaction";
import { showContextMenu, showRebaseMenu } from "./menu";

export function updateGraph(
  changes: ChangeNode[],
  graph: ChangeIdGraph,
  changeEditAction: string,
  graphStyle: string,
  maxPrefixLengthArg: number,
  offsetWidthArg: number,
  preserveScroll = false,
): void {
  const scrollTop = preserveScroll ? window.scrollY || document.documentElement.scrollTop : 0;

  state.currentChanges = changes;
  state.currentGraph = graph || { nodes: [], edges: [] };
  state.maxPrefixLength = maxPrefixLengthArg || 4;

  const graphContainer = document.getElementById("graph")!;
  graphContainer.style.setProperty("--change-id-ch-width", `${state.maxPrefixLength}ch`);
  graphContainer.style.setProperty("--change-id-offset-width", `${offsetWidthArg || 0}ch`);

  const nodesContainer = document.getElementById("nodes")!;
  const circlesContainer = document.getElementById("node-circles")!;
  nodesContainer.innerHTML = "";
  circlesContainer.innerHTML = "";

  if (graphStyle === "compact") {
    graphContainer.classList.add("compact");
  } else {
    graphContainer.classList.remove("compact");
  }

  changes.forEach((change) => {
    if (!change.changeId) {return;}

    const nodeIndex = changes.indexOf(change);
    const nodeData = state.currentGraph!.nodes[nodeIndex];
    const nodeLane = nodeData ? nodeData.lane : 0;
    const colorIndex = nodeData ? nodeData.colorIndex : 0;
    const isElided = change.branchType === "~";

    const node = document.createElement("div");
    node.className =
      "change-node" + (change.currentWorkingCopy ? " working-copy" : "") + (isElided ? " elided-node" : "");
    node.dataset.changeId = change.changeId;
    node.dataset.parentIds = JSON.stringify(change.parentChangeIds || []);
    node.dataset.branchType = change.branchType || "";

    if (isElided) {
      buildElidedNode(node, change, nodeData, nodesContainer, circlesContainer, colorIndex);
    } else {
      buildFullNode(
        node,
        change,
        nodeData,
        nodesContainer,
        circlesContainer,
        colorIndex,
        graphStyle,
        changeEditAction,
        nodeLane,
      );
    }
  });

  document.fonts.ready.then(() => {
    requestAnimationFrame(() => {
      const firstChangeId = document.querySelector(".change-id-left");
      if (firstChangeId) {
        state.changeIdHorizontalOffset = (firstChangeId as HTMLElement).offsetWidth;
      }
      updateCirclePositions();
      updateConnections();
      if (scrollTop > 0) {
        window.scrollTo(0, scrollTop);
      }
    });
  });
}

function buildElidedNode(
  node: HTMLElement,
  change: ChangeNode,
  nodeData: ChangeIdGraph["nodes"][number] | undefined,
  nodesContainer: HTMLElement,
  circlesContainer: HTMLElement,
  colorIndex: number,
): void {
  const textContent = document.createElement("div");
  textContent.className = "text-content";
  textContent.style.setProperty("--graph-width", `${SWIMLANE_WIDTH * (nodeData?.numLanesActiveVisually || 0)}px`);
  textContent.style.setProperty("--change-id-right-padding", `${CHANGE_ID_RIGHT_PADDING}px`);

  const changeIdLeft = document.createElement("div");
  changeIdLeft.className = "change-id-left";
  node.appendChild(changeIdLeft);

  const nodeLabel = document.createElement("div");
  const labelText = document.createElement("span");
  labelText.className = "elided-label";
  labelText.textContent = change.label;
  nodeLabel.appendChild(labelText);
  textContent.append(nodeLabel);
  node.appendChild(textContent);
  nodesContainer.appendChild(node);

  const circle = createCircle(change, colorIndex);
  circle.dataset.changeId = change.changeId;
  circle.dataset.nodeLane = String(nodeData?.lane ?? 0);
  circlesContainer.appendChild(circle);

  node.addEventListener("mouseenter", () => {
    highlightConnectedNodes(node, true);
    document.querySelector(`#node-circles .node-circle[data-change-id="${change.changeId}"]`)?.classList.add("hovered");
  });

  node.addEventListener("mouseleave", () => {
    highlightConnectedNodes(node, false);
    document
      .querySelector(`#node-circles .node-circle[data-change-id="${change.changeId}"]`)
      ?.classList.remove("hovered");
  });

  node.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });
}

function buildFullNode(
  node: HTMLElement,
  change: ChangeNode,
  nodeData: ChangeIdGraph["nodes"][number] | undefined,
  nodesContainer: HTMLElement,
  circlesContainer: HTMLElement,
  colorIndex: number,
  graphStyle: string,
  changeEditAction: string,
  nodeLane: number,
): void {
  node.dataset.currentWorkingCopy = String(change.currentWorkingCopy);
  node.dataset.authorName = change.authorName || "";
  node.dataset.authorEmail = change.authorEmail || "";
  node.dataset.authorTimestamp = change.authorTimestamp || "";
  node.dataset.fullDescription = change.fullDescription || "";
  node.dataset.filesChanged = String(change.filesChanged || 0);
  node.dataset.linesAdded = String(change.linesAdded || 0);
  node.dataset.linesRemoved = String(change.linesRemoved || 0);
  node.dataset.mine = String(change.mine || false);
  node.dataset.nodeLane = String(nodeLane);
  node.dataset.changeOffset = change.changeOffset || "";
  node.dataset.conflict = String(change.conflict || false);
  node.dataset.localBookmarks = JSON.stringify(change.localBookmarks || []);
  node.dataset.remoteBookmarks = JSON.stringify(change.remoteBookmarks || []);
  node.dataset.localTags = JSON.stringify(change.localTags || []);
  node.dataset.remoteTags = JSON.stringify(change.remoteTags || []);

  const textContent = document.createElement("div");
  textContent.className = "text-content";
  textContent.style.setProperty("--graph-width", `${SWIMLANE_WIDTH * (nodeData?.numLanesActiveVisually || 0)}px`);
  textContent.style.setProperty("--change-id-right-padding", `${CHANGE_ID_RIGHT_PADDING}px`);

  const changeIdLeft = document.createElement("div");
  changeIdLeft.className = "change-id-left";
  const changeIdPrefix = change.changeIdPrefix;
  const changeIdSuffix = change.changeIdSuffix || "";
  const changeOffset = change.changeOffset;
  let changeIdHtml = "";
  if (change.conflict) {
    changeIdHtml += '<span class="conflict-indicator">✗</span>';
  }
  changeIdHtml += `<span class="change-id-prefix">${changeIdPrefix}</span><span class="change-id-suffix">${changeIdSuffix}</span>`;
  if (changeOffset) {
    changeIdHtml += `<span class="change-id-offset">/${changeOffset}</span>`;
  }
  changeIdLeft.innerHTML = changeIdHtml;
  node.appendChild(changeIdLeft);

  const nodeLabel = document.createElement("div");
  if (change.workingCopies && change.workingCopies.length > 0) {
    change.workingCopies.forEach((wc) => {
      const pill = document.createElement("span");
      pill.className = "pill workspace-pill";
      pill.textContent = wc;
      nodeLabel.appendChild(pill);
    });
  }
  if (change.localBookmarks.length > 0) {
    change.localBookmarks.forEach((b) => {
      const pill = document.createElement("span");
      const suffixClass = b.conflict ? " conflicted" : b.synced ? "" : " unsynced";
      pill.className = "pill bookmark-pill" + suffixClass;
      pill.textContent = abbreviateName(b.name);
      pill.dataset.bookmark = b.name;
      nodeLabel.appendChild(pill);
    });
  }
  if (change.remoteBookmarks.length > 0) {
    const localBookmarkNames = new Set(change.localBookmarks.map((b) => b.name));
    change.remoteBookmarks.forEach((b) => {
      if (!localBookmarkNames.has(b.name)) {
        const pill = document.createElement("span");
        pill.className = "pill bookmark-pill";
        pill.textContent = `${abbreviateName(b.name)}@${b.remote}`;
        nodeLabel.appendChild(pill);
      }
    });
  }
  if (change.localTags.length > 0) {
    change.localTags.forEach((t) => {
      const pill = document.createElement("span");
      const suffixClass = t.conflict ? " conflicted" : t.synced ? "" : " unsynced";
      pill.className = "pill tag-pill" + suffixClass;
      pill.textContent = abbreviateName(t.name);
      pill.dataset.tag = t.name;
      nodeLabel.appendChild(pill);
    });
  }
  if (change.remoteTags.length > 0) {
    const localTagNames = new Set(change.localTags.map((t) => t.name));
    change.remoteTags.forEach((t) => {
      if (!localTagNames.has(t.name)) {
        const pill = document.createElement("span");
        pill.className = "pill tag-pill";
        pill.textContent = `${abbreviateName(t.name)}@${t.remote}`;
        nodeLabel.appendChild(pill);
      }
    });
  }
  const labelText = document.createElement("span");
  labelText.textContent = change.label;
  nodeLabel.appendChild(labelText);
  if (graphStyle === "compact" && !change.mine && change.authorName) {
    const authorSpan = document.createElement("span");
    authorSpan.className = "author-subdued";
    authorSpan.textContent = change.authorName;
    nodeLabel.appendChild(authorSpan);
  }
  textContent.append(nodeLabel);
  if (graphStyle !== "compact") {
    const nodeDescription = document.createElement("div");
    nodeDescription.className = "description";
    nodeDescription.textContent = change.description;
    textContent.append(nodeDescription);
  }
  node.appendChild(textContent);

  const editButton = document.createElement("button");
  editButton.className = "edit-button";
  editButton.innerHTML = '<i class="codicon codicon-log-in"></i>';
  editButton.title = changeEditAction === "new" ? "Create and Edit a New Empty Change on Top" : "Edit This Change";
  editButton.onclick = async (e) => {
    e.stopPropagation();
    await state.vscode.postMessage({
      command: "editChange",
      changeId: change.changeId,
    });
  };

  if (change.currentWorkingCopy || (changeEditAction === "edit" && change.changeId === rootChangeId)) {
    editButton.style.display = "none";
  }
  node.appendChild(editButton);
  nodesContainer.appendChild(node);

  const circle = createCircle(change, colorIndex);
  circle.dataset.changeId = change.changeId;
  circle.dataset.nodeLane = String(nodeLane);
  circlesContainer.appendChild(circle);

  node.addEventListener("mouseenter", (e) => {
    highlightConnectedNodes(node, true);
    document.querySelector(`#node-circles .node-circle[data-change-id="${change.changeId}"]`)?.classList.add("hovered");
    if (state.isDragging || isMenuOpen()) {return;}
    if (shouldShowTooltip(change.changeId, change.branchType)) {
      state.tooltipTimeout = setTimeout(() => {
        showTooltip(node, e);
      }, 500);
    }
  });

  node.addEventListener("mousemove", (e) => {
    if (state.tooltipTimeout) {
      clearTimeout(state.tooltipTimeout);
    }
    if (state.isDragging || isMenuOpen()) {return;}
    if (shouldShowTooltip(change.changeId, change.branchType)) {
      state.tooltipTimeout = setTimeout(() => {
        showTooltip(node, e);
      }, 500);
    }
  });

  node.addEventListener("mouseleave", () => {
    highlightConnectedNodes(node, false);
    document
      .querySelector(`#node-circles .node-circle[data-change-id="${change.changeId}"]`)
      ?.classList.remove("hovered");
    if (state.tooltipTimeout) {
      clearTimeout(state.tooltipTimeout);
      state.tooltipTimeout = null;
    }
    hideTooltip();
  });

  if (change.branchType !== "◆" && change.branchType !== "~") {
    node.draggable = true;

    node.addEventListener("dragstart", (e) => {
      if (e.shiftKey) {
        e.preventDefault();
        return;
      }
      state.dragStartChangeId = change.changeId;
      state.isDragging = true;
      node.classList.add("dragging");
      if (state.tooltipTimeout) {
        clearTimeout(state.tooltipTimeout);
        state.tooltipTimeout = null;
      }
      hideTooltip();
      e.dataTransfer!.setData("text/plain", change.changeId);
      e.dataTransfer!.effectAllowed = "move";

      const ghost = document.createElement("div");
      ghost.className = "drag-ghost";
      ghost.textContent = change.changeId.substring(0, 8);
      document.body.appendChild(ghost);
      e.dataTransfer!.setDragImage(ghost, 0, 0);
      setTimeout(() => ghost.remove(), 0);
    });

    node.addEventListener("dragend", () => {
      state.isDragging = false;
      state.dragStartChangeId = null;
      node.classList.remove("dragging");
      document.querySelectorAll(".change-node.drop-target").forEach((n) => {
        n.classList.remove("drop-target");
      });
    });
  }

  if (change.branchType !== "~") {
    node.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
    });

    node.addEventListener("dragenter", (e) => {
      e.preventDefault();
      if (!state.isDragging || !state.dragStartChangeId) {return;}
      if (change.changeId === state.dragStartChangeId) {return;}
      document.querySelectorAll(".change-node.drop-target").forEach((n) => {
        n.classList.remove("drop-target");
      });
      node.classList.add("drop-target");
      state.dropTargetId = change.changeId;
    });

    node.addEventListener("dragleave", (e) => {
      if (e.relatedTarget && node.contains(e.relatedTarget as Node)) {return;}
      node.classList.remove("drop-target");
      state.dropTargetId = null;
    });

    node.addEventListener("drop", (e) => {
      e.preventDefault();
      node.classList.remove("drop-target");
      const sourceId = e.dataTransfer!.getData("text/plain");
      const targetId = change.changeId;
      if (!sourceId || !targetId || sourceId === targetId) {return;}

      if (state.tooltipTimeout) {
        clearTimeout(state.tooltipTimeout);
        state.tooltipTimeout = null;
      }
      hideTooltip();
      state.justFinishedDrag = true;

      const sourceNode = document.querySelector(`.change-node[data-change-id="${sourceId}"]`);

      showRebaseMenu({
        sourceId,
        targetId,
        targetChange: change,
        sourceNode: sourceNode as HTMLElement | null,
        pageX: e.pageX,
        pageY: e.pageY,
      });

      setTimeout(() => {
        state.justFinishedDrag = false;
      }, 100);
    });
  }

  node.onclick = (e) => {
    if (state.isDragging || state.justFinishedDrag) {
      return;
    }
    if (change.branchType === "~") {
      return;
    }
    if (e.shiftKey) {
      if (state.selectedNodes.has(change.changeId)) {
        state.selectedNodes.delete(change.changeId);
        node.classList.remove("selected");
        document
          .querySelector(`#node-circles .node-circle[data-change-id="${change.changeId}"]`)
          ?.classList.remove("selected");
      } else {
        state.selectedNodes.add(change.changeId);
        node.classList.add("selected");
        document
          .querySelector(`#node-circles .node-circle[data-change-id="${change.changeId}"]`)
          ?.classList.add("selected");
      }
    } else {
      document.querySelectorAll(".change-node.selected").forEach((n) => {
        n.classList.remove("selected");
      });
      document.querySelectorAll("#node-circles .node-circle.selected").forEach((c) => {
        c.classList.remove("selected");
      });
      state.selectedNodes.clear();
      state.selectedNodes.add(change.changeId);
      node.classList.add("selected");
      document
        .querySelector(`#node-circles .node-circle[data-change-id="${change.changeId}"]`)
        ?.classList.add("selected");
    }

    state.vscode.postMessage({
      command: "selectChange",
      selectedNodes: Array.from(state.selectedNodes),
    });
  };

  node.ondblclick = () => {
    if (change.currentWorkingCopy) {
      return;
    }
    state.vscode.postMessage({
      command: "editChange",
      changeId: change.changeId,
    });
  };

  node.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (change.changeId === rootChangeId || change.branchType === "~") {
      return;
    }
    if (state.tooltipTimeout) {
      clearTimeout(state.tooltipTimeout);
      state.tooltipTimeout = null;
    }
    hideTooltip();
    showContextMenu(change, e, changeEditAction);
  });
}
