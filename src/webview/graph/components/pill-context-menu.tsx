import { useRef } from "preact/hooks";
import { pillContextMenu, vscode } from "../signals";
import { useMenuPosition } from "./menu-container";

export function PillContextMenu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const state = pillContextMenu.value;
  if (!state || state.pendingRemotes) {
    return null;
  }

  useMenuPosition(menuRef, state);

  const isBookmark = state.type === "bookmark";
  const deleteLabel = isBookmark ? "Delete Bookmark" : "Delete Tag";
  const deleteCommand = isBookmark ? "deleteBookmark" : "deleteTag";
  const deletePayload = isBookmark ? { bookmark: state.name } : { tag: state.name };

  return (
    <div
      id="pill-context-menu"
      class="context-menu"
      ref={menuRef}
      style="display: none"
      onClick={(e) => e.stopPropagation()}
    >
      {isBookmark &&
        state.remotes &&
        state.remotes.map((remote) => (
          <div
            key={remote}
            class="context-menu-item"
            data-action="pushBookmark"
            onClick={() => {
              vscode.postMessage({ command: "pushBookmarkToRemote", bookmark: state.name, remote });
              pillContextMenu.value = null;
            }}
          >
            Push to {remote}
          </div>
        ))}
      {isBookmark && state.remotes && state.remotes.length > 0 && <div class="context-menu-separator"></div>}
      <div
        class="context-menu-item"
        data-action="deleteRef"
        onClick={() => {
          vscode.postMessage({ command: deleteCommand, ...deletePayload });
          pillContextMenu.value = null;
        }}
      >
        {deleteLabel}
      </div>
    </div>
  );
}
