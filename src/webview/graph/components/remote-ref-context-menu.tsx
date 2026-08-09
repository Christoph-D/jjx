import {
  remoteRefContextMenu,
  supportsTagTracking,
  postMessage,
  pushingBookmarks,
  pushingTags,
  deletingBookmarks,
  deletingTags,
} from "../signals";
import { Menu, MenuItem } from "./menu-container";

export function RemoteRefContextMenu() {
  const state = remoteRefContextMenu.value;
  if (!state || state.pendingStatus) {
    return null;
  }

  // While the ref is being deleted from the remote, the only available action is to cancel.
  if (state.cancelDelete) {
    return (
      <Menu id="remote-ref-context-menu" state={state} onClick={(e) => e.stopPropagation()}>
        <MenuItem
          action="cancelRemoteRefOperation"
          onClick={() => {
            postMessage({ command: "cancelRemoteRefOperation", refType: state.type, name: state.name });
            remoteRefContextMenu.value = null;
          }}
        >
          Cancel Deletion
        </MenuItem>
      </Menu>
    );
  }

  if (state.action === "delete") {
    const isBookmark = state.type === "bookmark";
    const deleteLabel = isBookmark ? "Delete Bookmark" : "Delete Tag";
    const restoreLabel = isBookmark ? "Restore Bookmark" : "Restore Tag";
    return (
      <Menu id="remote-ref-context-menu" state={state} onClick={(e) => e.stopPropagation()}>
        <MenuItem
          action="deleteRemoteRef"
          onClick={() => {
            const deleting = state.type === "bookmark" ? deletingBookmarks : deletingTags;
            const newSet = new Set(deleting.value);
            newSet.add(state.name);
            deleting.value = newSet;
            postMessage({
              command: "deleteRemoteRef",
              refType: state.type,
              name: state.name,
              remote: state.remote,
            });
            remoteRefContextMenu.value = null;
          }}
        >
          {deleteLabel} from {state.remote}
        </MenuItem>
        <MenuItem
          action="restoreRemoteRef"
          onClick={() => {
            postMessage({
              command: "restoreRemoteRef",
              refType: state.type,
              name: state.name,
              remote: state.remote,
            });
            remoteRefContextMenu.value = null;
          }}
        >
          {restoreLabel} from {state.remote}
        </MenuItem>
      </Menu>
    );
  }

  if (state.action === "track") {
    const isBookmark = state.type === "bookmark";
    // Tags require jj 0.44+ for remote tracking; older versions only support
    // pushing tags directly via git and cannot track them.
    if (!isBookmark && !supportsTagTracking.value) {
      return (
        <Menu id="remote-ref-context-menu" state={state} onClick={(e) => e.stopPropagation()}>
          <MenuItem action="trackRemoteRefUnavailable" disabled>
            Unavailable: Tag tracking requires jj v0.44+
          </MenuItem>
        </Menu>
      );
    }
    const label = isBookmark ? "Track Bookmark" : "Track Tag";
    return (
      <Menu id="remote-ref-context-menu" state={state} onClick={(e) => e.stopPropagation()}>
        <MenuItem
          action="trackRemoteRef"
          onClick={() => {
            if (isBookmark) {
              postMessage({ command: "trackBookmark", bookmark: state.name, remote: state.remote });
            } else {
              postMessage({ command: "trackTag", tag: state.name, remote: state.remote });
            }
            remoteRefContextMenu.value = null;
          }}
        >
          {label} from {state.remote}
        </MenuItem>
      </Menu>
    );
  }

  const label = state.type === "bookmark" ? "Push Local Bookmark" : "Push Local Tag";
  return (
    <Menu id="remote-ref-context-menu" state={state} onClick={(e) => e.stopPropagation()}>
      <MenuItem
        action="pushRemoteRef"
        onClick={() => {
          const pushing = state.type === "bookmark" ? pushingBookmarks : pushingTags;
          const newSet = new Set(pushing.value);
          newSet.add(state.name);
          pushing.value = newSet;
          postMessage({
            command: "pushRemoteRef",
            refType: state.type,
            name: state.name,
            remote: state.remote,
          });
          remoteRefContextMenu.value = null;
        }}
      >
        {label} to {state.remote}
      </MenuItem>
    </Menu>
  );
}
