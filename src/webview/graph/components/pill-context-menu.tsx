import { useRef } from "preact/hooks";
import { pillContextMenu, vscode } from "../signals";
import { useMenuPosition } from "./menu-container";

export function PillContextMenu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const state = pillContextMenu.value;
  if (!state) {
    return null;
  }

  useMenuPosition(menuRef, state);

  const label = state.type === "bookmark" ? "Delete Bookmark" : "Delete Tag";
  const command = state.type === "bookmark" ? "deleteBookmark" : "deleteTag";
  const payload = state.type === "bookmark" ? { bookmark: state.name } : { tag: state.name };

  return (
    <div
      id="pill-context-menu"
      class="context-menu"
      ref={menuRef}
      style="display: none"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        class="context-menu-item"
        onClick={() => {
          vscode.postMessage({ command, ...payload });
          pillContextMenu.value = null;
        }}
      >
        {label}
      </div>
    </div>
  );
}
