import { state, type ChangeNode } from "./types";
import { abbreviateName, cleanupSeparators } from "./utils";

interface PositionOptions {
  pageX: number;
  pageY: number;
}

export function positionMenu(menu: HTMLElement, position: PositionOptions): void {
  const menuRect = menu.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;

  let left = position.pageX;
  let top = position.pageY;

  if (left + menuRect.width > viewportWidth + scrollX - 10) {
    left = position.pageX - menuRect.width;
  }

  if (top + menuRect.height > viewportHeight + scrollY - 10) {
    top = position.pageY - menuRect.height;
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

export function positionSubmenus(menu: HTMLElement): void {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  document.querySelectorAll(`#${menu.id} .has-submenu`).forEach((item) => {
    const menuItem = item as HTMLElement;
    const submenu = menuItem.querySelector(".context-submenu");
    if (!submenu) {
      return;
    }
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

export function setupSubmenuHover(menu: HTMLElement): void {
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

export function hideMenu(menu: HTMLElement): void {
  menu.style.display = "none";
  menu.querySelectorAll(".has-submenu").forEach((item) => {
    item.classList.remove("submenu-active");
  });
}

export function hideAllMenus(): void {
  const contextMenu = document.getElementById("context-menu")!;
  const rebaseMenu = document.getElementById("rebase-menu")!;
  hideMenu(contextMenu);
  hideMenu(rebaseMenu);
}

export function showContextMenu(change: ChangeNode, e: MouseEvent, changeEditAction: string): void {
  const contextMenu = document.getElementById("context-menu")!;
  contextMenu.dataset.changeId = change.changeId;
  contextMenu.dataset.immutable = change.branchType === "◆" ? "true" : "false";

  const editItem = contextMenu.querySelector('[data-action="edit"]')!;
  if (change.currentWorkingCopy) {
    (editItem as HTMLElement).style.display = "none";
  } else {
    (editItem as HTMLElement).style.display = "block";
  }

  (editItem as HTMLElement).title =
    changeEditAction === "new" ? "Create and Edit a New Empty Change on Top" : "Edit This Change";

  contextMenu.style.left = "-9999px";
  contextMenu.style.top = "-9999px";
  contextMenu.style.display = "block";

  requestAnimationFrame(() => {
    positionMenu(contextMenu, { pageX: e.pageX, pageY: e.pageY });
    positionSubmenus(contextMenu);
    setupSubmenuHover(contextMenu);
  });

  populateBookmarkSubmenu(contextMenu);
  populateDeleteBookmarkSubmenu(contextMenu, change);
  populateDeleteTagSubmenu(contextMenu, change);
}

function populateBookmarkSubmenu(contextMenu: HTMLElement): void {
  const allBookmarks = state.currentChanges
    .filter((c) => c.localBookmarks && c.localBookmarks.length > 0)
    .flatMap((c) => c.localBookmarks.map((b) => b.name));
  const uniqueBookmarks = [...new Set(allBookmarks)].sort();

  const bookmarkSubmenu = document.getElementById("bookmark-submenu")!;
  const moveBookmarkItem = contextMenu.querySelector('[data-action="moveBookmark"]')!;
  bookmarkSubmenu.innerHTML = "";

  if (uniqueBookmarks.length === 0) {
    moveBookmarkItem.classList.add("disabled");
  } else {
    moveBookmarkItem.classList.remove("disabled");
    uniqueBookmarks.forEach((bookmarkName) => {
      const item = document.createElement("div");
      item.className = "context-submenu-item";
      item.textContent = abbreviateName(bookmarkName);
      item.dataset.bookmark = bookmarkName;
      bookmarkSubmenu.appendChild(item);
    });
  }
}

function populateDeleteBookmarkSubmenu(contextMenu: HTMLElement, change: ChangeNode): void {
  const deleteBookmarkSubmenu = document.getElementById("delete-bookmark-submenu")!;
  const deleteBookmarkItem = contextMenu.querySelector('[data-action="deleteBookmark"]')!;
  const localBookmarks = change.localBookmarks || [];
  deleteBookmarkSubmenu.innerHTML = "";

  if (localBookmarks.length === 0) {
    deleteBookmarkItem.classList.add("disabled");
  } else {
    deleteBookmarkItem.classList.remove("disabled");
    localBookmarks.forEach((b) => {
      const item = document.createElement("div");
      item.className = "context-submenu-item";
      item.textContent = abbreviateName(b.name);
      item.dataset.deleteBookmark = b.name;
      deleteBookmarkSubmenu.appendChild(item);
    });
  }
}

function populateDeleteTagSubmenu(contextMenu: HTMLElement, change: ChangeNode): void {
  const deleteTagSubmenu = document.getElementById("delete-tag-submenu")!;
  const deleteTagItem = contextMenu.querySelector('[data-action="deleteTag"]')!;
  const localTags = change.localTags || [];
  deleteTagSubmenu.innerHTML = "";

  if (localTags.length === 0) {
    deleteTagItem.classList.add("disabled");
  } else {
    deleteTagItem.classList.remove("disabled");
    localTags.forEach((t) => {
      const item = document.createElement("div");
      item.className = "context-submenu-item";
      item.textContent = abbreviateName(t.name);
      item.dataset.deleteTag = t.name;
      deleteTagSubmenu.appendChild(item);
    });
  }
}

export interface RebaseMenuOptions {
  sourceId: string;
  targetId: string;
  targetChange: ChangeNode;
  sourceNode: HTMLElement | null;
  pageX: number;
  pageY: number;
}

export function showRebaseMenu(options: RebaseMenuOptions): void {
  const rebaseMenu = document.getElementById("rebase-menu")!;
  rebaseMenu.dataset.sourceId = options.sourceId;
  rebaseMenu.dataset.targetId = options.targetId;
  rebaseMenu.style.left = "-9999px";
  rebaseMenu.style.top = "-9999px";
  rebaseMenu.style.display = "block";

  const sourceIsDivergent: boolean = !!(
    options.sourceNode?.dataset?.changeOffset && options.sourceNode.dataset.changeOffset !== ""
  );
  const targetIsDivergent: boolean = !!(options.targetChange.changeOffset && options.targetChange.changeOffset !== "");
  const isDivergent = sourceIsDivergent || targetIsDivergent;
  const targetIsImmutable = options.targetChange.branchType === "◆";

  configureRebaseMenuItems(rebaseMenu, isDivergent, targetIsImmutable);
  cleanupSeparators(rebaseMenu);

  requestAnimationFrame(() => {
    positionMenu(rebaseMenu, { pageX: options.pageX, pageY: options.pageY });
    positionSubmenus(rebaseMenu);
    setupSubmenuHover(rebaseMenu);
  });
}

function configureRebaseMenuItems(menu: HTMLElement, isDivergent: boolean, targetIsImmutable: boolean): void {
  const show = (selector: string, visible: boolean) => {
    const el = menu.querySelector(selector);
    if (el) {
      (el as HTMLElement).style.display = visible ? "block" : "none";
    }
  };

  if (isDivergent) {
    show('[data-action="rebase"]', false);
    show('[data-action="rebaseWithDescendants"]', false);
    show('[data-action="squashInto"]', false);
    show('[data-action="duplicate"]', true);
    show('[data-action="duplicateOnto"]', true);
    show('[data-action="duplicateAfter"]', true);
    show('[data-action="duplicateBefore"]', true);
    show('[data-action="revert"]', true);
    show('[data-action="revertOnto"]', true);
    show('[data-action="revertAfter"]', true);
    show('[data-action="revertBefore"]', true);
  } else {
    show('[data-action="rebase"]', true);
    show('[data-action="rebaseOnto"]', true);
    show('[data-action="rebaseAfter"]', true);
    show('[data-action="rebaseBefore"]', !targetIsImmutable);

    show('[data-action="rebaseWithDescendants"]', true);
    show('[data-action="rebaseOntoWithDescendants"]', true);
    show('[data-action="rebaseAfterWithDescendants"]', true);
    show('[data-action="rebaseBeforeWithDescendants"]', !targetIsImmutable);

    show('[data-action="squashInto"]', !targetIsImmutable);
    show('[data-action="duplicate"]', true);
    show('[data-action="duplicateOnto"]', true);
    show('[data-action="duplicateAfter"]', true);
    show('[data-action="duplicateBefore"]', !targetIsImmutable);
    show('[data-action="revert"]', true);
    show('[data-action="revertOnto"]', true);
    show('[data-action="revertAfter"]', true);
    show('[data-action="revertBefore"]', !targetIsImmutable);
  }
}

export function handleContextMenuItemClick(e: Event): boolean {
  const contextMenu = document.getElementById("context-menu")!;
  const changeId = contextMenu.dataset.changeId;
  if (!changeId || changeId === "z".repeat(32)) {
    return false;
  }

  const submenuItem = (e.target as Element).closest(".context-submenu-item") as HTMLElement | null;
  if (submenuItem) {
    const bookmark = submenuItem.dataset.bookmark;
    if (bookmark) {
      state.vscode.postMessage({
        command: "moveBookmark",
        bookmark: bookmark,
        targetChangeId: changeId,
      });
    }
    const deleteBookmark = submenuItem.dataset.deleteBookmark;
    if (deleteBookmark) {
      state.vscode.postMessage({
        command: "deleteBookmark",
        bookmark: deleteBookmark,
      });
    }
    const deleteTag = submenuItem.dataset.deleteTag;
    if (deleteTag) {
      state.vscode.postMessage({
        command: "deleteTag",
        tag: deleteTag,
      });
    }
    hideMenu(contextMenu);
    return true;
  }

  const target = (e.target as Element).closest(".context-menu-item") as HTMLElement | null;
  if (!target) {
    return false;
  }

  const action = target.dataset.action;
  const immutable = contextMenu.dataset.immutable === "true";
  if (action === "edit") {
    state.vscode.postMessage({
      command: "editChangeDirect",
      changeId: changeId,
    });
  } else if (action === "copyUrl") {
    state.vscode.postMessage({
      command: "copyUrl",
      changeId: changeId,
    });
  } else if (action === "copyId") {
    navigator.clipboard.writeText(changeId);
  } else if (action === "abandon") {
    state.vscode.postMessage({
      command: "abandonChange",
      changeId: changeId,
      immutable: immutable,
    });
  } else if (action === "createBookmark") {
    state.vscode.postMessage({
      command: "createBookmark",
      targetChangeId: changeId,
    });
  } else if (action === "createTag") {
    state.vscode.postMessage({
      command: "createTag",
      targetChangeId: changeId,
    });
  } else if (action === "describe") {
    state.vscode.postMessage({
      command: "describeChange",
      changeId: changeId,
    });
  }

  hideMenu(contextMenu);
  return true;
}

export function handleRebaseMenuItemClick(e: Event): boolean {
  const rebaseMenu = document.getElementById("rebase-menu")!;
  const sourceId = rebaseMenu.dataset.sourceId;
  const targetId = rebaseMenu.dataset.targetId;
  if (!sourceId || !targetId) {
    hideMenu(rebaseMenu);
    return false;
  }

  const submenuItemEl = (e.target as Element).closest(".context-submenu-item") as HTMLElement | null;
  if (submenuItemEl) {
    const action = submenuItemEl.dataset.action;
    if (action === "rebaseOnto" || action === "rebaseOntoWithDescendants") {
      state.vscode.postMessage({
        command: "rebaseOnto",
        changeId: sourceId,
        targetChangeId: targetId,
        withDescendants: action === "rebaseOntoWithDescendants",
      });
    } else if (action === "rebaseAfter" || action === "rebaseAfterWithDescendants") {
      state.vscode.postMessage({
        command: "rebaseAfter",
        changeId: sourceId,
        targetChangeId: targetId,
        withDescendants: action === "rebaseAfterWithDescendants",
      });
    } else if (action === "rebaseBefore" || action === "rebaseBeforeWithDescendants") {
      state.vscode.postMessage({
        command: "rebaseBefore",
        changeId: sourceId,
        targetChangeId: targetId,
        withDescendants: action === "rebaseBeforeWithDescendants",
      });
    } else if (action === "duplicateOnto") {
      state.vscode.postMessage({
        command: "duplicateOnto",
        changeId: sourceId,
        targetChangeId: targetId,
      });
    } else if (action === "duplicateAfter") {
      state.vscode.postMessage({
        command: "duplicateAfter",
        changeId: sourceId,
        targetChangeId: targetId,
      });
    } else if (action === "duplicateBefore") {
      state.vscode.postMessage({
        command: "duplicateBefore",
        changeId: sourceId,
        targetChangeId: targetId,
      });
    } else if (action === "revertOnto") {
      state.vscode.postMessage({
        command: "revertOnto",
        changeId: sourceId,
        targetChangeId: targetId,
      });
    } else if (action === "revertAfter") {
      state.vscode.postMessage({
        command: "revertAfter",
        changeId: sourceId,
        targetChangeId: targetId,
      });
    } else if (action === "revertBefore") {
      state.vscode.postMessage({
        command: "revertBefore",
        changeId: sourceId,
        targetChangeId: targetId,
      });
    }
    hideMenu(rebaseMenu);
    return true;
  }

  const target = (e.target as Element).closest(".context-menu-item") as HTMLElement | null;
  if (!target) {
    return false;
  }

  const action = target.dataset.action;
  if (action === "squashInto") {
    state.vscode.postMessage({
      command: "squashInto",
      changeId: sourceId,
      targetChangeId: targetId,
    });
  }

  hideMenu(rebaseMenu);
  return true;
}
