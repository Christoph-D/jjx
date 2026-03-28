import { useEffect } from "preact/hooks";
import type { RefObject } from "preact";

export function useMenuPosition(menuRef: RefObject<HTMLDivElement | null>, pageX: number, pageY: number): void {
  useEffect(() => {
    if (!menuRef.current) return;
    menuRef.current.style.left = "-9999px";
    menuRef.current.style.top = "-9999px";
    menuRef.current.style.display = "block";
    requestAnimationFrame(() => {
      if (!menuRef.current) return;
      positionMenu(menuRef.current, pageX, pageY);
      positionSubmenus(menuRef.current);
      setupSubmenuHover(menuRef.current);
    });
  }, [pageX, pageY]);
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
