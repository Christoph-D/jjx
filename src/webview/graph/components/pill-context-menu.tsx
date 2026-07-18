import { useRef } from "preact/hooks";
import { pillContextMenu, vscode } from "../signals";
import { useMenuPosition } from "./menu-container";
import styles from "./context-menu.module.css";

export function PillContextMenu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const state = pillContextMenu.value;
  if (!state || state.pendingRemotes) {
    return null;
  }

  useMenuPosition(menuRef, state);

  const isBookmark = state.type === "bookmark";
  const deleteLabel = isBookmark ? "Delete Bookmark" : "Delete Tag";
  const deleteCommand = isBookmark ? "deleteBookmark" : "deleteTag";
  const deletePayload = isBookmark ? { bookmark: state.name } : { tag: state.name };

  const showPush = isBookmark && state.unsyncedRemotes && state.unsyncedRemotes.length > 0;
  const showTagPush = !isBookmark && state.remotes && state.remotes.length > 0;
  const showTrack = isBookmark && state.untrackedRemotes && state.untrackedRemotes.length > 0;
  const showUntrack = isBookmark && state.remotes && state.remotes.length > 0;

  const needTopDivider = (showPush && (showTrack || showUntrack)) || (!showPush && showTrack && showUntrack);
  const needMiddleDivider = showTrack && showUntrack;
  const needBottomDivider = showPush || showTrack || showUntrack || showTagPush;

  return (
    <div
      id="pill-context-menu"
      class={styles.contextMenu}
      ref={menuRef}
      style="display: none"
      onClick={(e) => e.stopPropagation()}
    >
      {showTagPush &&
        state.remotes!.map((remote) => (
          <div
            key={`push-${remote}`}
            class={styles.contextMenuItem}
            data-action="pushTag"
            onClick={() => {
              vscode.postMessage({ command: "pushTagToRemote", tag: state.name, remote });
              pillContextMenu.value = null;
            }}
          >
            Push to {remote}
          </div>
        ))}
      {showPush &&
        state.unsyncedRemotes!.map((remote) => (
          <div
            key={`push-${remote}`}
            class={styles.contextMenuItem}
            data-action="pushBookmark"
            onClick={() => {
              vscode.postMessage({ command: "pushBookmarkToRemote", bookmark: state.name, remote });
              pillContextMenu.value = null;
            }}
          >
            Push to {remote}
          </div>
        ))}
      {showPush && needTopDivider && <div class={styles.contextMenuSeparator}></div>}
      {showTrack &&
        state.untrackedRemotes!.map((remote) => (
          <div
            key={`track-${remote}`}
            class={styles.contextMenuItem}
            data-action="trackBookmark"
            onClick={() => {
              vscode.postMessage({ command: "trackBookmark", bookmark: state.name, remote });
              pillContextMenu.value = null;
            }}
          >
            Track on {remote}
          </div>
        ))}
      {showTrack && needMiddleDivider && <div class={styles.contextMenuSeparator}></div>}
      {showUntrack &&
        state.remotes!.map((remote) => (
          <div
            key={`untrack-${remote}`}
            class={styles.contextMenuItem}
            data-action="untrackBookmark"
            onClick={() => {
              vscode.postMessage({ command: "untrackBookmark", bookmark: state.name, remote });
              pillContextMenu.value = null;
            }}
          >
            Untrack from {remote}
          </div>
        ))}
      {needBottomDivider && <div class={styles.contextMenuSeparator}></div>}
      <div
        class={styles.contextMenuItem}
        data-action="deleteRef"
        onClick={() => {
          vscode.postMessage({ command: deleteCommand, ...deletePayload });
          pillContextMenu.value = null;
        }}
      >
        {deleteLabel}
      </div>
    </div>
  );
}
