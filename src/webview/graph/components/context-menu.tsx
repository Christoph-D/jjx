import { useEffect, useRef } from "preact/hooks";
import { contextMenu, currentChanges, vscode } from "../signals";
import { abbreviateName } from "../utils";

export function ContextMenu() {
  const menuRef = useRef<HTMLDivElement>(null);
  const state = contextMenu.value;
  if (!state) return null;

  const { change } = state;
  const isImmutable = change.branchType === "◆";

  const allBookmarks = [
    ...new Set(
      currentChanges.value
        .filter((c) => c.localBookmarks && c.localBookmarks.length > 0)
        .flatMap((c) => c.localBookmarks.map((b) => b.name)),
    ),
  ].sort();

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
          title={state.changeEditAction === "new" ? "Create and Edit a New Empty Change on Top" : "Edit This Change"}
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
