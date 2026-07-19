import { createContext } from "preact";
import type { ComponentChildren, JSX } from "preact";
import { useCallback, useContext, useEffect, useId, useRef, useState } from "preact/hooks";
import styles from "./context-menu.module.css";

export interface SubmenuPosition {
  left?: boolean;
  above?: boolean;
  below?: boolean;
  bottomAligned?: boolean;
}

interface SubmenuRegistration {
  itemEl: HTMLDivElement;
  subEl: HTMLDivElement;
}

interface MenuContextValue {
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  positions: Map<string, SubmenuPosition>;
  register: (id: string, itemEl: HTMLDivElement | null, subEl: HTMLDivElement | null) => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

function useMenuContext(): MenuContextValue {
  const ctx = useContext(MenuContext);
  if (!ctx) {
    throw new Error("Menu components must be rendered inside <Menu>");
  }
  return ctx;
}

export interface MenuProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "style" | "ref"> {
  state: { pageX: number; pageY: number };
  children: ComponentChildren;
  [dataAttr: `data-${string}`]: string | undefined;
}

export function Menu({ state, children, ...rest }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [positions, setPositions] = useState<Map<string, SubmenuPosition>>(new Map());
  const registrations = useRef(new Map<string, SubmenuRegistration>());

  const register = useCallback((id: string, itemEl: HTMLDivElement | null, subEl: HTMLDivElement | null) => {
    if (itemEl && subEl) {
      registrations.current.set(id, { itemEl, subEl });
    } else {
      registrations.current.delete(id);
    }
  }, []);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }
    menu.style.left = "-9999px";
    menu.style.top = "-9999px";
    menu.style.display = "block";
    requestAnimationFrame(() => {
      if (!menuRef.current) {
        return;
      }
      positionMenu(menuRef.current, state.pageX, state.pageY);
      setPositions(measureSubmenus(registrations.current));
    });
  }, [state]);

  return (
    <MenuContext.Provider value={{ activeId, setActiveId, positions, register }}>
      <div
        {...rest}
        class={styles.contextMenu}
        ref={menuRef}
        style="display: none"
        onMouseLeave={() => setActiveId(null)}
      >
        {children}
      </div>
    </MenuContext.Provider>
  );
}

export interface MenuItemProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "style" | "ref"> {
  action: string;
  children: ComponentChildren;
}

export function MenuItem({ action, children, ...rest }: MenuItemProps) {
  const { setActiveId } = useMenuContext();
  return (
    <div {...rest} class={styles.contextMenuItem} data-action={action} onMouseEnter={() => setActiveId(null)}>
      {children}
    </div>
  );
}

export interface SubmenuProps {
  action: string;
  label: string;
  children: ComponentChildren;
}

export function Submenu({ action, label, children }: SubmenuProps) {
  const id = useId();
  const { activeId, setActiveId, positions, register } = useMenuContext();
  const itemRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    register(id, itemRef.current, subRef.current);
    return () => register(id, null, null);
  }, [id, register]);

  const position = positions.get(id);
  const submenuClass =
    styles.contextSubmenu +
    (position?.left ? " " + styles.left : "") +
    (position?.above ? " " + styles.above : "") +
    (position?.below ? " " + styles.below : "") +
    (position?.bottomAligned ? " " + styles.bottomAligned : "");

  return (
    <div
      class={`${styles.contextMenuItem} ${styles.hasSubmenu}` + (activeId === id ? " " + styles.submenuActive : "")}
      data-action={action}
      onMouseEnter={() => setActiveId(id)}
      ref={itemRef}
    >
      {label}
      <div class={submenuClass} ref={subRef}>
        {children}
      </div>
    </div>
  );
}

export interface SubmenuItemProps extends Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "style" | "ref"> {
  action: string;
  children: ComponentChildren;
}

export function SubmenuItem({ action, children, ...rest }: SubmenuItemProps) {
  return (
    <div {...rest} class={styles.contextSubmenuItem} data-action={action}>
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <div class={styles.contextMenuSeparator}></div>;
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

function measureSubmenus(registrations: Map<string, SubmenuRegistration>): Map<string, SubmenuPosition> {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const positions = new Map<string, SubmenuPosition>();

  for (const [id, { itemEl, subEl }] of registrations) {
    const itemRect = itemEl.getBoundingClientRect();
    subEl.style.display = "block";
    const submenuRect = subEl.getBoundingClientRect();
    subEl.style.display = "";

    const fitsRight = itemRect.right + submenuRect.width <= viewportWidth - 10;
    const fitsLeft = itemRect.left - submenuRect.width >= 10;
    const fitsBelow = itemRect.top + submenuRect.height <= viewportHeight - 10;

    const position: SubmenuPosition = {};
    if (fitsRight) {
      if (!fitsBelow) {
        position.bottomAligned = true;
      }
    } else if (fitsLeft) {
      position.left = true;
      if (!fitsBelow) {
        position.bottomAligned = true;
      }
    } else {
      const fitsAbove = itemRect.top - submenuRect.height >= 10;
      if (fitsBelow) {
        position.below = true;
      } else if (fitsAbove) {
        position.above = true;
      } else {
        position.below = true;
      }
    }
    positions.set(id, position);
  }
  return positions;
}
