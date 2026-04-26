export const TIMEOUTS = {
  DEFAULT: 5000,
  GIT_FETCH: 60000,
  ANNOTATE: 60000,
  UPDATE_STALE: 30000,
  SQUASH_TOOL: 10000,
  FALLBACK: 30000,
  REPO_WATCHER_DEBOUNCE: 500,
} as const;

export const MINIMUM_JJ_VERSION = { major: 0, minor: 38, patch: 0 } as const;

// Also update the default for jjx.logLimit in package.json when changing this value.
export const DEFAULT_LOG_LIMIT = 500 as const;
