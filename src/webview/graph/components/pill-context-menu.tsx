import { pillContextMenu, vscode } from "../signals";
import { Menu, MenuItem, MenuSeparator } from "./menu-container";

export function PillContextMenu() {
  const state = pillContextMenu.value;
  if (!state || state.pendingRemotes) {
    return null;
  }

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
    <Menu id="pill-context-menu" state={state} onClick={(e) => e.stopPropagation()}>
      {showTagPush &&
        state.remotes!.map((remote) => (
          <MenuItem
            key={`push-${remote}`}
            action="pushTag"
            onClick={() => {
              vscode.postMessage({ command: "pushTagToRemote", tag: state.name, remote });
              pillContextMenu.value = null;
            }}
          >
            Push to {remote}
          </MenuItem>
        ))}
      {showPush &&
        state.unsyncedRemotes!.map((remote) => (
          <MenuItem
            key={`push-${remote}`}
            action="pushBookmark"
            onClick={() => {
              vscode.postMessage({ command: "pushBookmarkToRemote", bookmark: state.name, remote });
              pillContextMenu.value = null;
            }}
          >
            Push to {remote}
          </MenuItem>
        ))}
      {showPush && needTopDivider && <MenuSeparator />}
      {showTrack &&
        state.untrackedRemotes!.map((remote) => (
          <MenuItem
            key={`track-${remote}`}
            action="trackBookmark"
            onClick={() => {
              vscode.postMessage({ command: "trackBookmark", bookmark: state.name, remote });
              pillContextMenu.value = null;
            }}
          >
            Track on {remote}
          </MenuItem>
        ))}
      {showTrack && needMiddleDivider && <MenuSeparator />}
      {showUntrack &&
        state.remotes!.map((remote) => (
          <MenuItem
            key={`untrack-${remote}`}
            action="untrackBookmark"
            onClick={() => {
              vscode.postMessage({ command: "untrackBookmark", bookmark: state.name, remote });
              pillContextMenu.value = null;
            }}
          >
            Untrack from {remote}
          </MenuItem>
        ))}
      {needBottomDivider && <MenuSeparator />}
      <MenuItem
        action="deleteRef"
        onClick={() => {
          vscode.postMessage({ command: deleteCommand, ...deletePayload });
          pillContextMenu.value = null;
        }}
      >
        {deleteLabel}
      </MenuItem>
    </Menu>
  );
}
