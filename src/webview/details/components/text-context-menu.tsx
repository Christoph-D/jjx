import { useRef } from "preact/hooks";
import { useMenuBehavior } from "../../common/use-menu-behavior";
import { closeTextContextMenu, textContextMenu } from "../signals";

// The default (Electron) context menu is suppressed for the whole webview; this menu
// replaces its only useful entry by offering to copy the text selection that was
// right-clicked.
export function TextContextMenu() {
  const state = textContextMenu.value;
  const ref = useRef<HTMLDivElement>(null);

  useMenuBehavior(ref, state, closeTextContextMenu);

  if (!state) {
    return null;
  }

  return (
    <div id="text-context-menu" class="detailsContextMenu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <div
        class="detailsContextMenuItem"
        data-action="copyText"
        onClick={() => {
          void navigator.clipboard.writeText(state.text);
          closeTextContextMenu();
        }}
      >
        Copy
      </div>
    </div>
  );
}
