import { type RefObject } from "preact";
import { useDragDrop } from "../hooks/use-drag-drop";
import { useConnectedHighlight } from "../hooks/use-connected-highlight";
import {
  selectedNodes,
  changeEditAction,
  contextMenu,
  rebaseMenu,
  tooltip,
  tooltipTimeout,
  isDragging,
  justFinishedDrag,
  dropTargetId,
  graphStyle,
  vscode,
} from "../signals";
import { SWIMLANE_WIDTH, CHANGE_ID_RIGHT_PADDING, rootChangeId } from "../types";
import type { LaneNode } from "../../../graph-protocol";
import type { ChangeNode } from "../../../graph-protocol";
import { abbreviateName } from "../utils";

function shouldShowTooltip(changeId: string, branchType: string | undefined): boolean {
  return changeId !== "z".repeat(32) && branchType !== "~";
}

function isMenuOpen(): boolean {
  return contextMenu.value !== null || rebaseMenu.value !== null;
}

interface Props {
  change: ChangeNode;
  index: number;
  nodeData: LaneNode | null;
  changeIdRef?: RefObject<HTMLDivElement>;
}

export function ChangeNodeRow({ change, index, nodeData, changeIdRef }: Props) {
  const dragProps = useDragDrop(change);
  const highlightProps = useConnectedHighlight(change.changeId, change.parentChangeIds);
  const isElided = change.branchType === "~";
  const graphW = SWIMLANE_WIDTH * (nodeData?.numLanesActiveVisually ?? 0);

  const handleClick = (e: MouseEvent) => {
    if (isDragging.value || justFinishedDrag.value) return;
    if (isElided) return;

    const newSelected = new Set(selectedNodes.value);
    if (e.shiftKey) {
      if (newSelected.has(change.changeId)) {
        newSelected.delete(change.changeId);
      } else {
        newSelected.add(change.changeId);
      }
    } else {
      newSelected.clear();
      newSelected.add(change.changeId);
    }
    selectedNodes.value = newSelected;
    vscode.postMessage({
      command: "selectChange",
      selectedNodes: Array.from(newSelected),
    });
  };

  const handleDoubleClick = () => {
    if (change.currentWorkingCopy) return;
    vscode.postMessage({ command: "editChange", changeId: change.changeId });
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (change.changeId === rootChangeId || isElided) return;
    if (tooltipTimeout.value) {
      clearTimeout(tooltipTimeout.value);
      tooltipTimeout.value = null;
    }
    tooltip.value = null;
    contextMenu.value = {
      change,
      pageX: e.pageX,
      pageY: e.pageY,
      changeEditAction: changeEditAction.value,
    };
  };

  const handleEdit = (e: Event) => {
    e.stopPropagation();
    vscode.postMessage({ command: "editChange", changeId: change.changeId });
  };

  const handleMouseEnter = (e: MouseEvent) => {
    highlightProps.onMouseEnter();
    document.querySelector(`#node-circles .node-circle[data-change-id="${change.changeId}"]`)?.classList.add("hovered");
    if (isDragging.value || isMenuOpen()) return;
    if (shouldShowTooltip(change.changeId, change.branchType)) {
      tooltipTimeout.value = setTimeout(() => {
        tooltip.value = {
          change,
          pageX: e.pageX,
          pageY: e.pageY,
        };
      }, 500);
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (tooltipTimeout.value) {
      clearTimeout(tooltipTimeout.value);
    }
    if (isDragging.value || isMenuOpen()) return;
    if (shouldShowTooltip(change.changeId, change.branchType)) {
      tooltipTimeout.value = setTimeout(() => {
        tooltip.value = {
          change,
          pageX: e.pageX,
          pageY: e.pageY,
        };
      }, 500);
    }
  };

  const handleMouseLeave = () => {
    highlightProps.onMouseLeave();
    document
      .querySelector(`#node-circles .node-circle[data-change-id="${change.changeId}"]`)
      ?.classList.remove("hovered");
    if (tooltipTimeout.value) {
      clearTimeout(tooltipTimeout.value);
      tooltipTimeout.value = null;
    }
    tooltip.value = null;
  };

  const localBookmarkNames = new Set(change.localBookmarks.map((b) => b.name));
  const localTagNames = new Set(change.localTags.map((t) => t.name));

  const showEditButton =
    !change.currentWorkingCopy && !(changeEditAction.value === "edit" && change.changeId === rootChangeId);

  return (
    <div
      class={
        "change-node" +
        (change.currentWorkingCopy ? " working-copy" : "") +
        (isElided ? " elided-node" : "") +
        (selectedNodes.value.has(change.changeId) ? " selected" : "") +
        (dropTargetId.value === change.changeId ? " drop-target" : "")
      }
      data-change-id={change.changeId}
      data-parent-ids={JSON.stringify(change.parentChangeIds ?? [])}
      data-branch-type={change.branchType ?? ""}
      onClick={handleClick}
      onDblClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      {...dragProps}
    >
      <div class="change-id-left" ref={changeIdRef}>
        {change.conflict && <span class="conflict-indicator">✗</span>}
        <span class="change-id-prefix">{change.changeIdPrefix}</span>
        <span class="change-id-suffix">{change.changeIdSuffix}</span>
        {change.changeOffset && <span class="change-id-offset">/{change.changeOffset}</span>}
      </div>
      <div
        class="text-content"
        style={{
          "--graph-width": `${graphW}px`,
          "--change-id-right-padding": `${CHANGE_ID_RIGHT_PADDING}px`,
        }}
      >
        <div>
          {change.workingCopies?.map((wc) => <span class="pill workspace-pill">{wc}</span>)}
          {change.localBookmarks.map((b) => (
            <span
              class={"pill bookmark-pill" + (b.conflict ? " conflicted" : b.synced ? "" : " unsynced")}
              data-bookmark={b.name}
            >
              {abbreviateName(b.name)}
            </span>
          ))}
          {change.remoteBookmarks
            .filter((b) => !localBookmarkNames.has(b.name))
            .map((b) => (
              <span class="pill bookmark-pill">
                {abbreviateName(b.name)}@{b.remote}
              </span>
            ))}
          {change.localTags.map((t) => (
            <span
              class={"pill tag-pill" + (t.conflict ? " conflicted" : t.synced ? "" : " unsynced")}
              data-tag={t.name}
            >
              {abbreviateName(t.name)}
            </span>
          ))}
          {change.remoteTags
            .filter((t) => !localTagNames.has(t.name))
            .map((t) => (
              <span class="pill tag-pill">
                {abbreviateName(t.name)}@{t.remote}
              </span>
            ))}
          <span>{change.label}</span>
          {graphStyle.value === "compact" && !change.mine && change.authorName && (
            <span class="author-subdued">{change.authorName}</span>
          )}
        </div>
        {graphStyle.value !== "compact" && <div class="description">{change.description}</div>}
      </div>
      {showEditButton && (
        <button
          class="edit-button"
          onClick={handleEdit}
          title={changeEditAction.value === "new" ? "Create and Edit a New Empty Change on Top" : "Edit This Change"}
        >
          <i class="codicon codicon-log-in"></i>
        </button>
      )}
    </div>
  );
}
