import { FileDecorationProvider, FileDecoration, Uri, EventEmitter, Event, ThemeColor } from "vscode";
import { FileStatus, FileStatusType } from "./types";
import { resolveRev, toJJUri, getParams, type JJUriParams } from "./uri";
import { changeIdFromString, normalizePath } from "./utils";

export function interdiffKey(from: string, to: string): string {
  return `interdiff:${from}..${to}`;
}

export function diffKey(from: string, to: string): string {
  return `diff:${from}..${to}`;
}

const colorOfType = (type: FileStatusType) => {
  switch (type) {
    case "A":
      return new ThemeColor("jjDecoration.addedResourceForeground");
    case "M":
      return new ThemeColor("jjDecoration.modifiedResourceForeground");
    case "D":
      return new ThemeColor("jjDecoration.deletedResourceForeground");
    case "R":
      return new ThemeColor("jjDecoration.renamedResourceForeground");
    case "C":
      return new ThemeColor("jjDecoration.addedResourceForeground");
    case "X":
      return new ThemeColor("jjDecoration.conflictingResourceForeground");
    case "?":
      return new ThemeColor("jjDecoration.untrackedResourceForeground");
  }
};

export class JJDecorationProvider implements FileDecorationProvider {
  private readonly _onDidChangeDecorations = new EventEmitter<Uri[]>();
  readonly onDidChangeFileDecorations: Event<Uri[]> = this._onDidChangeDecorations.event;
  private decorations = new Map<string, FileDecoration>();
  private trackedFiles = new Set<string>();
  private decorationKeysByRepository = new Map<string, Set<string>>();
  private trackedFilesByRepository = new Map<string, Set<string>>();
  private hasData = false;

  /**
   * @param register Function that will register this provider with vscode.
   * This will be called lazily once the provider has data to show.
   */
  constructor(private register: (provider: JJDecorationProvider) => void) {}

  /**
   * Updates the internal state of the provider with new decorations. If
   * being called for the first time, registers the provider with vscode.
   * Otherwise, fires an event to notify vscode of the updated decorations.
   */
  onRefresh(
    repositoryRoot: string,
    fileStatusesByChange: Map<string, FileStatus[]>,
    trackedFiles: Set<string>,
    conflictedFiles: Map<string, Set<string>>,
    untrackedFiles: FileStatus[],
  ) {
    if (process.platform === "win32") {
      trackedFiles = convertSetToLowercase(trackedFiles);
    }

    const repositoryKey = normalizePath(repositoryRoot);

    const oldKeys = this.decorationKeysByRepository.get(repositoryKey);
    const oldBadges = new Map<string, string>();
    if (oldKeys) {
      for (const key of oldKeys) {
        const decoration = this.decorations.get(key);
        if (decoration) {
          oldBadges.set(key, decoration.badge as string);
        }
        this.decorations.delete(key);
      }
    }

    const newKeys = new Set<string>();
    for (const [changeId, fileStatuses] of fileStatusesByChange) {
      for (const fileStatus of fileStatuses) {
        const key = getKey(Uri.file(fileStatus.path).fsPath, changeId);
        newKeys.add(key);
        this.decorations.set(key, {
          badge: fileStatus.type,
          tooltip: fileStatus.file,
          color: colorOfType(fileStatus.type),
        });
      }
    }
    for (const [changeId, files] of conflictedFiles) {
      for (const file of files) {
        const key = getKey(Uri.file(file).fsPath, changeId);
        const existingDecoration = this.decorations.get(key);
        if (!existingDecoration) {
          newKeys.add(key);
          this.decorations.set(key, {
            badge: "!",
            color: new ThemeColor("jjDecoration.conflictingResourceForeground"),
          });
        } else {
          this.decorations.set(key, {
            ...existingDecoration,
            badge: `${existingDecoration.badge}!`,
            color: new ThemeColor("jjDecoration.conflictingResourceForeground"),
          });
        }
      }
    }

    for (const fileStatus of untrackedFiles) {
      const key = getKey(Uri.file(fileStatus.path).fsPath, "@");
      newKeys.add(key);
      this.decorations.set(key, {
        badge: fileStatus.type,
        tooltip: fileStatus.file,
        color: colorOfType(fileStatus.type),
      });
    }

    this.decorationKeysByRepository.set(repositoryKey, newKeys);
    const changedTrackedFiles = this.updateTrackedFiles(repositoryKey, trackedFiles);

    if (!this.hasData) {
      this.hasData = true;
      this.register(this);
      return;
    }

    const changedKeys = new Set<string>();
    if (oldKeys) {
      for (const key of oldKeys) {
        if (!newKeys.has(key)) {
          changedKeys.add(key);
        }
      }
    }
    for (const key of newKeys) {
      const newBadge = this.decorations.get(key)!.badge as string;
      const prevBadge = oldBadges.get(key);
      if (prevBadge === undefined || prevBadge !== newBadge) {
        changedKeys.add(key);
      }
    }

    if (changedKeys.size > 0 || changedTrackedFiles.size > 0) {
      this.fireChanged(changedKeys, changedTrackedFiles);
    }
  }

