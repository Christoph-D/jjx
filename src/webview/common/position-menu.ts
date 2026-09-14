const ANCHOR_OFFSET = 2;
const VIEWPORT_MARGIN = 10;

// The menu element is position: fixed, so clientX/clientY (viewport coordinates) map
// directly onto style.left/style.top: the anchor stays at the click point regardless of
// scroll position or where in the DOM the menu is rendered.
export function positionMenu(menu: HTMLElement, clientX: number, clientY: number): void {
  const menuRect = menu.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = clientX + ANCHOR_OFFSET;
  let top = clientY + ANCHOR_OFFSET;

  if (left + menuRect.width > viewportWidth - VIEWPORT_MARGIN) {
    left = clientX - ANCHOR_OFFSET - menuRect.width;
  }

  if (top + menuRect.height > viewportHeight - VIEWPORT_MARGIN) {
    top = clientY - ANCHOR_OFFSET - menuRect.height;
  }

  if (left < VIEWPORT_MARGIN) {
    left = VIEWPORT_MARGIN;
  }

  if (top < VIEWPORT_MARGIN) {
    top = VIEWPORT_MARGIN;
  }

  menu.style.left = left + "px";
  menu.style.top = top + "px";
}
