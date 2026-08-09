import {
  dragStartChangeId,
  isDragging,
  dropTargetId,
  justFinishedDrag,
  rebaseMenu,
  tooltip,
  dragBookmarkName,
  postMessage,
  closeAllMenus,
} from "../signals";
import { useTooltipTimers } from "./use-tooltip-timers";
import { rootChangeId } from "../types";
import type { ChangeNode, FullChangeId } from "../../../graph-protocol";
import changeNodeStyles from "../components/change-node.module.css";
import dragGhostStyles from "../components/drag-ghost.module.css";

export function useDragDrop(change: ChangeNode) {
  if (change.branchType === "~") {
    return {};
  }
  const isRoot = change.id.changeId === rootChangeId;
  const { clearAllTimers } = useTooltipTimers();

  return {
    draggable: !isRoot,
    onDragStart: isRoot
      ? undefined
      : (e: DragEvent) => {
          if (e.shiftKey) {
            e.preventDefault();
            return;
          }
          dragBookmarkName.value = null;
          dragStartChangeId.value = change.id.changeId;
          isDragging.value = true;
          clearAllTimers();
          tooltip.value = null;
          e.dataTransfer!.setData("text/plain", change.id.changeId);
          e.dataTransfer!.effectAllowed = "move";

          const ghost = document.createElement("div");
          ghost.className = dragGhostStyles.dragGhost;
          if (change.conflict) {
            const conflict = document.createElement("span");
            conflict.className = changeNodeStyles.conflictIndicator;
            conflict.textContent = "✗";
            ghost.appendChild(conflict);
          }
          const prefix = document.createElement("span");
          prefix.className = changeNodeStyles.changeIdPrefix;
          prefix.textContent = change.id.changeIdPrefix;
          ghost.appendChild(prefix);
          const suffix = document.createElement("span");
          suffix.className = changeNodeStyles.changeIdSuffix;
          suffix.textContent = change.id.changeIdSuffix;
          ghost.appendChild(suffix);
          if (change.id.changeOffset) {
            const offset = document.createElement("span");
            offset.className = changeNodeStyles.changeIdOffset;
            offset.textContent = `/${change.id.changeOffset}`;
            ghost.appendChild(offset);
          }
          if (change.label) {
            ghost.appendChild(document.createTextNode(" "));
            const desc = document.createElement("span");
            desc.className = dragGhostStyles.dragGhostDescription;
            desc.textContent = change.label;
            ghost.appendChild(desc);
          }
          document.body.appendChild(ghost);
          e.dataTransfer!.setDragImage(ghost, -15, 0);
          setTimeout(() => ghost.remove(), 0);
        },
    onDragEnd: isRoot
      ? undefined
      : () => {
          isDragging.value = false;
          dragStartChangeId.value = null;
          dragBookmarkName.value = null;
          dropTargetId.value = null;
        },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
    },
    onDragEnter: (e: DragEvent) => {
      e.preventDefault();
      if (!isDragging.value) {
        return;
      }
      if (!dragBookmarkName.value && !dragStartChangeId.value) {
        return;
      }
      if (dragStartChangeId.value && change.id.changeId === dragStartChangeId.value) {
        return;
      }
      dropTargetId.value = change.id.changeId;
    },
    onDragLeave: (e: DragEvent) => {
      const relatedTarget = e.relatedTarget as HTMLElement | null;
      const currentTarget = e.currentTarget as HTMLElement;
      if (relatedTarget && currentTarget.contains(relatedTarget)) {
        return;
      }
      dropTargetId.value = null;
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();

      if (dragBookmarkName.value) {
        clearAllTimers();
        tooltip.value = null;
        const bookmarkName = dragBookmarkName.value;
        isDragging.value = false;
        dragBookmarkName.value = null;
        dropTargetId.value = null;
        justFinishedDrag.value = true;
        setTimeout(() => {
          justFinishedDrag.value = false;
        }, 100);
        postMessage({
          command: "moveBookmark",
          bookmark: bookmarkName,
          targetChangeId: change.id.changeId,
        });
        return;
      }

      const sourceId = e.dataTransfer!.getData("text/plain") as FullChangeId;
      const targetId = change.id.changeId;
      if (!sourceId || !targetId || sourceId === targetId) {
        return;
      }

      clearAllTimers();
      tooltip.value = null;

      justFinishedDrag.value = true;
      closeAllMenus();
      rebaseMenu.value = {
        sourceId,
        targetId,
        targetChange: change,
        pageX: e.pageX,
        pageY: e.pageY,
      };

      setTimeout(() => {
        justFinishedDrag.value = false;
      }, 100);
    },
  };
}
