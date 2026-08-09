import { remoteRefContextMenu, supportsTagTracking, postMessage } from "../signals";
import { Menu, MenuItem } from "./menu-container";

export function RemoteRefContextMenu() {
  const state = remoteRefContextMenu.value;
  if (!state || state.pendingStatus) {
    return null;
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
