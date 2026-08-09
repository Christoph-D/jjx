import { contextMenu, selectedNodes, vscode } from "../signals";
import { Menu, MenuItem, MenuSeparator } from "./menu-container";

export function ContextMenu() {
  const state = contextMenu.value;
  if (!state) {
    return null;
  }

  const { change } = state;
  const isImmutable = change.branchType === "◆";

  return (
    <Menu id="context-menu" state={state} onClick={(e) => e.stopPropagation()} data-change-id={change.id.changeId}>
      {!change.currentWorkingCopy && (
        <MenuItem
          action="edit"
          title={
            state.changeDoubleClickAction === "new" ? "Create and Edit a New Empty Change on Top" : "Edit This Change"
          }
          onClick={() => {
            vscode.postMessage({ command: "editChangeDirect", changeId: change.id.changeId });
            contextMenu.value = null;
          }}
        >
          Edit
        </MenuItem>
      )}
      <MenuItem
        action="newChild"
        title="Create a New Child Change"
        onClick={() => {
          vscode.postMessage({ command: "newChildChange", changeId: change.id.changeId });
          contextMenu.value = null;
        }}
      >
        New Child
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        action="describe"
        onClick={() => {
          vscode.postMessage({ command: "describeChange", changeId: change.id.changeId });
          contextMenu.value = null;
        }}
      >
        Describe...
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        action="createBookmark"
        onClick={() => {
          vscode.postMessage({ command: "createBookmark", targetChangeId: change.id.changeId });
          contextMenu.value = null;
        }}
      >
        Create Bookmark...
      </MenuItem>
      <MenuItem
        action="createTag"
        onClick={() => {
          vscode.postMessage({ command: "createTag", targetChangeId: change.id.changeId });
          contextMenu.value = null;
        }}
      >
        Create Tag...
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        action="copyUrl"
        onClick={() => {
          vscode.postMessage({ command: "copyUrl", changeId: change.id.changeId });
          contextMenu.value = null;
        }}
      >
        Copy URL
      </MenuItem>
      <MenuItem
        action="copyId"
        onClick={() => {
          navigator.clipboard.writeText(change.id.changeId);
          contextMenu.value = null;
        }}
      >
        Copy Change ID
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        action="absorb"
        onClick={() => {
          vscode.postMessage({ command: "absorbChange", changeId: change.id.changeId });
          contextMenu.value = null;
        }}
      >
        Absorb Into Parents
      </MenuItem>
      <MenuItem
        action="abandon"
        onClick={() => {
          vscode.postMessage({ command: "abandonChange", changeId: change.id.changeId, immutable: isImmutable });
          contextMenu.value = null;
        }}
      >
        Abandon Change
      </MenuItem>
      {selectedNodes.value.size > 1 && selectedNodes.value.has(change.id.changeId) && (
        <MenuItem
          action="abandonSelected"
          onClick={() => {
            vscode.postMessage({ command: "abandonChanges", changeIds: Array.from(selectedNodes.value) });
            contextMenu.value = null;
          }}
        >
          Abandon All Selected Changes
        </MenuItem>
      )}
    </Menu>
  );
}
