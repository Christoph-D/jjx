import { remoteRefContextMenu, supportsTagTracking, vscode } from "../signals";
import { Menu, MenuItem } from "./menu-container";

export function RemoteRefContextMenu() {
  const state = remoteRefContextMenu.value;
  if (!state || state.pendingStatus) {
    return null;
  }

  if (state.action === "delete") {
    const deleteLabel = isBookmark ? "Delete Bookmark" : "Delete Tag";
    return (
      <Menu id="remote-ref-context-menu" state={state} onClick={(e) => e.stopPropagation()}>
        <MenuItem
          action="deleteRemoteRef"
          onClick={() => {
            vscode.postMessage({
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
    const refKey = isBookmark ? "bookmark" : "tag";
    return (
      <Menu id="remote-ref-context-menu" state={state} onClick={(e) => e.stopPropagation()}>
        <MenuItem
          action="trackRemoteRef"
          onClick={() => {
            vscode.postMessage({
              command: isBookmark ? "trackBookmark" : "trackTag",
              [refKey]: state.name,
              remote: state.remote,
            });
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
          vscode.postMessage({
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
