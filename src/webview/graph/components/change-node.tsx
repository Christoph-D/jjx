import { type RefObject } from "preact";
import { useDragDrop } from "../hooks/use-drag-drop";
import { useConnectedHighlight } from "../hooks/use-connected-highlight";
import {
  selectedNodes,
  changeDoubleClickAction,
  contextMenu,
  rebaseMenu,
  tooltip,
  tooltipTimeout,
  tooltipHideTimeout,
  diffStatsPrefetchTimeout,
  isDragging,
  justFinishedDrag,
  dropTargetId,
  graphStyle,
  vscode,
  diffStatsCache,
} from "../signals";
import { SWIMLANE_WIDTH, CHANGE_ID_RIGHT_PADDING, rootChangeId } from "../types";
import type { LaneNode } from "../../../graph-protocol";
import type { ChangeNode } from "../../../graph-protocol";
import { abbreviateName } from "../utils";

const TOOLTIP_DELAY_MS = 300;
const TOOLTIP_HIDE_DELAY_MS = 100;
const DIFF_STATS_PREFETCH_DELAY_MS = 100;

function shouldShowTooltip(changeId: string, branchType: string | undefined): boolean {
  return changeId !== rootChangeId && branchType !== "~";
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

export function ChangeNodeRow({ change, index: _index, nodeData, changeIdRef }: Props) {
  const dragProps = useDragDrop(change);
  const highlightProps = useConnectedHighlight(change.changeId, change.parentChangeIds);
  const isElided = change.branchType === "~";
  const graphW = SWIMLANE_WIDTH * (nodeData?.numLanesActiveVisually ?? 0);

  const handleClick = (e: MouseEvent) => {
    if (isDragging.value || justFinishedDrag.value) {
      return;
    }
    if (isElided) {
      return;
    }

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
    if (change.currentWorkingCopy) {
      return;
    }
    vscode.postMessage({ command: "editChange", changeId: change.changeId });
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (change.changeId === rootChangeId || isElided) {
      return;
    }
    clearHoverTimers();
    tooltip.value = null;
    contextMenu.value = {
      change,
      pageX: e.pageX,
      pageY: e.pageY,
      changeDoubleClickAction: changeDoubleClickAction.value,
    };
  };

  const showTooltip = (change: ChangeNode, pageX: number, pageY: number) => {
    tooltip.value = { change, pageX, pageY };
  };

  const startHoverTimers = (change: ChangeNode, pageX: number, pageY: number) => {
    if (!diffStatsCache.value.has(change.changeId)) {
      diffStatsPrefetchTimeout.value = setTimeout(() => {
        vscode.postMessage({ command: "fetchDiffStats", changeId: change.changeId });
      }, DIFF_STATS_PREFETCH_DELAY_MS);
    }
    tooltipTimeout.value = setTimeout(() => {
      showTooltip(change, pageX, pageY);
    }, TOOLTIP_DELAY_MS);
  };

  const clearHoverTimers = () => {
    if (diffStatsPrefetchTimeout.value) {
      clearTimeout(diffStatsPrefetchTimeout.value);
      diffStatsPrefetchTimeout.value = null;
    }
    if (tooltipTimeout.value) {
      clearTimeout(tooltipTimeout.value);
      tooltipTimeout.value = null;
    }
  };

  const handleMouseEnter = (e: MouseEvent) => {
    highlightProps.onMouseEnter();
    document.querySelector(`#node-circles .node-circle[data-change-id="${change.changeId}"]`)?.classList.add("hovered");
    if (tooltipHideTimeout.value) {
      clearTimeout(tooltipHideTimeout.value);
      tooltipHideTimeout.value = null;
    }
    if (isDragging.value || isMenuOpen()) {
      return;
    }
    if (shouldShowTooltip(change.changeId, change.branchType)) {
      startHoverTimers(change, e.pageX, e.pageY);
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    clearHoverTimers();
    if (tooltipHideTimeout.value) {
      clearTimeout(tooltipHideTimeout.value);
      tooltipHideTimeout.value = null;
    }
    if (isDragging.value || isMenuOpen()) {
      return;
    }
    if (shouldShowTooltip(change.changeId, change.branchType)) {
      startHoverTimers(change, e.pageX, e.pageY);
    }
  };

  const handleMouseLeave = () => {
    highlightProps.onMouseLeave();
    document
      .querySelector(`#node-circles .node-circle[data-change-id="${change.changeId}"]`)
      ?.classList.remove("hovered");
    clearHoverTimers();
    if (tooltipHideTimeout.value) {
      clearTimeout(tooltipHideTimeout.value);
    }
    tooltipHideTimeout.value = setTimeout(() => {
      tooltip.value = null;
    }, TOOLTIP_HIDE_DELAY_MS);
  };

  const localBookmarkNames = new Set(change.localBookmarks.map((b) => b.name));
  const localTagNames = new Set(change.localTags.map((t) => t.name));

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
          {change.workingCopies?.map((wc) => (
            <span key={wc} class="pill workspace-pill">
              {wc}
            </span>
          ))}
          {change.localBookmarks.map((b) => (
            <span
              key={b.name}
              class={"pill bookmark-pill" + (b.conflict ? " conflicted" : b.synced ? "" : " unsynced")}
              data-bookmark={b.name}
            >
              {abbreviateName(b.name)}
            </span>
          ))}
          {change.remoteBookmarks
            .filter((b) => !localBookmarkNames.has(b.name))
            .map((b) => (
              <span key={b.name + "@" + b.remote} class="pill bookmark-pill">
                {abbreviateName(b.name)}@{b.remote}
              </span>
            ))}
          {change.localTags.map((t) => (
            <span
              key={t.name}
              class={"pill tag-pill" + (t.conflict ? " conflicted" : t.synced ? "" : " unsynced")}
              data-tag={t.name}
            >
              {abbreviateName(t.name)}
            </span>
          ))}
          {change.remoteTags
            .filter((t) => !localTagNames.has(t.name))
            .map((t) => (
              <span key={t.name + "@" + t.remote} class="pill tag-pill">
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
    </div>
  );
}
