import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";
import { positionMenu } from "./position-menu";

/** Where a menu should be anchored, in viewport coordinates. */
export interface MenuAnchor {
  clientX: number;
  clientY: number;
}

/**
 * Shared open-menu lifecycle for the context menus of the graph and details webviews:
 * keep the menu hidden until a rAF callback has positioned it at the anchor (the menu
 * must be laid out before its size is known), close it on outside `pointerdown`
 * (capture phase, so the press that opened it does not immediately close it), on
 * Escape, and on window blur, and cancel the pending rAF frame on cleanup.
 *
 * `state` being null means the menu is closed: nothing is positioned and no listeners
 * are installed. `close` and `onPositioned` must be referentially stable (module-level
 * functions or wrapped in useCallback). `onPositioned` runs after the menu has been
 * positioned and made visible, e.g. to measure submenus against the final position.
 */
export function useMenuBehavior(
  ref: RefObject<HTMLElement>,
  state: MenuAnchor | null,
  close: () => void,
  onPositioned?: () => void,
): void {
  useEffect(() => {
    if (!state) {
      return;
    }
    const menu = ref.current;
    let rafId = 0;
    if (menu) {
      menu.style.visibility = "hidden";
      rafId = requestAnimationFrame(() => {
        const menu = ref.current;
        if (!menu) {
          return;
        }
        positionMenu(menu, state.clientX, state.clientY);
        menu.style.visibility = "";
        onPositioned?.();
      });
    }
    const handlePointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        close();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", close);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", close);
    };
  }, [ref, state, close, onPositioned]);
}