  removeStaleRepositories(repositoryRoots: Iterable<string>) {
    const activeRepositoryKeys = new Set([...repositoryRoots].map(normalizePath));
    const changedKeys = new Set<string>();
    const changedTrackedFiles = new Set<string>();

    for (const repoKey of [...this.decorationKeysByRepository.keys()]) {
      if (activeRepositoryKeys.has(repoKey)) {
        continue;
      }

      const keys = this.decorationKeysByRepository.get(repoKey)!;
      for (const key of keys) {
        this.decorations.delete(key);
        changedKeys.add(key);
      }
      this.decorationKeysByRepository.delete(repoKey);

      const tracked = this.trackedFilesByRepository.get(repoKey);
      if (tracked) {
        for (const file of tracked) {
          if (!this.isTrackedElsewhere(repoKey, file)) {
            this.trackedFiles.delete(file);
            changedTrackedFiles.add(file);
          }
        }
        this.trackedFilesByRepository.delete(repoKey);
      }
    }

    if (changedKeys.size > 0 || changedTrackedFiles.size > 0) {
      this.fireChanged(changedKeys, changedTrackedFiles);
    }
  }

  provideFileDecoration(uri: Uri): FileDecoration | undefined {
    if (!this.hasData) {
      throw new Error("provideFileDecoration was called before data was available");
    }
    if (uri.scheme === "jj") {
      let params: JJUriParams;
      try {
        params = getParams(uri);
      } catch {
        // Stray or serialized jj: URIs (e.g. from stale state, logs, or
        // another extension) may have an empty or malformed query. Return
        // undefined instead of surfacing an error from the decoration provider.
        return undefined;
      }
      if ("interdiffFrom" in params) {
        return this.decorations.get(
          getKey(uri.fsPath, interdiffKey(params.interdiffFrom.changeId, params.interdiffTo.changeId)),
        );
      }
      if ("diffFrom" in params) {
        return this.decorations.get(getKey(uri.fsPath, diffKey(params.diffFrom.changeId, params.diffTo.changeId)));
      }
    }
    const rev = resolveRev(uri, { diffOriginalRevBehavior: "exclude", excludeSpecial: true });
    if (rev === undefined) {
      return undefined;
    }
    const key = getKey(uri.fsPath, rev);
    if (rev === "@" && !this.decorations.has(key)) {
      const fsPath = process.platform === "win32" ? uri.fsPath.toLowerCase() : uri.fsPath;
      if (!this.trackedFiles.has(fsPath)) {
        return {
          color: new ThemeColor("jjDecoration.ignoredResourceForeground"),
        };
      }
    }
    return this.decorations.get(key);
  }

  private updateTrackedFiles(repositoryKey: string, newTracked: Set<string>) {
    const changed = new Set<string>();
    const oldTracked = this.trackedFilesByRepository.get(repositoryKey);
    if (oldTracked) {
      for (const file of oldTracked) {
        if (!newTracked.has(file) && !this.isTrackedElsewhere(repositoryKey, file)) {
          this.trackedFiles.delete(file);
          changed.add(file);
        }
      }
    }
    for (const file of newTracked) {
      if (!this.trackedFiles.has(file)) {
        changed.add(file);
      }
      this.trackedFiles.add(file);
    }
    this.trackedFilesByRepository.set(repositoryKey, newTracked);
    return changed;
  }

  private isTrackedElsewhere(excludeRepoKey: string, file: string) {
    for (const [repoKey, tracked] of this.trackedFilesByRepository) {
      if (repoKey !== excludeRepoKey && tracked.has(file)) {
        return true;
      }
    }
    return false;
  }

  private fireChanged(changedKeys: Set<string>, changedTrackedFiles: Set<string>) {
    const changedUris: Uri[] = [];
    for (const key of changedKeys) {
      const { fsPath, rev } = parseKey(key);
      const comparison = parseComparisonRev(rev);
      if (comparison) {
        // Two-revision comparison (interdiff or from/to diff) resource states are keyed by
        // {from, to, side}, so emit those URIs (rather than a synthetic {rev}) so VS Code
        // refreshes their badges. The decoration key only preserves the canonical change ID,
        // so the affixes are rebuilt as empty here.
        const from = changeIdFromString(comparison.from);
        const to = changeIdFromString(comparison.to);
        const sideParams =
          comparison.kind === "interdiff"
            ? { interdiffFrom: from, interdiffTo: to, side: "right" as const }
            : { diffFrom: from, diffTo: to, side: "right" as const };
        changedUris.push(toJJUri(Uri.file(fsPath), sideParams));
      } else {
        changedUris.push(toJJUri(Uri.file(fsPath), { rev }));
        if (rev === "@") {
          changedUris.push(Uri.file(fsPath));
        }
      }
    }
    for (const file of changedTrackedFiles) {
      changedUris.push(Uri.file(file));
    }
    this._onDidChangeDecorations.fire(changedUris);
  }
}

function getKey(fsPath: string, rev: string) {
  fsPath = process.platform === "win32" ? fsPath.toLowerCase() : fsPath;
  return JSON.stringify({ fsPath, rev });
}

function parseKey(key: string) {
  return JSON.parse(key) as { fsPath: string; rev: string };
}

function parseComparisonRev(rev: string): { from: string; to: string; kind: "diff" | "interdiff" } | undefined {
  for (const kind of ["interdiff", "diff"] as const) {
    const prefix = `${kind}:`;
    if (!rev.startsWith(prefix)) {
      continue;
    }
    const sep = rev.indexOf("..", prefix.length);
    if (sep === -1) {
      return undefined;
    }
    return {
      from: rev.slice(prefix.length, sep),
      to: rev.slice(sep + 2),
      kind,
    };
  }
  return undefined;
}

function convertSetToLowercase<T>(originalSet: Set<T>): Set<T> {
  const lowercaseSet = new Set<T>();

  for (const item of originalSet) {
    if (typeof item === "string") {
      lowercaseSet.add(item.toLowerCase() as unknown as T);
    } else {
      lowercaseSet.add(item);
    }
  }

  return lowercaseSet;
}
