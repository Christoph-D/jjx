import { Uri } from "vscode";

export type JJUriParams = { rev: string } | { diffOriginalRev: string; renamedFrom?: string } | { deleted: boolean };

function isJJUriParams(v: unknown): v is JJUriParams {
  if (typeof v !== "object" || v === null) {
    return false;
  }
  const o = v as Record<string, unknown>;
  if (typeof o.rev === "string") {
    return true;
  }
  if (typeof o.deleted === "boolean") {
    return true;
  }
  if (typeof o.diffOriginalRev === "string") {
    return o.renamedFrom === undefined || typeof o.renamedFrom === "string";
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
