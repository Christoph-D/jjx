import { useEffect, useRef } from "preact/hooks";
import { rebaseMenu, vscode } from "../signals";
import { cleanupSeparators } from "../utils";

export function RebaseMenu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const state = rebaseMenu.value;
  if (!state) return null;

  const { sourceId, targetId, targetChange } = state;
  const isDivergent = !!targetChange.changeOffset && targetChange.changeOffset !== "";
  const isImmutable = targetChange.branchType === "◆";

  useEffect(() => {
    if (!menuRef.current) return;
    menuRef.current.style.left = "-9999px";
    menuRef.current.style.top = "-9999px";
    menuRef.current.style.display = "block";
    requestAnimationFrame(() => {
      if (!menuRef.current) return;
      positionMenu(menuRef.current, state.pageX, state.pageY);
      positionSubmenus(menuRef.current);
      setupSubmenuHover(menuRef.current);
    });
  }, [state]);

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

function positionMenu(menu: HTMLElement, pageX: number, pageY: number): void {
  const menuRect = menu.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;

  let left = pageX;
  let top = pageY;

  if (left + menuRect.width > viewportWidth + scrollX - 10) {
    left = pageX - menuRect.width;
  }

  if (top + menuRect.height > viewportHeight + scrollY - 10) {
    top = pageY - menuRect.height;
  }

  if (left < scrollX + 10) {
    left = scrollX + 10;
  }

  if (top < scrollY + 10) {
    top = scrollY + 10;
  }

  menu.style.left = left + "px";
  menu.style.top = top + "px";
}

function positionSubmenus(menu: HTMLElement): void {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  menu.querySelectorAll(`#${menu.id} .has-submenu`).forEach((item) => {
    const menuItem = item as HTMLElement;
    const submenu = menuItem.querySelector(".context-submenu");
    if (!submenu) return;
    const sub = submenu as HTMLElement;

    const itemRect = menuItem.getBoundingClientRect();
    sub.classList.remove("left", "above", "below", "bottom-aligned");
    sub.style.display = "block";
    const submenuRect = sub.getBoundingClientRect();
    sub.style.display = "";

    const fitsRight = itemRect.right + submenuRect.width <= viewportWidth - 10;
    const fitsLeft = itemRect.left - submenuRect.width >= 10;
    const fitsBelow = itemRect.top + submenuRect.height <= viewportHeight - 10;

    if (fitsRight) {
      if (!fitsBelow) {
        submenu.classList.add("bottom-aligned");
      }
    } else if (fitsLeft) {
      submenu.classList.add("left");
      if (!fitsBelow) {
        submenu.classList.add("bottom-aligned");
      }
    } else {
      const fitsAbove = itemRect.top - submenuRect.height >= 10;
      if (fitsBelow) {
        submenu.classList.add("below");
      } else if (fitsAbove) {
        submenu.classList.add("above");
      } else {
        submenu.classList.add("below");
      }
    }
  });
}

function setupSubmenuHover(menu: HTMLElement): void {
  menu.querySelectorAll(".context-menu-item:not(.has-submenu)").forEach((item) => {
    item.addEventListener("mouseenter", () => {
      menu.querySelectorAll(".has-submenu").forEach((submenuItemEl) => {
        submenuItemEl.classList.remove("submenu-active");
      });
    });
  });

  menu.querySelectorAll(".has-submenu").forEach((item) => {
    item.addEventListener("mouseenter", () => {
      menu.querySelectorAll(".has-submenu").forEach((otherItem) => {
        if (otherItem !== item) {
          otherItem.classList.remove("submenu-active");
        }
      });
      item.classList.add("submenu-active");
    });
  });
}
