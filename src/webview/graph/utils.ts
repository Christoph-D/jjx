export function abbreviateName(name: string, maxLength = 20): string {
  if (name.length <= maxLength) {
    return name;
  }
  const prefixLength = Math.ceil((maxLength - 3) / 2);
  const suffixLength = Math.floor((maxLength - 3) / 2);
  return name.substring(0, prefixLength) + "..." + name.substring(name.length - suffixLength);
}

export function cleanupSeparators(menu: Element) {
  const items = Array.from(menu.children);
  const visibleItems = items.filter((item) => (item as HTMLElement).style.display !== "none");

  visibleItems.forEach((item, index) => {
    if (!item.classList.contains("context-menu-separator")) {
      return;
    }

    if (index === 0) {
      (item as HTMLElement).style.display = "none";
      return;
    }

    if (index === visibleItems.length - 1) {
      (item as HTMLElement).style.display = "none";
      return;
    }

    const prevItem = visibleItems[index - 1];
    if (prevItem.classList.contains("context-menu-separator")) {
      (item as HTMLElement).style.display = "none";
    }
  });
}
