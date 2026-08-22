import { type HTMLAttributes, type RefObject } from "preact";
import { memo } from "preact/compat";
import { useDragDrop } from "../hooks/use-drag-drop";
import { useTooltipTimers } from "../hooks/use-tooltip-timers";
import dragGhostStyles from "./drag-ghost.module.css";
import { BookmarkPill, BookmarkPushIcon, RemoteBookmarkPill, RemoteTagPill, TagPill, WorkspacePill } from "./pill";
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
  postMessage,
  showTooltips,
  showChangedFiles,
  dragBookmarkName,
  pillContextMenu,
  currentWorkspace,
  remoteRefContextMenu,
  closeAllMenus,
  pushingBookmarks,
  pushingTags,
  deletingBookmarks,
  deletingTags,
  supportsTagTracking,
  hoveredChangeId,
  currentChanges,
  connectedHighlight,
  selectionAnchorId,
} from "../signals";
import { computeSelection } from "../selection";
import { SWIMLANE_WIDTH, CHANGE_ID_RIGHT_PADDING, rootChangeId } from "../types";
import { getUniqueId, type LaneNode, type ChangeNode, type RegularChangeNode } from "../../../graph-protocol";
import { abbreviateName, cx, escapeInvisibleChars } from "../utils";
import { clearAllTooltipTimers } from "../hooks/use-tooltip-timers";

function shouldShowTooltip(change: ChangeNode): change is RegularChangeNode {
  return change.branchType !== "~" && change.id.changeId !== rootChangeId;
}

function isMenuOpen(): boolean {
  return contextMenu.value !== null || rebaseMenu.value !== null;
}

function isOverTooltipTarget(e: MouseEvent): boolean {
  const target = e.target as HTMLElement;
  return !!target.closest?.('[data-role="text-content"]');
}

interface Props {
  change: ChangeNode;
  index: number;
  nodeData: LaneNode | null;
  changeIdRef?: RefObject<HTMLDivElement>;
  compact: boolean;
  showingFiles: boolean;
}

