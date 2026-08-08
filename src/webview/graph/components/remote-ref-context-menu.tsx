import { remoteRefContextMenu, vscode } from "../signals";
import { Menu, MenuItem } from "./menu-container";

export function RemoteRefContextMenu() {
  const state = remoteRefContextMenu.value;
  if (!state || state.pendingStatus) {
    return null;
  }

  if (state.action === "delete") {
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
          Delete from {state.remote}
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
