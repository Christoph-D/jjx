import {
  tooltipTimeout,
  tooltipHideTimeout,
  diffStatsPrefetchTimeout,
  tooltip,
  vscode,
  diffStatsCache,
} from "../signals";
import type { ChangeNode } from "../../../graph-protocol";

const TOOLTIP_DELAY_MS = 300;
const TOOLTIP_HIDE_DELAY_MS = 100;
const DIFF_STATS_PREFETCH_DELAY_MS = 100;

export function useTooltipTimers() {
  const startHoverTimers = (change: ChangeNode, pageX: number, pageY: number) => {
    if (!diffStatsCache.value.has(change.changeId)) {
      diffStatsPrefetchTimeout.value = setTimeout(() => {
        vscode.postMessage({ command: "fetchDiffStats", changeId: change.changeId });
      }, DIFF_STATS_PREFETCH_DELAY_MS);
    }
    tooltipTimeout.value = setTimeout(() => {
      tooltip.value = { change, pageX, pageY };
    }, TOOLTIP_DELAY_MS);
  };

  const clearHoverTimers = () => {
    if (diffStatsPrefetchTimeout.value) {
      clearTimeout(diffStatsPrefetchTimeout.value);
      diffStatsPrefetchTimeout.value = null;
    }
    if (tooltipTimeout.value) {
      clearTimeout(tooltipTimeout.value);
      tooltipTimeout.value = null;
    }
  };

  const clearHideTimer = () => {
    if (tooltipHideTimeout.value) {
      clearTimeout(tooltipHideTimeout.value);
      tooltipHideTimeout.value = null;
    }
  };

  const clearAllTimers = () => {
    clearHoverTimers();
    clearHideTimer();
  };

  const scheduleHideTooltip = () => {
    tooltipHideTimeout.value = setTimeout(() => {
      tooltip.value = null;
    }, TOOLTIP_HIDE_DELAY_MS);
  };

  return {
    startHoverTimers,
    clearHoverTimers,
    clearHideTimer,
    clearAllTimers,
    scheduleHideTooltip,
  };
}
