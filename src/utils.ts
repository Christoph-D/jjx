import { basename, isAbsolute, join, relative, sep } from "path";

import type { ChangeId, FileStatusType, FullChangeId } from "./types";

export function fullChangeIdFromString(value: string): FullChangeId {
  return value as FullChangeId;
}

export function fullChangeId(changeId: string, changeOffset: string): FullChangeId {
  return fullChangeIdFromString(changeOffset ? `${changeId}/${changeOffset}` : changeId);
}

export function escapeTomlString(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")
    .replaceAll("\b", "\\b")
    .replaceAll("\f", "\\f");
}

export function filepathToFileset(filepath: string): string {
  const escaped = filepath.replaceAll(/\\/g, "\\\\").replaceAll(/"/g, '\\"');
  return `file:"${escaped}"`;
}

/**
 * Like {@link filepathToFileset}, but emits a workspace-relative path-prefix
 * fileset (`root:"..."`) that matches the given path whether it is a single
 * file or a directory (recursing into the directory's contents). The
 * exact-match `file:"..."` form produced by {@link filepathToFileset} does not
 * match files inside a directory, so `jj file track` silently no-ops when given
 * an untracked directory.
 */
export function filepathToRootFileset(filepath: string): string {
  const escaped = filepath.replaceAll(/\\/g, "\\\\").replaceAll(/"/g, '\\"');
  return `root:"${escaped}"`;
}

export function formatDiffTitle(
  renamedFrom: string | undefined,
  baseName: string,
  from: string | undefined,
  to: string,
  mode: "diff" | "interdiff" = "diff",
): string {
  const label = mode === "interdiff" ? "Interdiff " : "";
  const fromName = renamedFrom ? basename(renamedFrom) : undefined;
  const diffPart = from === undefined ? `${label}Parent → ${to}` : `${label}${from} → ${to}`;
  return (fromName ? `${fromName} → ` : "") + `${baseName} (${diffPart})`;
}

/**
 * Decides whether a diff opened for a file in commit `changeId` can use the real (editable)
 * working-copy file as its right side: the clicked commit must not be the working copy itself,
 * the file must not be deleted in it, and the working copy must not change the file relative
 * to the commit, so the working-copy content is identical to the commit's version.
 */
export function shouldOpenWorkingCopyRightSide(
  changeId: FullChangeId | "@",
  status: FileStatusType | undefined,
  fileUnchangedInWorkingCopy: boolean,
): boolean {
  return changeId !== "@" && status !== "D" && fileUnchangedInWorkingCopy;
}

export function formatAtRevTitle(baseName: string, rev: string): string {
  return `${baseName} (${rev})`;
}

export function formatChangeIdShort(changeId: ChangeId): string {
  const short = changeId.changeIdPrefix + changeId.changeIdSuffix;
  return changeId.changeOffset ? `${short}/${changeId.changeOffset}` : short;
}

/**
 * Like {@link formatChangeIdShort}, but prints `/?` in place of the offset. Used when a change was
 * matched by change ID alone (e.g. because the commit ID in the conflict markers is stale), so the
 * matched node may be at the wrong commit/offset.
 */
export function formatChangeIdShortWithUnknownOffset(changeId: ChangeId): string {
  return `${changeId.changeIdPrefix}${changeId.changeIdSuffix}/?`;
}

// A readable label for the SCM view.
export function formatWorkingCopyLabel(): string {
  return "Working Copy";
}

// Short label for editor window titles which are more space-constrained.
export function formatWorkingCopyTitle(): string {
  return "@";
}

export function maxChangeIdPrefixLength(changeIdShortests: string[]): number {
  return Math.max(4, ...changeIdShortests.map((s) => s.length));
}

export function changeIdAffixes(
  changeId: string,
  changeIdShortest: string,
  maxPrefixLength: number,
): { changeIdPrefix: string; changeIdSuffix: string } {
  return {
    changeIdPrefix: changeIdShortest,
    changeIdSuffix: changeId
      .slice(changeIdShortest.length)
      .substring(0, Math.max(0, maxPrefixLength - changeIdShortest.length)),
  };
}

export function changeIdFromLogEntry(
  entry: { change_id: string; change_id_shortest: string; change_offset: string; divergent: boolean },
  maxPrefixLength: number,
): ChangeId {
  return {
    changeId: fullChangeId(entry.change_id, entry.change_offset),
    ...changeIdAffixes(entry.change_id, entry.change_id_shortest, maxPrefixLength),
    changeOffset: entry.divergent ? entry.change_offset || null : null,
  };
}

const isMacintosh = process.platform === "darwin";
export const isWindows = process.platform === "win32";

export function normalizePath(path: string): string {
  // Windows & Mac are currently being handled
  // as case insensitive file systems in VS Code.
  if (isWindows || isMacintosh) {
    return path.toLowerCase();
  }

  return path;
}

export function isDescendant(parent: string, descendant: string): boolean {
  if (parent === descendant) {
    return true;
  }

  if (parent.charAt(parent.length - 1) !== sep) {
    parent += sep;
  }

  return normalizePath(descendant).startsWith(normalizePath(parent));
}

export function pathEquals(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

export interface PathSpellingMapping {
  from: string;
  to: string;
}

/**
 * Re-spells `fsPath` from the `from` side to the `to` side of the first mapping whose `from`
 * side contains it. Used to translate between the path spelling VS Code shows for a workspace
 * folder (which keeps symlinks, e.g. /var/folders on macOS) and its resolved `realpath`
 * spelling (which jj reports). Returns undefined when no mapping contains the path.
 */
export function remapPathSpelling(fsPath: string, mappings: PathSpellingMapping[]): string | undefined {
  for (const { from, to } of mappings) {
    if (!isDescendant(from, fsPath)) {
      continue;
    }
    const relativePath = relative(from, fsPath);
    // On case-insensitive file systems the spellings can differ in case only, which makes the
    // string-based relative path escape the prefix. Leave such paths alone.
    if (relativePath.split(sep)[0] === ".." || isAbsolute(relativePath)) {
      continue;
    }
    return join(to, relativePath);
  }
  return undefined;
}

/**
 * Decodes file content as UTF-8 text, ready for line-based diffing. Returns
 * undefined when the content looks binary: a NUL byte anywhere or byte
 * sequences that are not valid UTF-8.
 */
export function decodeFileText(content: Buffer): string | undefined {
  if (content.includes(0)) {
    return undefined;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    return undefined;
  }
}

/**
 * Creates a throttled version of an async function that ensures the underlying
 * function (`fn`) is called at most once concurrently.
 *
 * If the throttled function is called while `fn` is already running:
 * - It schedules `fn` to run again immediately after the current run finishes.
 * - Only one run can be scheduled this way.
 * - If called multiple times while a run is active and another is scheduled,
 *   the arguments for the scheduled run are updated to the latest arguments provided.
 * - The promise returned by calls made while active/scheduled will resolve or
 *   reject with the result of the *next* scheduled run.
 *
 * @template T The return type of the async function's Promise.
 * @template A The argument types of the async function.
 * @param fn The async function to throttle.
 * @returns A new function that throttles calls to `fn`.
 */
export function createThrottledAsyncFn<T, A extends unknown[]>(
  fn: (...args: A) => Promise<T>,
): (...args: A) => Promise<T> {
  enum State {
    Idle,
    Running,
    Queued,
  }
  let state = State.Idle;
  let queuedArgs: A | null = null;
  // Promise returned to callers who triggered the queued run
  let queuedRunPromise: Promise<T> | null = null;
  let queuedRunResolver: ((value: T) => void) | null = null;
  let queuedRunRejector: Parameters<ConstructorParameters<typeof Promise>["0"]>["1"] | null = null;

  const throttledFn = (...args: A): Promise<T> => {
    queuedArgs = args; // Always store the latest args for a potential queued run

    if (state === State.Running || state === State.Queued) {
      // If already running or queued, ensure we are in Queued state
      // and return the promise for the queued run.
      if (state !== State.Queued) {
        state = State.Queued;
        queuedRunPromise = new Promise<T>((resolve, reject) => {
          queuedRunResolver = resolve;
          queuedRunRejector = reject;
        });
      }
      // This assertion is safe because we ensure queuedRunPromise is set when state becomes Queued.
      return queuedRunPromise!;
    }

    // State is Idle, transition to Running
    state = State.Running;
    // Execute with current args. Capture the promise for this specific run.
    const runPromise = fn(...args);

    // Set up the logic to handle completion of the current run
    runPromise.then(
      (_result) => {
        // --- Success path ---
        if (state === State.Queued) {
          // A run was queued while this one was running.
          const resolver = queuedRunResolver!;
          const rejector = queuedRunRejector!;
          const nextArgs = queuedArgs!; // Use the last stored args

          // Reset queue state *before* starting the next run
          queuedRunPromise = null;
          queuedRunResolver = null;
          queuedRunRejector = null;
          queuedArgs = null;
          state = State.Idle; // Temporarily Idle, the recursive call below will set it back to Running

          // Start the next run recursively.
          // Link its result back to the promise we returned to the queued caller(s).
          throttledFn(...nextArgs).then(resolver, rejector);
        } else {
          // No run was queued, simply return to Idle state.
          state = State.Idle;
        }
        // Note: We don't return the result here; the original runPromise already holds it.
      },
      (error) => {
        // --- Error path ---
        if (state === State.Queued) {
          // A run was queued, but the current one failed.
          // Reject the promise that was returned to the queued caller(s).
          const rejector = queuedRunRejector!;

          // Reset queue state
          queuedRunPromise = null;
          queuedRunResolver = null;
          queuedRunRejector = null;
          queuedArgs = null;
          state = State.Idle;

          rejector(error); // Reject the queued promise
        } else {
          // No run was queued, simply return to Idle state.
          state = State.Idle;
        }
        // Note: We don't re-throw the error here; the original runPromise already handles rejection.
      },
    );

    // Return the promise for the *current* execution immediately.
    return runPromise;
  };

  return throttledFn;
}
