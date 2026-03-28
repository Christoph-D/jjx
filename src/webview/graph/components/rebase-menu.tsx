import { useRef } from "preact/hooks";
import { rebaseMenu, vscode } from "../signals";
import { useMenuPosition } from "./menu-container";

export function RebaseMenu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const state = rebaseMenu.value;
  if (!state) {
    return null;
  }

  const { sourceId, targetId, targetChange } = state;
  const isDivergent = !!targetChange.changeOffset && targetChange.changeOffset !== "";
  const isImmutable = targetChange.branchType === "◆";

  useMenuPosition(menuRef, state.pageX, state.pageY);

  const sendCommand = (command: string, withDescendants = false) => {
    vscode.postMessage({ command, changeId: sourceId, targetChangeId: targetId, withDescendants });
    rebaseMenu.value = null;
  };

  return (
    <div
      id="rebase-menu"
      class="context-menu"
      ref={menuRef}
      style="display: none"
      onClick={(e) => e.stopPropagation()}
      data-source-id={sourceId}
      data-target-id={targetId}
    >
      {!isDivergent && (
        <>
          <div class="context-menu-item has-submenu" data-action="rebase">
            Rebase
            <div class="context-submenu">
              <div class="context-submenu-item" data-action="rebaseOnto" onClick={() => sendCommand("rebaseOnto")}>
                Onto
              </div>
              <div class="context-submenu-item" data-action="rebaseAfter" onClick={() => sendCommand("rebaseAfter")}>
                After
              </div>
              {!isImmutable && (
                <div
                  class="context-submenu-item"
                  data-action="rebaseBefore"
                  onClick={() => sendCommand("rebaseBefore")}
                >
                  Before
                </div>
              )}
            </div>
          </div>
          <div class="context-menu-item has-submenu" data-action="rebaseWithDescendants">
            Rebase With Descendants
            <div class="context-submenu">
              <div
                class="context-submenu-item"
                data-action="rebaseOntoWithDescendants"
                onClick={() => sendCommand("rebaseOnto", true)}
              >
                Onto
              </div>
              <div
                class="context-submenu-item"
                data-action="rebaseAfterWithDescendants"
                onClick={() => sendCommand("rebaseAfter", true)}
              >
                After
              </div>
              {!isImmutable && (
                <div
                  class="context-submenu-item"
                  data-action="rebaseBeforeWithDescendants"
                  onClick={() => sendCommand("rebaseBefore", true)}
                >
                  Before
                </div>
              )}
            </div>
          </div>
          <div class="context-menu-separator"></div>
          {!isImmutable && (
            <div class="context-menu-item" data-action="squashInto" onClick={() => sendCommand("squashInto")}>
              Squash Into
            </div>
          )}
        </>
      )}
      <div class="context-menu-item has-submenu" data-action="duplicate">
        Duplicate
        <div class="context-submenu">
          <div class="context-submenu-item" data-action="duplicateOnto" onClick={() => sendCommand("duplicateOnto")}>
            Onto
          </div>
          <div class="context-submenu-item" data-action="duplicateAfter" onClick={() => sendCommand("duplicateAfter")}>
            After
          </div>
          {(!isDivergent ? !isImmutable : true) && (
            <div
              class="context-submenu-item"
              data-action="duplicateBefore"
              onClick={() => sendCommand("duplicateBefore")}
            >
              Before
            </div>
          )}
        </div>
      </div>
      <div class="context-menu-item has-submenu" data-action="revert">
        Revert
        <div class="context-submenu">
          <div class="context-submenu-item" data-action="revertOnto" onClick={() => sendCommand("revertOnto")}>
            Onto
          </div>
          <div class="context-submenu-item" data-action="revertAfter" onClick={() => sendCommand("revertAfter")}>
            After
          </div>
          {(!isDivergent ? !isImmutable : true) && (
            <div class="context-submenu-item" data-action="revertBefore" onClick={() => sendCommand("revertBefore")}>
              Before
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
