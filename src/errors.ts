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
  }
  throw e;
}
