import { useEffect, useRef, useCallback } from "preact/hooks";
import { tooltip, diffStatsCache } from "../signals";
import { useTooltipTimers } from "../hooks/use-tooltip-timers";
import { CHANGE_ID_RIGHT_PADDING } from "../types";
import { cx } from "../utils";
import pillStyles from "./pill.module.css";
import styles from "./tooltip.module.css";

export function Tooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const state = tooltip.value;
  const { clearHideTimer } = useTooltipTimers();

  const handleMouseEnter = useCallback(() => {
    clearHideTimer();
  }, []);

  const handleMouseLeave = useCallback(() => {
    tooltip.value = null;
  }, []);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
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

      const maxAllowedWidth = Math.floor(viewportWidth * 0.35);
      el.style.maxWidth = maxAllowedWidth + "px";

      const tooltipRect = el.getBoundingClientRect();
      const offset = 15;

      const changeIdEl = document.querySelector(
        `#nodes > [data-change-id="${state.change.changeId}"] [data-role="change-id"]`,
      );
      const minLeft = changeIdEl ? changeIdEl.getBoundingClientRect().right + CHANGE_ID_RIGHT_PADDING : 10;

      let left;
      if (state.pageX < viewportWidth * 0.6) {
        left = viewportWidth - tooltipRect.width - 10;
      } else {
        left = minLeft;
      }

      let top = state.pageY + offset;

      if (top + tooltipRect.height > viewportHeight + scrollY - 10) {
        top = state.pageY - tooltipRect.height - offset;
      }

      if (top < scrollY + 10) {
        top = scrollY + 10;
      }

      el.style.left = left + "px";
      el.style.top = top + "px";
    });
  }, [state]);

  if (!state) {
    return (
      <div
        id="tooltip"
        class={styles.tooltip}
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
      class={styles.tooltip}
      ref={ref}
      style="display: none"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {(change.authorName || change.authorEmail || change.authorTimestamp) && (
        <div class={styles.tooltipHeader}>
          {change.authorName && <div class={styles.tooltipAuthor}>{change.authorName}</div>}
          {change.authorEmail && <div class={styles.tooltipEmail}>{change.authorEmail}</div>}
        </div>
      )}
      {change.authorTimestamp && <div class={styles.tooltipTimestamp}>{change.authorTimestamp}</div>}
      {(() => {
        const localBookmarkNames = new Set(change.localBookmarks.map((b) => b.name));
        const localTagNames = new Set(change.localTags.map((t) => t.name));
        const filteredRemoteBookmarks = change.remoteBookmarks.filter(
          (b) => !(b.remote === "git" && localBookmarkNames.has(b.name)),
        );
        const filteredRemoteTags = change.remoteTags.filter((t) => !(t.remote === "git" && localTagNames.has(t.name)));
        return change.localBookmarks.length > 0 ||
          filteredRemoteBookmarks.length > 0 ||
          change.localTags.length > 0 ||
          filteredRemoteTags.length > 0 ? (
          <div class={styles.tooltipPills}>
            {change.localBookmarks.map((b) => (
              <span
                key={b.name}
                class={cx(
                  pillStyles.bookmarkPill,
                  b.conflict ? pillStyles.conflicted : !b.synced && pillStyles.unsynced,
                )}
              >
                {b.name}
              </span>
            ))}
            {filteredRemoteBookmarks.map((b) => (
              <span key={b.name + "@" + b.remote} class={pillStyles.bookmarkPill}>
                {b.name}@{b.remote}
              </span>
            ))}
            {change.localTags.map((t) => (
              <span
                key={t.name}
                class={cx(pillStyles.tagPill, t.conflict ? pillStyles.conflicted : !t.synced && pillStyles.unsynced)}
              >
                {t.name}
              </span>
            ))}
            {filteredRemoteTags.map((t) => (
              <span key={t.name + "@" + t.remote} class={pillStyles.tagPill}>
                {t.name}@{t.remote}
              </span>
            ))}
          </div>
        ) : null;
      })()}
      {stats ? (
        <div class={styles.tooltipSummary}>
          {stats.filesChanged} file{stats.filesChanged !== 1 ? "s" : ""} changed,{" "}
          <span class={styles.tooltipAdded}>+{stats.linesAdded}</span>{" "}
          <span class={styles.tooltipRemoved}>-{stats.linesRemoved}</span>
        </div>
      ) : (
        <div class={styles.tooltipSummary}>Loading...</div>
      )}
      {change.fullDescription && <div class={styles.tooltipDescription}>{change.fullDescription}</div>}
    </div>
  );
}
