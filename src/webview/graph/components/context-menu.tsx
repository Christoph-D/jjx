import { useRef } from "preact/hooks";
import { contextMenu, selectedNodes, vscode } from "../signals";
import { useMenuPosition } from "./menu-container";
import styles from "./context-menu.module.css";

export function ContextMenu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const state = contextMenu.value;
  if (!state) {
    return null;
  }

  const { change } = state;
  const isImmutable = change.branchType === "◆";

  useMenuPosition(menuRef, state);

  return (
    <div
      id="context-menu"
      class={styles.contextMenu}
      ref={menuRef}
      style="display: none"
      onClick={(e) => e.stopPropagation()}
      data-change-id={change.changeId}
      data-immutable={isImmutable ? "true" : "false"}
    >
      {!change.currentWorkingCopy && (
        <div
          class={styles.contextMenuItem}
          data-action="edit"
          title={
            state.changeDoubleClickAction === "new" ? "Create and Edit a New Empty Change on Top" : "Edit This Change"
          }
          onClick={() => {
            vscode.postMessage({ command: "editChangeDirect", changeId: change.changeId });
            contextMenu.value = null;
          }}
        >
          Edit
        </div>
      )}
      <div
        class={styles.contextMenuItem}
        data-action="newChild"
        title="Create a New Child Change"
        onClick={() => {
          vscode.postMessage({ command: "newChildChange", changeId: change.changeId });
          contextMenu.value = null;
        }}
      >
        New Child
      </div>
      <div class={styles.contextMenuSeparator}></div>
      <div
        class={styles.contextMenuItem}
        data-action="describe"
        onClick={() => {
          vscode.postMessage({ command: "describeChange", changeId: change.changeId });
          contextMenu.value = null;
        }}
      >
        Describe...
      </div>
      <div class={styles.contextMenuSeparator}></div>
      <div
        class={styles.contextMenuItem}
        data-action="createBookmark"
        onClick={() => {
          vscode.postMessage({ command: "createBookmark", targetChangeId: change.changeId });
          contextMenu.value = null;
        }}
      >
        Create Bookmark...
      </div>
      <div
        class={styles.contextMenuItem}
        data-action="createTag"
        onClick={() => {
          vscode.postMessage({ command: "createTag", targetChangeId: change.changeId });
          contextMenu.value = null;
        }}
      >
        Create Tag...
      </div>
      <div class={styles.contextMenuSeparator}></div>
      <div
        class={styles.contextMenuItem}
        data-action="copyUrl"
        onClick={() => {
          vscode.postMessage({ command: "copyUrl", changeId: change.changeId });
          contextMenu.value = null;
        }}
      >
        Copy URL
      </div>
      <div
        class={styles.contextMenuItem}
        data-action="copyId"
        onClick={() => {
          navigator.clipboard.writeText(change.changeId);
          contextMenu.value = null;
        }}
      >
        Copy Change ID
      </div>
      <div class={styles.contextMenuSeparator}></div>
      <div
        class={styles.contextMenuItem}
        data-action="absorb"
        onClick={() => {
          vscode.postMessage({ command: "absorbChange", changeId: change.changeId });
          contextMenu.value = null;
        }}
      >
        Absorb Into Parents
      </div>
      <div
        class={styles.contextMenuItem}
        data-action="abandon"
        onClick={() => {
          vscode.postMessage({ command: "abandonChange", changeId: change.changeId, immutable: isImmutable });
          contextMenu.value = null;
        }}
      >
        Abandon Change
      </div>
      {selectedNodes.value.size > 1 && selectedNodes.value.has(change.changeId) && (
        <div
          class={styles.contextMenuItem}
          data-action="abandonSelected"
          onClick={() => {
            vscode.postMessage({ command: "abandonChanges", changeIds: Array.from(selectedNodes.value) });
            contextMenu.value = null;
          }}
        >
          Abandon All Selected Changes
        </div>
      )}
    </div>
  );
}
