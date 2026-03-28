import { useRef } from "preact/hooks";
import { contextMenu, currentChanges, selectedNodes, vscode } from "../signals";
import { abbreviateName } from "../utils";
import { useMenuPosition } from "./menu-container";

export function ContextMenu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const state = contextMenu.value;
  if (!state) {
    return null;
  }

  const { change } = state;
  const isImmutable = change.branchType === "◆";

  const allBookmarks = [
    ...new Set(
      currentChanges.value
        .filter((c) => c.localBookmarks && c.localBookmarks.length > 0)
        .flatMap((c) => c.localBookmarks.map((b) => b.name)),
    ),
  ].sort();

  useMenuPosition(menuRef, state.pageX, state.pageY);

  return (
    <div
      id="context-menu"
      class="context-menu"
      ref={menuRef}
      style="display: none"
      onClick={(e) => e.stopPropagation()}
      data-change-id={change.changeId}
      data-immutable={isImmutable ? "true" : "false"}
    >
      {!change.currentWorkingCopy && (
        <div
          class="context-menu-item"
          data-action="edit"
          title={
            state.changeDoubleClickAction === "new" ? "Create and Edit a New Empty Change on Top" : "Edit This Change"
          }
          onClick={() => {
            vscode.postMessage({ command: "editChangeDirect", changeId: change.changeId });
            contextMenu.value = null;
          }}
        >
          Edit This Change
        </div>
      )}
      <div
        class="context-menu-item"
        data-action="newChild"
        title="Create a New Child Change"
        onClick={() => {
          vscode.postMessage({ command: "newChildChange", changeId: change.changeId });
          contextMenu.value = null;
        }}
      >
        New Child
      </div>
      <div class="context-menu-separator"></div>
      <div
        class="context-menu-item"
        data-action="describe"
        onClick={() => {
          vscode.postMessage({ command: "describeChange", changeId: change.changeId });
          contextMenu.value = null;
        }}
      >
        Describe Change...
      </div>
      <div class="context-menu-separator"></div>
      <div
        class={"context-menu-item has-submenu" + (allBookmarks.length === 0 ? " disabled" : "")}
        data-action="moveBookmark"
      >
        Move Bookmark Here
        <div class="context-submenu" id="bookmark-submenu">
          {allBookmarks.map((name) => (
            <div
              class="context-submenu-item"
              data-bookmark={name}
              onClick={() => {
                vscode.postMessage({ command: "moveBookmark", bookmark: name, targetChangeId: change.changeId });
                contextMenu.value = null;
              }}
            >
              {abbreviateName(name)}
            </div>
          ))}
        </div>
      </div>
      <div
        class="context-menu-item"
        data-action="createBookmark"
        onClick={() => {
          vscode.postMessage({ command: "createBookmark", targetChangeId: change.changeId });
          contextMenu.value = null;
        }}
      >
        Create Bookmark...
      </div>
      <div
        class={"context-menu-item has-submenu" + (change.localBookmarks.length === 0 ? " disabled" : "")}
        data-action="deleteBookmark"
      >
        Delete Bookmark
        <div class="context-submenu" id="delete-bookmark-submenu">
          {change.localBookmarks.map((b) => (
            <div
              class="context-submenu-item"
              data-delete-bookmark={b.name}
              onClick={() => {
                vscode.postMessage({ command: "deleteBookmark", bookmark: b.name });
                contextMenu.value = null;
              }}
            >
              {abbreviateName(b.name)}
            </div>
          ))}
        </div>
      </div>
      <div class="context-menu-separator"></div>
      <div
        class="context-menu-item"
        data-action="createTag"
        onClick={() => {
          vscode.postMessage({ command: "createTag", targetChangeId: change.changeId });
          contextMenu.value = null;
        }}
      >
        Create Tag...
      </div>
      <div
        class={"context-menu-item has-submenu" + (change.localTags.length === 0 ? " disabled" : "")}
        data-action="deleteTag"
      >
        Delete Tag
        <div class="context-submenu" id="delete-tag-submenu">
          {change.localTags.map((t) => (
            <div
              class="context-submenu-item"
              data-delete-tag={t.name}
              onClick={() => {
                vscode.postMessage({ command: "deleteTag", tag: t.name });
                contextMenu.value = null;
              }}
            >
              {abbreviateName(t.name)}
            </div>
          ))}
        </div>
      </div>
      <div class="context-menu-separator"></div>
      <div
        class="context-menu-item"
        data-action="copyUrl"
        onClick={() => {
          vscode.postMessage({ command: "copyUrl", changeId: change.changeId });
          contextMenu.value = null;
        }}
      >
        Copy URL
      </div>
      <div
        class="context-menu-item"
        data-action="copyId"
        onClick={() => {
          navigator.clipboard.writeText(change.changeId);
          contextMenu.value = null;
        }}
      >
        Copy Change ID
      </div>
      <div class="context-menu-separator"></div>
      <div
        class="context-menu-item"
        data-action="absorb"
        onClick={() => {
          vscode.postMessage({ command: "absorbChange", changeId: change.changeId });
          contextMenu.value = null;
        }}
      >
        Absorb Into Parents
      </div>
      <div
        class="context-menu-item"
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
          class="context-menu-item"
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
