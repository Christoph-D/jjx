import { type HTMLAttributes, type RefObject } from "preact";
import { memo } from "preact/compat";
import { useDragDrop } from "../hooks/use-drag-drop";
import { useConnectedHighlight } from "../hooks/use-connected-highlight";
import { useTooltipTimers } from "../hooks/use-tooltip-timers";
import dragGhostStyles from "./drag-ghost.module.css";
import nodeCircleStyles from "./node-circle.module.css";
import pillStyles from "./pill.module.css";
import styles from "./change-node.module.css";
import {
  selectedNodes,
  changeDoubleClickAction,
  contextMenu,
  rebaseMenu,
  tooltip,
  isDragging,
  justFinishedDrag,
  dropTargetId,
  graphStyle,
  vscode,
  showTooltips,
  showChangedFiles,
  dragBookmarkName,
  pillContextMenu,
  closeAllMenus,
  pushingBookmarks,
} from "../signals";
import { SWIMLANE_WIDTH, CHANGE_ID_RIGHT_PADDING, rootChangeId } from "../types";
import type { LaneNode } from "../../../graph-protocol";
import type { ChangeNode } from "../../../graph-protocol";
import { abbreviateName } from "../utils";
import { clearAllTooltipTimers } from "../hooks/use-tooltip-timers";

const changedFileTypeClasses: Record<string, string> = {
  a: styles.changedFileA,
  c: styles.changedFileC,
  m: styles.changedFileM,
  d: styles.changedFileD,
  r: styles.changedFileR,
  x: styles.changedFileX,
};

function shouldShowTooltip(changeId: string, branchType: string | undefined): boolean {
  return changeId !== rootChangeId && branchType !== "~";
}

function isMenuOpen(): boolean {
  return contextMenu.value !== null || rebaseMenu.value !== null;
}

function isOverTooltipTarget(e: MouseEvent): boolean {
  const target = e.target as HTMLElement;
  return !!target.closest?.(`.${styles.textContent}`);
}

interface Props {
  change: ChangeNode;
  index: number;
  nodeData: LaneNode | null;
  changeIdRef?: RefObject<HTMLDivElement>;
  compact: boolean;
  showingFiles: boolean;
}

export function ChangeNodeRow({ change, index: _index, nodeData, changeIdRef, compact, showingFiles }: Props) {
  const dragProps = useDragDrop(change);
  const highlightProps = useConnectedHighlight(change.changeId, change.parentChangeIds);
  const { startHoverTimers, clearHoverTimers, clearHideTimer, scheduleHideTooltip } = useTooltipTimers();
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
      if (changeDoubleClickAction.value !== "new" || change.isEmpty) {
        return;
      }
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
    closeAllMenus();
    contextMenu.value = {
      change,
      pageX: e.pageX,
      pageY: e.pageY,
      changeDoubleClickAction: changeDoubleClickAction.value,
    };
  };

  const tryStartTooltip = (e: MouseEvent) => {
    clearHideTimer();
    if (isDragging.value || isMenuOpen() || !showTooltips.value) {
      return;
    }
    if (shouldShowTooltip(change.changeId, change.branchType) && isOverTooltipTarget(e)) {
      startHoverTimers(change, e.pageX, e.pageY);
    }
  };

  const handleMouseEnter = (e: MouseEvent) => {
    highlightProps.onMouseEnter();
    document
      .querySelector(`#node-circles > [data-change-id="${change.changeId}"]`)
      ?.classList.add(nodeCircleStyles.hovered);
    tryStartTooltip(e);
  };

  const handleMouseMove = (e: MouseEvent) => {
    clearHoverTimers();
    tryStartTooltip(e);
  };

  const handleMouseLeave = () => {
    highlightProps.onMouseLeave();
    document
      .querySelector(`#node-circles > [data-change-id="${change.changeId}"]`)
      ?.classList.remove(nodeCircleStyles.hovered);
    clearHoverTimers();
    clearHideTimer();
    scheduleHideTooltip();
  };

  const modeClasses = (compact ? " " + styles.compactMode : "") + (showingFiles ? " " + styles.showingFilesMode : "");

  return (
    <ChangeNodeClass
      changeId={change.changeId}
      currentWorkingCopy={change.currentWorkingCopy}
      isElided={isElided}
      modeClasses={modeClasses}
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
      <div class={styles.changeIdLeft} data-role="change-id" ref={changeIdRef}>
        {change.conflict && <span class={styles.conflictIndicator}>✗</span>}
        <span class={styles.changeIdPrefix}>{change.changeIdPrefix}</span>
        <span class={styles.changeIdSuffix}>{change.changeIdSuffix}</span>
        {change.changeOffset && <span class={styles.changeIdOffset}>/{change.changeOffset}</span>}
      </div>
      <MemoizedChangeNodeTextContent change={change} graphW={graphW} />
    </ChangeNodeClass>
  );
}

function ChangeNodeClass({
  changeId,
  currentWorkingCopy,
  isElided,
  modeClasses,
  children,
  ...rest
}: {
  changeId: string;
  currentWorkingCopy: boolean;
  isElided: boolean;
  modeClasses: string;
  children?: preact.ComponentChildren;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      class={
        styles.changeNode +
        (currentWorkingCopy ? " " + styles.workingCopy : "") +
        (isElided ? " " + styles.elidedNode : "") +
        (selectedNodes.value.has(changeId) ? " " + styles.selected : "") +
        (dropTargetId.value === changeId ? " " + styles.dropTarget : "") +
        modeClasses
      }
      {...rest}
    >
      {children}
    </div>
  );
}