export function ChangeNodeRow({ change, index, nodeData, changeIdRef, compact, showingFiles }: Props) {
  const dragProps = useDragDrop(change);
  const { startHoverTimers, clearHoverTimers, clearHideTimer, scheduleHideTooltip } = useTooltipTimers();
  const isElided = change.branchType === "~";
  const graphW = SWIMLANE_WIDTH * (nodeData?.numLanesActiveVisually ?? 0);

  const handleClick = (e: MouseEvent) => {
    if (isDragging.value || justFinishedDrag.value) {
      return;
    }
    if (isElided && !e.shiftKey) {
      return;
    }

    const outcome = computeSelection(currentChanges.value, index, selectionAnchorId.value, selectedNodes.value, {
      shiftKey: e.shiftKey,
      toggleKey: e.ctrlKey || e.metaKey,
    });
    if (outcome.kind === "warning") {
      postMessage({ command: "showWarning", message: outcome.message });
      return;
    }
    selectedNodes.value = outcome.selection;
    selectionAnchorId.value = outcome.anchor;
    postMessage({
      command: "selectChange",
      selectedNodes: Array.from(outcome.selection),
    });
  };

  const handleDoubleClick = () => {
    if (isElided) {
      return;
    }
    if (change.currentWorkingCopy) {
      if (changeDoubleClickAction.value !== "new" || change.isEmpty) {
        return;
      }
    }
    postMessage({ command: "editChange", changeId: change.id.changeId });
  };

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (isElided || change.id.changeId === rootChangeId) {
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
    if (shouldShowTooltip(change) && isOverTooltipTarget(e)) {
      startHoverTimers(change, e.pageX, e.pageY);
    }
  };

  const handleMouseEnter = (e: MouseEvent) => {
    if (!isDragging.value) {
      const childIds: string[] = [];
      for (const c of currentChanges.value) {
        if (change.branchType !== "~" && c.parentChangeIds?.includes(change.id.changeId)) {
          childIds.push(getUniqueId(c));
        }
      }
      const id = getUniqueId(change);
      connectedHighlight.value = {
        focalId: id,
        connectedIds: new Set([id, ...(change.parentChangeIds ?? []), ...childIds]),
      };
    }
    hoveredChangeId.value = getUniqueId(change);
    tryStartTooltip(e);
  };

  const handleMouseMove = (e: MouseEvent) => {
    clearHoverTimers();
    tryStartTooltip(e);
  };

  const handleMouseLeave = () => {
    connectedHighlight.value = null;
    hoveredChangeId.value = null;
    clearHoverTimers();
    clearHideTimer();
    scheduleHideTooltip();
  };

  const modeClasses = cx(compact && styles.compactMode, showingFiles && styles.showingFilesMode);

  const changeUniqueId = getUniqueId(change);

  return (
    <ChangeNodeClass
      changeId={changeUniqueId}
      currentWorkingCopy={change.branchType !== "~" && change.currentWorkingCopy}
      isElided={isElided}
      selected={change.branchType !== "~" && selectedNodes.value.has(change.id.changeId)}
      modeClasses={modeClasses}
      data-change-id={changeUniqueId}
      onClick={handleClick}
      onDblClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      {...dragProps}
    >
      <div class={styles.changeIdLeft} data-role="change-id" ref={changeIdRef}>
        {change.branchType !== "~" && (
          <>
            {change.conflict && (
              <span class={styles.conflictIndicator} data-role="conflict-indicator">
                ✗
              </span>
            )}
            <span class={styles.changeIdPrefix}>{change.id.changeIdPrefix}</span>
            <span class={styles.changeIdSuffix}>{change.id.changeIdSuffix}</span>
            {change.id.changeOffset && <span class={styles.changeIdOffset}>/{change.id.changeOffset}</span>}
          </>
        )}
      </div>
      {change.branchType === "~" ? (
        <ElidedTextContent graphW={graphW} />
      ) : (
        <MemoizedChangeNodeTextContent change={change} graphW={graphW} />
      )}
    </ChangeNodeClass>
  );
}

function ChangeNodeClass({
  changeId,
  currentWorkingCopy,
  isElided,
  selected,
  modeClasses,
  children,
  ...rest
}: {
  changeId: string;
  currentWorkingCopy: boolean;
  isElided: boolean;
  selected: boolean;
  modeClasses: string;
  children?: preact.ComponentChildren;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      class={cx(
        styles.changeNode,
        currentWorkingCopy && styles.workingCopy,
        isElided && styles.elidedNode,
        selected && styles.selected,
        dropTargetId.value === changeId && styles.dropTarget,
        modeClasses,
      )}
      data-selected={selected ? "" : undefined}
      {...rest}
    >
      {children}
    </div>
  );
}

const ElidedTextContent = memo(function ElidedTextContent({ graphW }: { graphW: number }) {
  const style = graphStyle.value;
  return (
    <div
      class={styles.textContent}
      data-role="text-content"
      style={{
        "--graph-width": `${graphW}px`,
        "--change-id-right-padding": `${CHANGE_ID_RIGHT_PADDING}px`,
      }}
    >
      <div></div>
      {style !== "compact" && <div class={styles.description}></div>}
    </div>
  );
});

