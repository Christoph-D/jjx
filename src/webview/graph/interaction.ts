import { rootChangeId } from "./types";
import { escapeHtml } from "./utils";

export function highlightConnectedNodes(nodeElement: HTMLElement, highlight: boolean) {
  const nodes = document.querySelectorAll(".change-node");
  const nodeCircles = document.querySelectorAll("#node-circles .node-circle");

  if (highlight) {
    const nodeId = nodeElement.dataset.changeId!;
    const parentIds: string[] = JSON.parse(nodeElement.dataset.parentIds || "[]") as string[];

    const childNodes = Array.from(nodes).filter((node) => {
      const nodeParentIds: string[] = JSON.parse((node as HTMLElement).dataset.parentIds || "[]") as string[];
      return nodeParentIds.includes(nodeId);
    });
    const childIds = childNodes.map((node) => (node as HTMLElement).dataset.changeId!);

    nodes.forEach((node) => node.classList.add("dimmed"));
    nodeCircles.forEach((circle) => circle.classList.add("dimmed"));
    document.querySelectorAll(".connection-line").forEach((line) => line.classList.add("dimmed"));

    nodeElement.classList.remove("dimmed");
    nodeElement.classList.add("highlighted");

    parentIds.forEach((parentId) => {
      const parentNode = document.querySelector(`.change-node[data-change-id="${parentId}"]`);
      if (parentNode) {
        parentNode.classList.remove("dimmed");
        parentNode.classList.add("highlighted");
      }
    });

    childNodes.forEach((node) => {
      node.classList.remove("dimmed");
      node.classList.add("highlighted");
    });

    nodeCircles.forEach((circle) => {
      const circleData = (circle as HTMLElement).dataset.changeId!;
      if (circleData === nodeId || parentIds.includes(circleData) || childIds.includes(circleData)) {
        circle.classList.remove("dimmed");
      }
    });

    const connectedIds = new Set([...parentIds, ...childIds]);
    document.querySelectorAll(".connection-line").forEach((line) => {
      const fromId = (line as HTMLElement).dataset.fromId!;
      const toId = (line as HTMLElement).dataset.toId!;

      if ((fromId === nodeId && connectedIds.has(toId)) || (toId === nodeId && connectedIds.has(fromId))) {
        line.classList.remove("dimmed");
        line.classList.add("highlighted");
      }
    });
  } else {
    nodes.forEach((node) => {
      node.classList.remove("dimmed", "highlighted");
    });
    nodeCircles.forEach((circle) => {
      circle.classList.remove("dimmed");
    });
    document.querySelectorAll(".connection-line").forEach((line) => {
      line.classList.remove("highlighted", "dimmed");
    });
  }
}

interface LocalRef {
  name: string;
  conflict: boolean;
  synced: boolean;
}

interface RemoteRef {
  name: string;
  remote: string;
}

export function showTooltip(nodeElement: HTMLElement, e: MouseEvent) {
  const tooltip = document.getElementById("tooltip")!;
  const authorName = nodeElement.dataset.authorName;
  const authorEmail = nodeElement.dataset.authorEmail;
  const authorTimestamp = nodeElement.dataset.authorTimestamp;
  const fullDescription = nodeElement.dataset.fullDescription;
  const filesChanged = parseInt(nodeElement.dataset.filesChanged || "0") || 0;
  const linesAdded = parseInt(nodeElement.dataset.linesAdded || "0") || 0;
  const linesRemoved = parseInt(nodeElement.dataset.linesRemoved || "0") || 0;
  const localBookmarks: LocalRef[] = JSON.parse(nodeElement.dataset.localBookmarks || "[]") as LocalRef[];
  const remoteBookmarks: RemoteRef[] = JSON.parse(nodeElement.dataset.remoteBookmarks || "[]") as RemoteRef[];
  const localTags: LocalRef[] = JSON.parse(nodeElement.dataset.localTags || "[]") as LocalRef[];
  const remoteTags: RemoteRef[] = JSON.parse(nodeElement.dataset.remoteTags || "[]") as RemoteRef[];

  let html = "";
  if (authorName || authorEmail || authorTimestamp) {
    html += `<div class="tooltip-header">`;
    if (authorName) {
      html += `<span class="tooltip-author">${authorName}</span>`;
      if (authorEmail) {
        html += ` <span class="tooltip-email">&lt;${authorEmail}&gt;</span>`;
      }
    }
    html += `</div>`;
    if (authorTimestamp) {
      html += `<div class="tooltip-timestamp">${authorTimestamp}</div>`;
    }
  }

  const hasBookmarksOrTags =
    localBookmarks.length > 0 || remoteBookmarks.length > 0 || localTags.length > 0 || remoteTags.length > 0;
  if (hasBookmarksOrTags) {
    html += `<div class="tooltip-pills">`;
    localBookmarks.forEach((b) => {
      const suffixClass = b.conflict ? " conflicted" : b.synced ? "" : " unsynced";
      html += `<span class="tooltip-pill tooltip-bookmark-pill${suffixClass}">${escapeHtml(b.name)}</span>`;
    });
    remoteBookmarks.forEach((b) => {
      html += `<span class="tooltip-pill tooltip-bookmark-pill">${escapeHtml(b.name)}@${escapeHtml(b.remote)}</span>`;
    });
    localTags.forEach((t) => {
      const suffixClass = t.conflict ? " conflicted" : t.synced ? "" : " unsynced";
      html += `<span class="tooltip-pill tooltip-tag-pill${suffixClass}">${escapeHtml(t.name)}</span>`;
    });
    remoteTags.forEach((t) => {
      html += `<span class="tooltip-pill tooltip-tag-pill">${escapeHtml(t.name)}@${escapeHtml(t.remote)}</span>`;
    });
    html += `</div>`;
  }

  html += `<div class="tooltip-summary">${filesChanged} file${filesChanged !== 1 ? "s" : ""} changed, <span class="tooltip-added">+${linesAdded}</span> <span class="tooltip-removed">-${linesRemoved}</span></div>`;

  if (fullDescription) {
    html += `<div class="tooltip-description">${escapeHtml(fullDescription)}</div>`;
  }

  tooltip.innerHTML = html;
  tooltip.style.display = "block";
  tooltip.style.left = "-9999px";
  tooltip.style.top = "-9999px";

  requestAnimationFrame(() => {
    const tooltipRect = tooltip.getBoundingClientRect();
    const scrollX = window.scrollX || window.pageXOffset;
    const scrollY = window.scrollY || window.pageYOffset;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const offset = 15;
    let left = e.pageX + offset;
    let top = e.pageY + offset;

    if (left + tooltipRect.width > viewportWidth + scrollX - 10) {
      left = e.pageX - tooltipRect.width - offset;
    }

    if (top + tooltipRect.height > viewportHeight + scrollY - 10) {
      top = e.pageY - tooltipRect.height - offset;
    }

    if (top < scrollY + 10) {
      top = scrollY + 10;
    }

    if (left < scrollX + 10) {
      left = scrollX + 10;
    }

    tooltip.style.left = left + "px";
    tooltip.style.top = top + "px";
  });
}

export function hideTooltip() {
  const tooltip = document.getElementById("tooltip")!;
  tooltip.style.display = "none";
}

export function isMenuOpen(): boolean {
  const contextMenu = document.getElementById("context-menu")!;
  const rebaseMenu = document.getElementById("rebase-menu")!;
  return contextMenu.style.display === "block" || rebaseMenu.style.display === "block";
}

export function shouldShowTooltip(changeId: string, branchType: string | undefined): boolean {
  return changeId !== rootChangeId && branchType !== "~";
}
