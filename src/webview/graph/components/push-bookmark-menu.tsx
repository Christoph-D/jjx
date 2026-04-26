import { useRef } from "preact/hooks";
import { pushBookmarkMenu, vscode } from "../signals";
import { useMenuPosition } from "./menu-container";

export function PushBookmarkMenu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const state = pushBookmarkMenu.value;
  if (!state) {
    return null;
  }

  useMenuPosition(menuRef, state);

  return (
    <div
      id="push-bookmark-menu"
      class="context-menu"
      ref={menuRef}
      style="display: none"
      onClick={(e) => e.stopPropagation()}
      data-bookmark={state.bookmark}
    >
      {state.remotes.map((remote) => (
        <div
          key={remote}
          class="context-menu-item"
          onClick={() => {
            vscode.postMessage({ command: "pushBookmarkToRemote", bookmark: state.bookmark, remote });
            pushBookmarkMenu.value = null;
          }}
        >
          Push to {remote}
        </div>
      ))}
    </div>
  );
}