const MemoizedChangeNodeTextContent = memo(function ChangeNodeTextContent({
  change,
  graphW,
}: {
  change: RegularChangeNode;
  graphW: number;
}) {
  const localBookmarkNames = new Set(change.localBookmarks.map((b) => b.name));
  const localTagNames = new Set(change.localTags.map((t) => t.name));
  const style = graphStyle.value;

  return (
    <div
      class={styles.textContent}
      data-role="text-content"
      style={{
        "--graph-width": `${graphW}px`,
        "--change-id-right-padding": `${CHANGE_ID_RIGHT_PADDING}px`,
      }}
    >
      <div>
        {change.workingCopies?.map((wc) => (
          <WorkspacePill
            key={wc}
            data-workspace={wc}
            title={wc === currentWorkspace.value ? undefined : "Right-click for workspace actions"}
            onContextMenu={
              wc === currentWorkspace.value
                ? undefined
                : (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    closeAllMenus();
                    pillContextMenu.value = {
                      type: "workspace",
                      name: wc,
                      pageX: e.pageX,
                      pageY: e.pageY,
                    };
                  }
            }
          >
            {escapeInvisibleChars(wc)}
          </WorkspacePill>
        ))}
        {change.localBookmarks.map((b) => (
          <BookmarkPill
            key={b.name}
            conflict={b.conflict}
            synced={b.synced}
            data-bookmark={b.name}
            data-unsynced={!b.synced && !b.conflict ? "" : undefined}
            data-conflicted={b.conflict ? "" : undefined}
            draggable={!pushingBookmarks.value.has(b.name)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              closeAllMenus();
              if (pushingBookmarks.value.has(b.name)) {
                pillContextMenu.value = {
                  type: "bookmark",
                  name: b.name,
                  pageX: e.pageX,
                  pageY: e.pageY,
                  cancelPush: true,
                };
                return;
              }
              pillContextMenu.value = {
                type: "bookmark",
                name: b.name,
                pageX: e.pageX,
                pageY: e.pageY,
                synced: b.synced,
                pendingRemotes: true,
              };
              postMessage({ command: "getBookmarkTrackingRemotes", bookmark: b.name });
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
              ghost.className = cx(dragGhostStyles.dragGhost, dragGhostStyles.bookmarkDragGhost);
              ghost.textContent = escapeInvisibleChars(b.name);
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
                <BookmarkPushIcon pushing={true} title="Pushing..." />
              ) : (
                <BookmarkPushIcon
                  title="Push to all tracking remotes"
                  onClick={(e) => {
                    e.stopPropagation();
                    const newSet = new Set(pushingBookmarks.value);
                    newSet.add(b.name);
                    pushingBookmarks.value = newSet;
                    postMessage({ command: "pushBookmark", bookmark: b.name });
                  }}
                />
              ))}
            {abbreviateName(b.name)}
          </BookmarkPill>
        ))}
        {change.remoteBookmarks
          .filter((b) => !localBookmarkNames.has(b.name))
          .map((b) => (
            <RemoteBookmarkPill
              key={b.name + "@" + b.remote}
              data-remote-bookmark={b.name}
              data-remote={b.remote}
              title={b.remote === "git" ? undefined : "Right-click for remote actions"}
              onContextMenu={
                b.remote === "git"
                  ? undefined
                  : (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      closeAllMenus();
                      if (deletingBookmarks.value.has(b.name)) {
                        remoteRefContextMenu.value = {
                          type: "bookmark",
                          name: b.name,
                          remote: b.remote,
                          change,
                          pageX: e.pageX,
                          pageY: e.pageY,
                          changeDoubleClickAction: changeDoubleClickAction.value,
                          cancelDelete: true,
                        };
                        return;
                      }
                      remoteRefContextMenu.value = {
                        type: "bookmark",
                        name: b.name,
                        remote: b.remote,
                        change,
                        pageX: e.pageX,
                        pageY: e.pageY,
                        changeDoubleClickAction: changeDoubleClickAction.value,
                        pendingStatus: true,
                      };
                      postMessage({
                        command: "getRemoteRefStatus",
                        refType: "bookmark",
                        name: b.name,
                        remote: b.remote,
                      });
                    }
              }
            >
              {deletingBookmarks.value.has(b.name) && <BookmarkPushIcon pushing={true} title="Deleting..." />}
              {abbreviateName(b.name)}@{b.remote}
            </RemoteBookmarkPill>
          ))}
        {change.localTags.map((t) => (
          <TagPill
            key={t.name}
            conflict={t.conflict}
            synced={t.synced}
            data-tag={t.name}
            data-unsynced={!t.synced && !t.conflict ? "" : undefined}
            data-conflicted={t.conflict ? "" : undefined}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              closeAllMenus();
              if (pushingTags.value.has(t.name)) {
                pillContextMenu.value = {
                  type: "tag",
                  name: t.name,
                  pageX: e.pageX,
                  pageY: e.pageY,
                  cancelPush: true,
                };
                return;
              }
              pillContextMenu.value = {
                type: "tag",
                name: t.name,
                pageX: e.pageX,
                pageY: e.pageY,
                pendingRemotes: true,
              };
              postMessage({
                command: supportsTagTracking.value ? "getTagTrackingRemotes" : "getTagPushRemotes",
                tag: t.name,
              });
            }}
          >
            {(pushingTags.value.has(t.name) ||
              (supportsTagTracking.value && !t.synced && !t.conflict && t.showPushButton !== false)) &&
              (pushingTags.value.has(t.name) ? (
                <BookmarkPushIcon pushing={true} title="Pushing..." />
              ) : (
                <BookmarkPushIcon
                  title="Push to all tracking remotes"
                  onClick={(e) => {
                    e.stopPropagation();
                    const newSet = new Set(pushingTags.value);
                    newSet.add(t.name);
                    pushingTags.value = newSet;
                    postMessage({ command: "pushTag", tag: t.name });
                  }}
                />
              ))}
            {abbreviateName(t.name)}
          </TagPill>
        ))}
        {change.remoteTags
          .filter((t) => !localTagNames.has(t.name))
          .map((t) => (
            <RemoteTagPill
              key={t.name + "@" + t.remote}
              data-remote-tag={t.name}
              data-remote={t.remote}
              title={t.remote === "git" ? undefined : "Right-click for remote actions"}
              onContextMenu={
                t.remote === "git"
                  ? undefined
                  : (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      closeAllMenus();
                      if (deletingTags.value.has(t.name)) {
                        remoteRefContextMenu.value = {
                          type: "tag",
                          name: t.name,
                          remote: t.remote,
                          change,
                          pageX: e.pageX,
                          pageY: e.pageY,
                          changeDoubleClickAction: changeDoubleClickAction.value,
                          cancelDelete: true,
                        };
                        return;
                      }
                      remoteRefContextMenu.value = {
                        type: "tag",
                        name: t.name,
                        remote: t.remote,
                        change,
                        pageX: e.pageX,
                        pageY: e.pageY,
                        changeDoubleClickAction: changeDoubleClickAction.value,
                        pendingStatus: true,
                      };
                      postMessage({
                        command: "getRemoteRefStatus",
                        refType: "tag",
                        name: t.name,
                        remote: t.remote,
                      });
                    }
              }
            >
              {deletingTags.value.has(t.name) && <BookmarkPushIcon pushing={true} title="Deleting..." />}
              {abbreviateName(t.name)}@{t.remote}
            </RemoteTagPill>
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

const ChangedFileList = memo(function ChangedFileList({ change }: { change: RegularChangeNode }) {
  return (
    <div class={styles.changedFiles}>
      {change.changedFiles!.map((f) => (
        <div
          key={f.path}
          title="Open diff"
          class={styles.changedFile}
          data-role="changed-file"
          data-path={f.path}
          data-status={f.type.toLowerCase()}
          data-conflict={f.conflict ? "" : undefined}
          onClick={(e) => {
            e.stopPropagation();
            postMessage({
              command: "openFileDiff",
              changeId: change.id.changeId,
              path: f.path,
              status: f.type,
              ...(f.renamedFrom ? { renamedFrom: f.renamedFrom } : {}),
            });
          }}
        >
          <span class={styles.changedFileStatus}>
            {f.type}
            {f.conflict && f.type !== "X" ? "!" : ""}
          </span>
          <span class={styles.changedFilePath}>{f.path}</span>
        </div>
      ))}
    </div>
  );
});