const MemoizedChangeNodeTextContent = memo(function ChangeNodeTextContent({
  change,
  graphW,
}: {
  change: ChangeNode;
  graphW: number;
}) {
  const localBookmarkNames = new Set(change.localBookmarks.map((b) => b.name));
  const localTagNames = new Set(change.localTags.map((t) => t.name));
  const style = graphStyle.value;

  return (
    <div
      class={styles.textContent}
      style={{
        "--graph-width": `${graphW}px`,
        "--change-id-right-padding": `${CHANGE_ID_RIGHT_PADDING}px`,
      }}
    >
      <div>
        {change.workingCopies?.map((wc) => (
          <span key={wc} class={`${pillStyles.pill} ${pillStyles.workspacePill}`}>
            {wc}
          </span>
        ))}
        {change.localBookmarks.map((b) => (
          <span
            key={b.name}
            class={
              `${pillStyles.pill} ${pillStyles.bookmarkPill}` +
              (b.conflict ? " " + pillStyles.conflicted : b.synced ? "" : " " + pillStyles.unsynced)
            }
            data-bookmark={b.name}
            draggable={true}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              closeAllMenus();
              pillContextMenu.value = {
                type: "bookmark",
                name: b.name,
                pageX: e.pageX,
                pageY: e.pageY,
                synced: b.synced,
                pendingRemotes: true,
              };
              vscode.postMessage({ command: "getBookmarkTrackingRemotes", bookmark: b.name });
            }}
            onDragStart={(e) => {
              e.stopPropagation();
              dragBookmarkName.value = b.name;
              isDragging.value = true;
              clearAllTooltipTimers();
              tooltip.value = null;
              e.dataTransfer!.setData("text/plain", "");
              e.dataTransfer!.effectAllowed = "move";

              const ghost = document.createElement("div");
              ghost.className = `${dragGhostStyles.dragGhost} ${dragGhostStyles.bookmarkDragGhost}`;
              ghost.textContent = b.name;
              document.body.appendChild(ghost);
              e.dataTransfer!.setDragImage(ghost, -15, 0);
              setTimeout(() => ghost.remove(), 0);
            }}
            onDragEnd={(e) => {
              e.stopPropagation();
              isDragging.value = false;
              dragBookmarkName.value = null;
              dropTargetId.value = null;
            }}
          >
            {!b.synced &&
              !b.conflict &&
              b.showPushButton !== false &&
              (pushingBookmarks.value.has(b.name) ? (
                <i
                  class={`codicon codicon-sync codicon-modifier-spin ${pillStyles.bookmarkPushIcon} ${pillStyles.bookmarkPushingIcon}`}
                  title="Pushing..."
                />
              ) : (
                <i
                  class={`codicon codicon-cloud-upload ${pillStyles.bookmarkPushIcon}`}
                  title="Push to all tracking remotes"
                  onClick={(e) => {
                    e.stopPropagation();
                    const newSet = new Set(pushingBookmarks.value);
                    newSet.add(b.name);
                    pushingBookmarks.value = newSet;
                    vscode.postMessage({ command: "pushBookmark", bookmark: b.name });
                  }}
                />
              ))}
            {abbreviateName(b.name)}
          </span>
        ))}
        {change.remoteBookmarks
          .filter((b) => !localBookmarkNames.has(b.name))
          .map((b) => (
            <span key={b.name + "@" + b.remote} class={`${pillStyles.pill} ${pillStyles.bookmarkPill}`}>
              {abbreviateName(b.name)}@{b.remote}
            </span>
          ))}
        {change.localTags.map((t) => (
          <span
            key={t.name}
            class={
              `${pillStyles.pill} ${pillStyles.tagPill}` +
              (t.conflict ? " " + pillStyles.conflicted : t.synced ? "" : " " + pillStyles.unsynced)
            }
            data-tag={t.name}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              closeAllMenus();
              pillContextMenu.value = {
                type: "tag",
                name: t.name,
                pageX: e.pageX,
                pageY: e.pageY,
                pendingRemotes: true,
              };
              vscode.postMessage({ command: "getTagPushRemotes", tag: t.name });
            }}
          >
            {abbreviateName(t.name)}
          </span>
        ))}
        {change.remoteTags
          .filter((t) => !localTagNames.has(t.name))
          .map((t) => (
            <span key={t.name + "@" + t.remote} class={`${pillStyles.pill} ${pillStyles.tagPill}`}>
              {abbreviateName(t.name)}@{t.remote}
            </span>
          ))}
        <span>{change.label}</span>
        {style === "compact" && !change.mine && change.authorName && (
          <span class={styles.authorSubdued}>{change.authorName}</span>
        )}
      </div>
      {style !== "compact" && <div class={styles.description}>{change.description}</div>}
      {showChangedFiles.value && !change.elided && change.changedFiles && change.changedFiles.length > 0 && (
        <ChangedFileList change={change} />
      )}
    </div>
  );
});

const ChangedFileList = memo(function ChangedFileList({ change }: { change: ChangeNode }) {
  return (
    <div class={styles.changedFiles}>
      {change.changedFiles!.map((f) => (
        <div
          key={f.path}
          title="Open diff"
          class={`${styles.changedFile} ${changedFileTypeClasses[f.type.toLowerCase()] ?? ""}`}
          onClick={(e) => {
            e.stopPropagation();
            vscode.postMessage({
              command: "openFileDiff",
              changeId: change.changeId,
              path: f.path,
              status: f.type,
              ...(f.renamedFrom ? { renamedFrom: f.renamedFrom } : {}),
            });
          }}
        >
          <span class={styles.changedFileStatus}>{f.type}</span>
          <span class={styles.changedFilePath}>{f.path}</span>
        </div>
      ))}
    </div>
  );
});
