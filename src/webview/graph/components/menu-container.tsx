import { useEffect } from "preact/hooks";
import type { RefObject } from "preact";
import styles from "./context-menu.module.css";

export function useMenuPosition(
  menuRef: RefObject<HTMLDivElement | null>,
  state: { pageX: number; pageY: number },
): void {
  useEffect(() => {
    if (!menuRef.current) {
      return;
    }
    menuRef.current.style.left = "-9999px";
    menuRef.current.style.top = "-9999px";
    menuRef.current.style.display = "block";
    requestAnimationFrame(() => {
      if (!menuRef.current) {
        return;
      }
      positionMenu(menuRef.current, state.pageX, state.pageY);
      positionSubmenus(menuRef.current);
      setupSubmenuHover(menuRef.current);
    });
  }, [state]);
}

function positionMenu(menu: HTMLElement, pageX: number, pageY: number): void {
  const menuRect = menu.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const scrollY = window.scrollY || window.pageYOffset;

  let left = pageX;
  let top = pageY;

  if (left + menuRect.width > viewportWidth - 10) {
    left = pageX - menuRect.width;
  }

  if (top + menuRect.height > viewportHeight + scrollY - 10) {
    top = pageY - menuRect.height;
  }

  if (left < 10) {
    left = 10;
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

  menu.querySelectorAll(`#${menu.id} .${styles.hasSubmenu}`).forEach((item) => {
    const menuItem = item as HTMLElement;
    const submenu = menuItem.querySelector(`.${styles.contextSubmenu}`);
    if (!submenu) {
      return;
    }
    const sub = submenu as HTMLElement;

    const itemRect = menuItem.getBoundingClientRect();
    sub.classList.remove(styles.left, styles.above, styles.below, styles.bottomAligned);
    sub.style.display = "block";
    const submenuRect = sub.getBoundingClientRect();
    sub.style.display = "";

    const fitsRight = itemRect.right + submenuRect.width <= viewportWidth - 10;
    const fitsLeft = itemRect.left - submenuRect.width >= 10;
    const fitsBelow = itemRect.top + submenuRect.height <= viewportHeight - 10;

    if (fitsRight) {
      if (!fitsBelow) {
        submenu.classList.add(styles.bottomAligned);
      }
    } else if (fitsLeft) {
      submenu.classList.add(styles.left);
      if (!fitsBelow) {
        submenu.classList.add(styles.bottomAligned);
      }
    } else {
      const fitsAbove = itemRect.top - submenuRect.height >= 10;
      if (fitsBelow) {
        submenu.classList.add(styles.below);
      } else if (fitsAbove) {
        submenu.classList.add(styles.above);
      } else {
        submenu.classList.add(styles.below);
      }
    }
  });
}

function setupSubmenuHover(menu: HTMLElement): void {
  menu.querySelectorAll(`.${styles.contextMenuItem}:not(.${styles.hasSubmenu})`).forEach((item) => {
    item.addEventListener("mouseenter", () => {
      menu.querySelectorAll(`.${styles.hasSubmenu}`).forEach((submenuItemEl) => {
        submenuItemEl.classList.remove(styles.submenuActive);
      });
    });
  });

  menu.querySelectorAll(`.${styles.hasSubmenu}`).forEach((item) => {
    item.addEventListener("mouseenter", () => {
      menu.querySelectorAll(`.${styles.hasSubmenu}`).forEach((otherItem) => {
        if (otherItem !== item) {
          otherItem.classList.remove(styles.submenuActive);
        }
      });
      item.classList.add(styles.submenuActive);
    });
  });
}
