import { Uri } from "vscode";
import type { ChangeId } from "./types";

export type JJUriParams =
  | { rev: string }
  | { diffOriginalRev: string; renamedFrom?: string }
  | { deleted: boolean }
  | { interdiffFrom: ChangeId; interdiffTo: ChangeId; side: "left" | "right" }
  | { diffFrom: ChangeId; diffTo: ChangeId; side: "left" | "right" };

function isChangeId(v: unknown): v is ChangeId {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const o = v as Record<string, unknown>;
  return (
    typeof o.changeId === "string" &&
    typeof o.changeIdPrefix === "string" &&
    typeof o.changeIdSuffix === "string" &&
    (o.changeOffset === null || typeof o.changeOffset === "string")
  );
}

function isJJUriParams(v: unknown): v is JJUriParams {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  const has = (k: string): boolean => k in o;

  // Each variant is matched by exactly its own (exhaustive) set of keys, so
  // mixed shapes and objects carrying extra/bogus fields are rejected.
  if (keys.length === 1 && has("rev")) {
    return typeof o.rev === "string";
  }
  if (keys.length === 1 && has("deleted")) {
    return typeof o.deleted === "boolean";
  }
  if (keys.length === 1 && has("diffOriginalRev")) {
    return typeof o.diffOriginalRev === "string";
  }
  if (keys.length === 2 && has("diffOriginalRev") && has("renamedFrom")) {
    return typeof o.diffOriginalRev === "string" && typeof o.renamedFrom === "string";
  }
  if (keys.length === 3 && has("interdiffFrom") && has("interdiffTo") && has("side")) {
    return isChangeId(o.interdiffFrom) && isChangeId(o.interdiffTo) && (o.side === "left" || o.side === "right");
  }
  if (keys.length === 3 && has("diffFrom") && has("diffTo") && has("side")) {
    return isChangeId(o.diffFrom) && isChangeId(o.diffTo) && (o.side === "left" || o.side === "right");
  }
  return false;
}

/**
 * Use this for any URI that will go to JJFileSystemProvider.
 */
export function toJJUri(uri: Uri, params: JJUriParams): Uri {
  return uri.with({
    scheme: "jj",
    query: JSON.stringify(params),
  });
}

export function getParams(uri: Uri): JJUriParams {
  if (uri.query === "") {
    throw new Error("URI has no query");
  }
  const parsed: unknown = JSON.parse(uri.query);
  if (!isJJUriParams(parsed)) {
    throw new Error("URI query is not JJUriParams");
  }
  return parsed;
}

export function resolveRev(
  uri: Uri,
  options?: {
    diffOriginalRevBehavior?: "passthrough" | "suffix" | "exclude";
    excludeSpecial?: boolean;
  },
): string | undefined {
  if (uri.scheme === "file") {
    return "@";
  }

  if (uri.scheme !== "jj") {
    return undefined;
  }

  const params = getParams(uri);

  if (options?.excludeSpecial && "deleted" in params) {
    return undefined;
  }

  if ("diffOriginalRev" in params) {
    const behavior = options?.diffOriginalRevBehavior ?? "passthrough";
    if (behavior === "exclude") {
      return undefined;
    }
    if (behavior === "suffix") {
      return `${params.diffOriginalRev}-`;
    }
    return params.diffOriginalRev;
  }

  if ("rev" in params) {
    return params.rev;
  }

  return undefined;
}

/**
 * Returns true for URIs that represent one side of a two-revision comparison —
 * either an interdiff (`jj interdiff --from --to`) or a regular from/to diff
 * (`jj diff --from --to`). Such editors can't be toggled to a single-revision view.
 */
export function isComparisonDiffUri(uri: Uri): boolean {
  if (uri.scheme !== "jj" || uri.query === "") {
    return false;
  }
  try {
    const params = getParams(uri);
    return "interdiffFrom" in params || "diffFrom" in params;
  } catch {
    return false;
  }
}

/**
 * Returns true when the URI is the empty "deleted" resource used for the side
 * of a diff whose file was removed.
 */
export function isDeletedDiffUri(uri: Uri): boolean {
  if (uri.scheme !== "jj" || uri.query === "") {
    return false;
  }
  try {
    const params = getParams(uri);
    return "deleted" in params;
  } catch {
    return false;
  }
}
