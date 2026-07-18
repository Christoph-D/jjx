import { useRef } from "preact/hooks";
import { rebaseMenu, vscode } from "../signals";
import { useMenuPosition } from "./menu-container";
import styles from "./context-menu.module.css";

export function RebaseMenu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const state = rebaseMenu.value;
  if (!state) {
    return null;
  }

  const { sourceId, targetId, targetChange } = state;
  const isDivergent = !!targetChange.changeOffset && targetChange.changeOffset !== "";
  const isImmutable = targetChange.branchType === "◆";

  useMenuPosition(menuRef, state);

  const sendCommand = (command: string, withDescendants = false) => {
    vscode.postMessage({ command, changeId: sourceId, targetChangeId: targetId, withDescendants });
    rebaseMenu.value = null;
  };

  return (
    <div
      id="rebase-menu"
      class={styles.contextMenu}
      ref={menuRef}
      style="display: none"
      onClick={(e) => e.stopPropagation()}
      data-source-id={sourceId}
      data-target-id={targetId}
    >
      {!isDivergent && (
        <>
          <div class={`${styles.contextMenuItem} ${styles.hasSubmenu}`} data-action="rebase">
            Rebase
            <div class={styles.contextSubmenu}>
              <div class={styles.contextSubmenuItem} data-action="rebaseOnto" onClick={() => sendCommand("rebaseOnto")}>
                Onto
              </div>
              <div
                class={styles.contextSubmenuItem}
                data-action="rebaseAfter"
                onClick={() => sendCommand("rebaseAfter")}
              >
                After
              </div>
              {!isImmutable && (
                <div
                  class={styles.contextSubmenuItem}
                  data-action="rebaseBefore"
                  onClick={() => sendCommand("rebaseBefore")}
                >
                  Before
                </div>
              )}
            </div>
          </div>
          <div class={`${styles.contextMenuItem} ${styles.hasSubmenu}`} data-action="rebaseWithDescendants">
            Rebase With Descendants
            <div class={styles.contextSubmenu}>
              <div
                class={styles.contextSubmenuItem}
                data-action="rebaseOntoWithDescendants"
                onClick={() => sendCommand("rebaseOnto", true)}
              >
                Onto
              </div>
              <div
                class={styles.contextSubmenuItem}
                data-action="rebaseAfterWithDescendants"
                onClick={() => sendCommand("rebaseAfter", true)}
              >
                After
              </div>
              {!isImmutable && (
                <div
                  class={styles.contextSubmenuItem}
                  data-action="rebaseBeforeWithDescendants"
                  onClick={() => sendCommand("rebaseBefore", true)}
                >
                  Before
                </div>
              )}
            </div>
          </div>
          <div class={styles.contextMenuSeparator}></div>
          {!isImmutable && (
            <div class={styles.contextMenuItem} data-action="squashInto" onClick={() => sendCommand("squashInto")}>
              Squash Into
            </div>
          )}
        </>
      )}
      <div class={`${styles.contextMenuItem} ${styles.hasSubmenu}`} data-action="duplicate">
        Duplicate
        <div class={styles.contextSubmenu}>
          <div
            class={styles.contextSubmenuItem}
            data-action="duplicateOnto"
            onClick={() => sendCommand("duplicateOnto")}
          >
            Onto
          </div>
          <div
            class={styles.contextSubmenuItem}
            data-action="duplicateAfter"
            onClick={() => sendCommand("duplicateAfter")}
          >
            After
          </div>
          {(!isDivergent ? !isImmutable : true) && (
            <div
              class={styles.contextSubmenuItem}
              data-action="duplicateBefore"
              onClick={() => sendCommand("duplicateBefore")}
            >
              Before
            </div>
          )}
        </div>
      </div>
      <div class={`${styles.contextMenuItem} ${styles.hasSubmenu}`} data-action="revert">
        Revert
        <div class={styles.contextSubmenu}>
          <div class={styles.contextSubmenuItem} data-action="revertOnto" onClick={() => sendCommand("revertOnto")}>
            Onto
          </div>
          <div class={styles.contextSubmenuItem} data-action="revertAfter" onClick={() => sendCommand("revertAfter")}>
            After
          </div>
          {(!isDivergent ? !isImmutable : true) && (
            <div
              class={styles.contextSubmenuItem}
              data-action="revertBefore"
              onClick={() => sendCommand("revertBefore")}
            >
              Before
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
