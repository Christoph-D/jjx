import { dragStartChangeId, isDragging, dropTargetId, justFinishedDrag, rebaseMenu, tooltipTimeout } from "../signals";
import { rootChangeId } from "../types";
import type { ChangeNode } from "../../../graph-protocol";

export function useDragDrop(change: ChangeNode) {
  const isElided = change.branchType === "~";
  const isRoot = change.changeId === rootChangeId || change.branchType === "◆" || change.branchType === "~";

  if (isElided) {
    return {};
  }

  return {
    draggable: !isRoot,
    onDragStart: isRoot
      ? undefined
      : (e: DragEvent) => {
          if (e.shiftKey) {
            e.preventDefault();
            return;
          }
          dragStartChangeId.value = change.changeId;
          isDragging.value = true;
          if (tooltipTimeout.value) {
            clearTimeout(tooltipTimeout.value);
            tooltipTimeout.value = null;
          }
          e.dataTransfer!.setData("text/plain", change.changeId);
          e.dataTransfer!.effectAllowed = "move";

          const ghost = document.createElement("div");
          ghost.className = "drag-ghost";
          ghost.textContent = change.changeId.substring(0, 8);
          document.body.appendChild(ghost);
          e.dataTransfer!.setDragImage(ghost, 0, 0);
          setTimeout(() => ghost.remove(), 0);
        },
    onDragEnd: isRoot
      ? undefined
      : () => {
          isDragging.value = false;
          dragStartChangeId.value = null;
          dropTargetId.value = null;
        },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
    },
    onDragEnter: (e: DragEvent) => {
      e.preventDefault();
      if (!isDragging.value || !dragStartChangeId.value) {
        return;
      }
      if (change.changeId === dragStartChangeId.value) {
        return;
      }
      dropTargetId.value = change.changeId;
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
      const sourceId = e.dataTransfer!.getData("text/plain");
      const targetId = change.changeId;
      if (!sourceId || !targetId || sourceId === targetId) {
        return;
      }

      if (tooltipTimeout.value) {
        clearTimeout(tooltipTimeout.value);
        tooltipTimeout.value = null;
      }

      justFinishedDrag.value = true;
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
