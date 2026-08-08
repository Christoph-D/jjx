import { pillContextMenu, supportsTagTracking, vscode } from "../signals";
import { Menu, MenuItem, MenuSeparator } from "./menu-container";

export function PillContextMenu() {
  const state = pillContextMenu.value;
  if (!state || state.pendingRemotes) {
    return null;
  }

  const isBookmark = state.type === "bookmark";
  // Tags gain bookmark-style tracking (track/untrack/push) on jj 0.44+. Older
  // jj versions only support pushing tags directly via git.
  const trackingEnabled = isBookmark || supportsTagTracking.value;
  const deleteLabel = isBookmark ? "Delete Bookmark" : "Delete Tag";
  const deleteCommand = isBookmark ? "deleteBookmark" : "deleteTag";
  const deletePayload = isBookmark ? { bookmark: state.name } : { tag: state.name };

  const showPush = trackingEnabled && state.unsyncedRemotes && state.unsyncedRemotes.length > 0;
  const showTagPush = !trackingEnabled && state.remotes && state.remotes.length > 0;
  const showTrack = trackingEnabled && state.untrackedRemotes && state.untrackedRemotes.length > 0;
  const showUntrack = trackingEnabled && state.remotes && state.remotes.length > 0;

  const needTopDivider = (showPush && (showTrack || showUntrack)) || (!showPush && showTrack && showUntrack);
  const needMiddleDivider = showTrack && showUntrack;
  const needBottomDivider = showPush || showTrack || showUntrack || showTagPush;

  const pushCommand = isBookmark ? "pushBookmarkToRemote" : "pushTagToRemote";
  const trackCommand = isBookmark ? "trackBookmark" : "trackTag";
  const untrackCommand = isBookmark ? "untrackBookmark" : "untrackTag";
  const refKey = isBookmark ? "bookmark" : "tag";

  return (
    <Menu id="pill-context-menu" state={state} onClick={(e) => e.stopPropagation()}>
      {showTagPush &&
        state.remotes!.map((remote) => (
          <MenuItem
            key={`push-${remote}`}
            action="pushTag"
            onClick={() => {
              vscode.postMessage({ command: pushCommand, [refKey]: state.name, remote });
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
            action={isBookmark ? "pushBookmark" : "pushTag"}
            onClick={() => {
              vscode.postMessage({ command: pushCommand, [refKey]: state.name, remote });
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
            action={isBookmark ? "trackBookmark" : "trackTag"}
            onClick={() => {
              vscode.postMessage({ command: trackCommand, [refKey]: state.name, remote });
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
            action={isBookmark ? "untrackBookmark" : "untrackTag"}
            onClick={() => {
              vscode.postMessage({ command: untrackCommand, [refKey]: state.name, remote });
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
