import { pillContextMenu, postMessage, pushingBookmarks, pushingTags } from "../signals";
import { Menu, MenuItem, MenuSeparator } from "./menu-container";

export function PillContextMenu() {
  const state = pillContextMenu.value;
  if (!state || state.pendingRemotes) {
    return null;
  }

  // While the ref is being pushed, the only available action is to cancel the push.
  if (state.cancelPush) {
    return (
      <Menu id="pill-context-menu" state={state} onClick={(e) => e.stopPropagation()}>
        <MenuItem
          action="cancelPush"
          onClick={() => {
            postMessage({ command: "cancelRemoteRefOperation", refType: state.type, name: state.name });
            pillContextMenu.value = null;
          }}
        >
          Cancel Push
        </MenuItem>
      </Menu>
    );
  }

  const isBookmark = state.type === "bookmark";
  const isTag = state.type === "tag";
  // Don't show track/untrack for tags because tags are not supposed to move,
  // so tracking has limited value beyond tracking deletion.
  const trackingEnabled = isBookmark;
  const deleteLabel = isBookmark ? "Delete Bookmark" : "Delete Tag";

  const showPush = trackingEnabled && state.unsyncedRemotes && state.unsyncedRemotes.length > 0;
  const showTagPush = isTag && state.remotes && state.remotes.length > 0;
  const showTrack = trackingEnabled && state.untrackedRemotes && state.untrackedRemotes.length > 0;
  const showUntrack = trackingEnabled && state.remotes && state.remotes.length > 0;

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
              const newSet = new Set(pushingTags.value);
              newSet.add(state.name);
              pushingTags.value = newSet;
              postMessage({ command: "pushTagToRemote", tag: state.name, remote });
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
              const newSet = new Set(pushingBookmarks.value);
              newSet.add(state.name);
              pushingBookmarks.value = newSet;
              postMessage({ command: "pushBookmarkToRemote", bookmark: state.name, remote });
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
              postMessage({ command: "trackBookmark", bookmark: state.name, remote });
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
              postMessage({ command: "untrackBookmark", bookmark: state.name, remote });
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
          if (isBookmark) {
            postMessage({ command: "deleteBookmark", bookmark: state.name });
          } else {
            postMessage({ command: "deleteTag", tag: state.name });
          }
          pillContextMenu.value = null;
        }}
      >
        {deleteLabel}
      </MenuItem>
    </Menu>
  );
}
