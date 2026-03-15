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

/**
 * Detects common error messages from jj and converts them to custom error instances to make them easier to selectively
 * handle.
 */
export function convertJJErrors(e: unknown): never {
  if (e instanceof Error) {
    if (e.message.includes("is immutable")) {
      throw new ImmutableError(e.message);
    }
    if (e.message.includes("Refusing to move bookmark backwards")) {
      throw new BookmarkBackwardsError(e.message);
    }
    if (e.message.includes("working copy is stale")) {
      throw new StaleWorkingCopyError(e.message);
    }
  }
  throw e;
}
