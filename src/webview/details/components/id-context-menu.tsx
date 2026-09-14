import { useRef } from "preact/hooks";
import { useMenuBehavior } from "../../common/use-menu-behavior";
import { closeIdContextMenu, idContextMenu, postMessage } from "../signals";

// The context menu for the Change ID / Commit ID values: right-clicking an unselected ID
// offers copying it in full (omitting an unneeded change-ID offset, like the ID rows) and
// in the short form used elsewhere in the extension.
export function IdContextMenu() {
  const state = idContextMenu.value;
  const ref = useRef<HTMLDivElement>(null);

  useMenuBehavior(ref, state, closeIdContextMenu);

  if (!state) {
    return null;
  }

  const copy = (id: string) => {
    postMessage({ command: "copyId", id });
    closeIdContextMenu();
  };

  return (
    <div id="id-context-menu" class="detailsContextMenu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <div class="detailsContextMenuItem" data-action="copyId" onClick={() => copy(state.fullId)}>
        Copy
      </div>
      <div class="detailsContextMenuItem" data-action="copyShortId" onClick={() => copy(state.shortId)}>
        Copy Short {state.kind === "change" ? "Change" : "Commit"} ID
      </div>
    </div>
  );
}
