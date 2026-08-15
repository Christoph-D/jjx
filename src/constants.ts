export const TIMEOUTS = {
  DEFAULT: 5000,
  GIT_FETCH: 60000,
  ANNOTATE: 60000,
  UPDATE_STALE: 30000,
  SQUASH_TOOL: 10000,
  DIFF_TOOL: 20000,
  FALLBACK: 30000,
  REPO_WATCHER_DEBOUNCE: 500,
} as const;

export const MINIMUM_JJ_VERSION = { major: 0, minor: 38, patch: 0 } as const;

/** Parsed semantic version of the detected jj binary. */
export interface JJVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Returns true if `v` is greater than or equal to `target`.
 * Both arguments are assumed to be non-negative integers.
 */
export function versionAtLeast(v: JJVersion, target: JJVersion): boolean {
  if (v.major !== target.major) {
    return v.major > target.major;
  }
  if (v.minor !== target.minor) {
    return v.minor > target.minor;
  }
  return v.patch >= target.patch;
}

/**
 * jj 0.41 deprecated `operation.tags()` in favor of `operation.attributes()`.
 */
export const JJ_VERSION_WITH_OPERATION_ATTRIBUTES: JJVersion = { major: 0, minor: 41, patch: 0 };

/**
 * jj 0.44 introduced tag tracking on remotes (`jj tag track`/`jj tag untrack`),
 * mirroring bookmark tracking.
 */
export const JJ_VERSION_WITH_TAG_TRACKING: JJVersion = { major: 0, minor: 44, patch: 0 };

// Backoff before reconciling divergent operation heads. The randomized delay breaks the phase-lock
// between multiple jjx instances sharing one repository (e.g. over a network/shared filesystem),
// so their reconciliations cannot sustain a cascade.
export const DIVERGENCE_BACKOFF = {
  BASE_MS: 250,
  CAP_MS: 5000,
  MAX_RETRIES: 5,
} as const;

// Also update the default for jjx.logLimit in package.json when changing this value.
export const DEFAULT_LOG_LIMIT = 500 as const;
