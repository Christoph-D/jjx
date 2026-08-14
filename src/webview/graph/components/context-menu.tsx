import { contextMenu, currentChanges, selectedNodes, postMessage } from "../signals";
import { ImmutableIcon } from "./immutable-icon";
import { Menu, MenuItem, MenuSeparator } from "./menu-container";

export function ContextMenu() {
  const state = contextMenu.value;
  if (!state) {
    return null;
  }

  const { change } = state;
  const isImmutable = change.branchType === "◆";
  const immutableIcon = isImmutable ? <ImmutableIcon /> : null;
  const hasImmutableSelected =
    selectedNodes.value.size > 1 &&
    selectedNodes.value.has(change.id.changeId) &&
    currentChanges.value.some((c) => c.branchType === "◆" && selectedNodes.value.has(c.id.changeId));
  const abandonSelectedIcon = hasImmutableSelected ? <ImmutableIcon /> : null;

  return (
    <Menu id="context-menu" state={state} onClick={(e) => e.stopPropagation()} data-change-id={change.id.changeId}>
      {!change.currentWorkingCopy && (
        <MenuItem
          action="edit"
          title={
            state.changeDoubleClickAction === "new" ? "Create and Edit a New Empty Change on Top" : "Edit This Change"
          }
          onClick={() => {
            postMessage({ command: "editChangeDirect", changeId: change.id.changeId });
            contextMenu.value = null;
          }}
        >
          Edit{immutableIcon}
        </MenuItem>
      )}
      <MenuItem
        action="newChild"
        title="Create a New Child Change"
        onClick={() => {
          postMessage({ command: "newChildChange", changeId: change.id.changeId });
          contextMenu.value = null;
        }}
      >
        New Child
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        action="describe"
        onClick={() => {
          postMessage({ command: "describeChange", changeId: change.id.changeId });
          contextMenu.value = null;
        }}
      >
        Describe...{immutableIcon}
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        action="createBookmark"
        onClick={() => {
          postMessage({ command: "createBookmark", targetChangeId: change.id.changeId });
          contextMenu.value = null;
        }}
      >
        Create Bookmark...
      </MenuItem>
      <MenuItem
        action="createTag"
        onClick={() => {
          postMessage({ command: "createTag", targetChangeId: change.id.changeId });
          contextMenu.value = null;
        }}
      >
        Create Tag...
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        action="copyUrl"
        onClick={() => {
          postMessage({ command: "copyUrl", changeId: change.id.changeId });
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
      {!change.isEmpty && (
        <MenuItem
          action="split"
          title="Split This Change"
          onClick={() => {
            postMessage({ command: "splitChange", changeId: change.id.changeId });
            contextMenu.value = null;
          }}
        >
          Split...{immutableIcon}
        </MenuItem>
      )}
      <MenuItem
        action="absorb"
        onClick={() => {
          postMessage({ command: "absorbChange", changeId: change.id.changeId });
          contextMenu.value = null;
        }}
      >
        Absorb Into Parents{immutableIcon}
      </MenuItem>
      <MenuItem
        action="abandon"
        onClick={() => {
          postMessage({ command: "abandonChange", changeId: change.id.changeId });
          contextMenu.value = null;
        }}
      >
        Abandon Change{immutableIcon}
      </MenuItem>
      {selectedNodes.value.size > 1 && selectedNodes.value.has(change.id.changeId) && (
        <MenuItem
          action="abandonSelected"
          onClick={() => {
            postMessage({ command: "abandonChanges", changeIds: Array.from(selectedNodes.value) });
            contextMenu.value = null;
          }}
        >
          Abandon All Selected Changes{abandonSelectedIcon}
        </MenuItem>
      )}
    </Menu>
  );
}
