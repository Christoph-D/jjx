import { useEffect, useRef, useCallback } from "preact/hooks";
import { tooltip, tooltipHideTimeout, diffStatsCache } from "../signals";
import { escapeHtml } from "../utils";

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
    el.style.left = "-9999px";
    el.style.top = "-9999px";

    requestAnimationFrame(() => {
      const tooltipRect = el.getBoundingClientRect();
      const scrollX = window.scrollX || window.pageXOffset;
      const scrollY = window.scrollY || window.pageYOffset;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      const offset = 15;
      let left = state.pageX + offset;
      let top = state.pageY + offset;

      if (left + tooltipRect.width > viewportWidth + scrollX - 10) {
        left = state.pageX - tooltipRect.width - offset;
      }

      if (top + tooltipRect.height > viewportHeight + scrollY - 10) {
        top = state.pageY - tooltipRect.height - offset;
      }

      if (top < scrollY + 10) {
        top = scrollY + 10;
      }

      if (left < scrollX + 10) {
        left = scrollX + 10;
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
          {change.authorName && (
            <span class="tooltip-author">
              {change.authorName}
              {change.authorEmail && <span class="tooltip-email"> {change.authorEmail}</span>}
            </span>
          )}
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
              {escapeHtml(b.name)}
            </span>
          ))}
          {change.remoteBookmarks.map((b) => (
            <span class="tooltip-pill tooltip-bookmark-pill">
              {escapeHtml(b.name)}@{escapeHtml(b.remote)}
            </span>
          ))}
          {change.localTags.map((t) => (
            <span class={"tooltip-pill tooltip-tag-pill" + (t.conflict ? " conflicted" : t.synced ? "" : " unsynced")}>
              {escapeHtml(t.name)}
            </span>
          ))}
          {change.remoteTags.map((t) => (
            <span class="tooltip-pill tooltip-tag-pill">
              {escapeHtml(t.name)}@{escapeHtml(t.remote)}
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
      {change.fullDescription && <div class="tooltip-description">{escapeHtml(change.fullDescription)}</div>}
    </div>
  );
}
