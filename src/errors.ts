import type { ProcessError } from "./process";

export class ImmutableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImmutableError";
  }
}

export class BookmarkBackwardsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookmarkBackwardsError";
  }
}

export class StaleWorkingCopyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleWorkingCopyError";
  }
}

export class DivergentOperationsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DivergentOperationsError";
  }
}

export function parseJJError(error: unknown): Error {
  if (error instanceof Error) {
    const match = error.message.match(/error:\s*([\s\S]+)$/i);
    if (match) {
      return new Error(match[1].trim());
    }
    return error;
  }
  return new Error(String(error));
}

/**
 * Warnings worth surfacing to the user.
 */
const SURFACED_WARNING_PREFIXES = ["Warning: Failed to export some bookmarks", "Warning: Failed to export some tags"];

/**
 * Extracts the bookmark/tag export-failure warnings jj printed on stderr, or undefined if there are
 * none.
 */
export function extractJJWarning(stderr: string): string | undefined {
  const trimmed = stderr.trim();
  if (!trimmed) {
    return undefined;
  }
  const blocks: string[] = [];
  for (const line of trimmed.split("\n")) {
    if (line.startsWith("Warning:")) {
      blocks.push(line);
    } else if (blocks.length > 0) {
      blocks[blocks.length - 1] += "\n" + line;
    }
  }
  const relevant = blocks.filter((block) => SURFACED_WARNING_PREFIXES.some((prefix) => block.startsWith(prefix)));
  return relevant.length > 0 ? relevant.join("\n") : undefined;
}

/**
 * Detects common error messages from jj and converts them to custom error instances to make them easier to selectively
 * handle.
 */
export function convertJJErrors(e: unknown): never {
  if (e instanceof Error) {
    const stderr = (e as ProcessError).stderr;
    const text = typeof stderr === "string" ? stderr : e.message;
    if (text.includes("is immutable")) {
      throw new ImmutableError(e.message);
    }
    if (text.includes("Refusing to move bookmark backwards")) {
      throw new BookmarkBackwardsError(e.message);
    }
    if (text.includes("working copy is stale")) {
      throw new StaleWorkingCopyError(e.message);
    }
    if (text.includes("resolved to more than one operation")) {
      throw new DivergentOperationsError(e.message);
    }
  }
  throw e;
}
