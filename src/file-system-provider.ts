import {
  FileSystemProvider,
  FileSystemError,
  EventEmitter,
  Event,
  FileChangeEvent,
  Disposable,
  Uri,
  FileStat,
  FileType,
  window,
  FileChangeType,
  workspace,
} from "vscode";
import { getParams } from "./uri";
import type { WorkspaceSourceControlManager } from "./source-control";
import type { JJRepository } from "./repository";
import { eventToPromise, filterEvent } from "./vscode-utils";
import { createThrottledAsyncFn, isDescendant } from "./utils";

interface CacheRow {
  uri: Uri;
  timestamp: number;
  size: number;
}

const THREE_MINUTES = 1000 * 60 * 3;
const FIVE_MINUTES = 1000 * 60 * 5;

export class JJFileSystemProvider implements FileSystemProvider {
  private _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
  readonly onDidChangeFile: Event<FileChangeEvent[]> = this._onDidChangeFile.event;

  private changedRepositoryRoots = new Set<string>();
  private cache = new Map<string, CacheRow>();
  private comparisonDiffCache = new Map<
    string,
    Promise<{ left: Uint8Array | undefined; right: Uint8Array | undefined }>
  >();
  private mtime = Date.now();
  private disposables: Disposable[] = [];
  private cleanupInterval?: ReturnType<typeof setInterval>;
  private disposed = false;
  private disposedPromise = new Promise<void>((resolve) => {
    this._disposeResolve = resolve;
  });
  private _disposeResolve: () => void = () => {};

  constructor(private repositories: WorkspaceSourceControlManager) {
    this.cleanupInterval = setInterval(() => this.cleanup(), FIVE_MINUTES);
  }

  dispose() {
    this.disposed = true;
    this._disposeResolve();
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  onDidChangeRepository({ repositoryRoot }: { repositoryRoot: string }): void {
    this.changedRepositoryRoots.add(repositoryRoot);
    this.comparisonDiffCache.clear();
    void this.fireChangeEvents();
  }

  fireChangeEvents = createThrottledAsyncFn(this._fireChangeEvents.bind(this));
  private async _fireChangeEvents(): Promise<void> {
    if (!window.state.focused) {
      const onDidFocusWindow = filterEvent(window.onDidChangeWindowState, (e) => e.focused);
      await Promise.race([eventToPromise(onDidFocusWindow), this.disposedPromise]);
    }

    if (this.disposed) {
      return;
    }

    const events: FileChangeEvent[] = [];

    for (const { uri } of this.cache.values()) {
      for (const root of this.changedRepositoryRoots) {
        if (isDescendant(root, uri.fsPath)) {
          events.push({ type: FileChangeType.Changed, uri });
          break;
        }
      }
    }

    if (events.length > 0) {
      this.mtime = Date.now();
      this._onDidChangeFile.fire(events);
    }

    this.changedRepositoryRoots.clear();
  }

  private cleanup(): void {
    const now = Date.now();
    const cache = new Map<string, CacheRow>();

    for (const row of this.cache.values()) {
      const uriString = row.uri.toString();
      // Cache entries are keyed by their full `jj://` URI, and an open diff
      // editor's document is itself a `jj://` URI, so keep a row alive when an
      // open document matches it (regardless of scheme).
      const isOpen = workspace.textDocuments.some((d) => d.uri.toString() === uriString);

      if (isOpen || now - row.timestamp < THREE_MINUTES) {
        cache.set(uriString, row);
      }
    }

    this.cache = cache;
  }

  watch(): Disposable {
    return new Disposable(() => {});
  }

  stat(uri: Uri): FileStat {
    const row = this.cache.get(uri.toString());
    return {
      type: FileType.File,
      size: row?.size ?? 0,
      mtime: row?.timestamp ?? this.mtime,
      ctime: 0,
    };
  }

  readDirectory(): Thenable<[string, FileType][]> {
    throw new Error("Method not implemented.");
  }

  createDirectory(): void {
    throw new Error("Method not implemented.");
  }

  async readFile(uri: Uri): Promise<Uint8Array> {
    const params = getParams(uri);

    if ("deleted" in params) {
      return new Uint8Array(0);
    }

    const repository = this.repositories.getRepositoryFromUri(uri);
    if (!repository) {
      throw FileSystemError.FileNotFound();
    }

    let content: Uint8Array;
    if ("diffOriginalRev" in params) {
      const renamedFrom = "renamedFrom" in params ? params.renamedFrom : undefined;
      const originalContent = await repository.getDiffOriginal(params.diffOriginalRev, uri.fsPath, renamedFrom);
      content =
        originalContent ??
        (await this.readFileOrNotFound(repository, params.diffOriginalRev, renamedFrom ?? uri.fsPath));
    } else if ("rev" in params) {
      content = await this.readFileOrNotFound(repository, params.rev, uri.fsPath);
    } else if ("interdiffFrom" in params) {
      const pair = await this.getComparisonDiffPair(
        repository,
        { mode: "interdiff", from: params.interdiffFrom.changeId, to: params.interdiffTo.changeId },
        uri.fsPath,
        params.renamedFrom,
      );
      content = (params.side === "left" ? pair.left : pair.right) ?? new Uint8Array(0);
    } else if ("diffFrom" in params) {
      const pair = await this.getComparisonDiffPair(
        repository,
        { mode: "diff", from: params.diffFrom.changeId, to: params.diffTo.changeId },
        uri.fsPath,
        params.renamedFrom,
      );
      content = (params.side === "left" ? pair.left : pair.right) ?? new Uint8Array(0);
    } else {
      throw new Error("Unknown URI params");
    }

    this.cache.set(uri.toString(), { uri, timestamp: Date.now(), size: content.byteLength });
    return content;
  }

  private getComparisonDiffPair(
    repository: JJRepository,
    params: { mode: "diff" | "interdiff"; from: string; to: string },
    fsPath: string,
    renamedFrom?: string,
  ): Promise<{ left: Uint8Array | undefined; right: Uint8Array | undefined }> {
    const key = `${params.mode}\0${params.from}\0${params.to}\0${fsPath}\0${renamedFrom ?? ""}`;
    let promise = this.comparisonDiffCache.get(key);
    if (!promise) {
      promise = repository.getComparisonDiff(params.mode, params.from, params.to, fsPath, renamedFrom).finally(() => {
        this.comparisonDiffCache.delete(key);
      });
      this.comparisonDiffCache.set(key, promise);
    }
    return promise;
  }

  private async readFileOrNotFound(repository: JJRepository, rev: string, fsPath: string): Promise<Uint8Array> {
    try {
      return await repository.readFile(rev, fsPath);
    } catch (e) {
      const text =
        e instanceof Error && "stderr" in e && typeof (e as { stderr: unknown }).stderr === "string"
          ? (e as { stderr: string }).stderr
          : e instanceof Error
            ? e.message
            : String(e);
      if (text.includes("No such path") || text.includes("No such file or directory")) {
        throw FileSystemError.FileNotFound();
      }
      throw e;
    }
  }

  writeFile(): void {
    throw new Error("Method not implemented.");
  }

  delete(): void {
    throw new Error("Method not implemented.");
  }

  rename(): void {
    throw new Error("Method not implemented.");
  }
}
