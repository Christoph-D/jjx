import { useEffect, useRef, useCallback } from "preact/hooks";
import { tooltip, tooltipHideTimeout, diffStatsCache } from "../signals";
import { CHANGE_ID_RIGHT_PADDING } from "../types";

export function Tooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const state = tooltip.value;

  const handleMouseEnter = useCallback(() => {
    if (tooltipHideTimeout.value) {
      clearTimeout(tooltipHideTimeout.value);
      tooltipHideTimeout.value = null;
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    tooltip.value = null;
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    if (!state) {
      ref.current.style.display = "none";
      return;
    }

    const el = ref.current;
    el.style.display = "block";
    el.style.maxWidth = "";
    el.style.left = "-9999px";
    el.style.top = "-9999px";

    requestAnimationFrame(() => {
      const scrollY = window.scrollY || window.pageYOffset;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const changeIdEl = document.querySelector(
        `.change-node[data-change-id="${state.change.changeId}"] .change-id-left`,
      );
      const minLeft = changeIdEl ? changeIdEl.getBoundingClientRect().right + CHANGE_ID_RIGHT_PADDING : 10;
      const maxAllowedWidth = viewportWidth - 100 - minLeft;

      if (maxAllowedWidth > 0) {
        el.style.maxWidth = maxAllowedWidth + "px";
      }

      const tooltipRect = el.getBoundingClientRect();
      const offset = 15;
      let left = state.pageX + offset;
      let top = state.pageY + offset;

      if (left + tooltipRect.width > viewportWidth - 10) {
        left = state.pageX - tooltipRect.width - offset;
      }

      if (top + tooltipRect.height > viewportHeight + scrollY - 10) {
        top = state.pageY - tooltipRect.height - offset;
      }

      if (top < scrollY + 10) {
        top = scrollY + 10;
      }

      if (left < 10) {
        left = 10;
      }

      if (left < minLeft) {
        left = minLeft;
      }

      el.style.left = left + "px";
      el.style.top = top + "px";
    });
  }, [state]);

  if (!state) {
    return (
      <div
        id="tooltip"
        class="tooltip"
        ref={ref}
        style="display: none"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      ></div>
    );
  }

  const { change } = state;
  const stats = diffStatsCache.value.get(change.changeId);

  return (
    <div
      id="tooltip"
      class="tooltip"
      ref={ref}
      style="display: none"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {(change.authorName || change.authorEmail || change.authorTimestamp) && (
        <div class="tooltip-header">
          {change.authorName && <div class="tooltip-author">{change.authorName}</div>}
          {change.authorEmail && <div class="tooltip-email">{change.authorEmail}</div>}
        </div>
      )}
      {change.authorTimestamp && <div class="tooltip-timestamp">{change.authorTimestamp}</div>}
      {(change.localBookmarks.length > 0 ||
        change.remoteBookmarks.length > 0 ||
        change.localTags.length > 0 ||
        change.remoteTags.length > 0) && (
        <div class="tooltip-pills">
          {change.localBookmarks.map((b) => (
            <span
              class={"tooltip-pill tooltip-bookmark-pill" + (b.conflict ? " conflicted" : b.synced ? "" : " unsynced")}
            >
              {b.name}
            </span>
          ))}
          {change.remoteBookmarks.map((b) => (
            <span class="tooltip-pill tooltip-bookmark-pill">
              {b.name}@{b.remote}
            </span>
          ))}
          {change.localTags.map((t) => (
            <span class={"tooltip-pill tooltip-tag-pill" + (t.conflict ? " conflicted" : t.synced ? "" : " unsynced")}>
              {t.name}
            </span>
          ))}
          {change.remoteTags.map((t) => (
            <span class="tooltip-pill tooltip-tag-pill">
              {t.name}@{t.remote}
            </span>
          ))}
        </div>
      )}
      {stats ? (
        <div class="tooltip-summary">
          {stats.filesChanged} file{stats.filesChanged !== 1 ? "s" : ""} changed,{" "}
          <span class="tooltip-added">+{stats.linesAdded}</span>{" "}
          <span class="tooltip-removed">-{stats.linesRemoved}</span>
        </div>
      ) : (
        <div class="tooltip-summary">Loading...</div>
      )}
      {change.fullDescription && <div class="tooltip-description">{change.fullDescription}</div>}
    </div>
  );
}
