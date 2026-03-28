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
import type { WorkspaceSourceControlManager } from "./sourceControl";
import { createThrottledAsyncFn, eventToPromise, filterEvent, isDescendant, pathEquals } from "./utils";

interface CacheRow {
  uri: Uri;
  timestamp: number;
}

const THREE_MINUTES = 1000 * 60 * 3;
const FIVE_MINUTES = 1000 * 60 * 5;

export class JJFileSystemProvider implements FileSystemProvider {
  private _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
  readonly onDidChangeFile: Event<FileChangeEvent[]> = this._onDidChangeFile.event;

  private changedRepositoryRoots = new Set<string>();
  private cache = new Map<string, CacheRow>();
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
      this.mtime = new Date().getTime();
      this._onDidChangeFile.fire(events);
    }

    this.changedRepositoryRoots.clear();
  }

  private cleanup(): void {
    const now = new Date().getTime();
    const cache = new Map<string, CacheRow>();

    for (const row of this.cache.values()) {
      const path = row.uri.fsPath;
      const isOpen = workspace.textDocuments
        .filter((d) => d.uri.scheme === "file")
        .some((d) => pathEquals(d.uri.fsPath, path));

      if (isOpen || now - row.timestamp < THREE_MINUTES) {
        cache.set(row.uri.toString(), row);
      } else {
        // TODO: should fire delete events?
      }
    }

    this.cache = cache;
  }

  watch(): Disposable {
    return new Disposable(() => {});
  }

  async stat(uri: Uri): Promise<FileStat> {
    return {
      type: FileType.File,
      size: (await this.readFile(uri)).length,
      mtime: this.mtime,
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

    const timestamp = new Date().getTime();
    const cacheValue: CacheRow = { uri, timestamp };

    this.cache.set(uri.toString(), cacheValue);

    if ("diffOriginalRev" in params) {
      const originalContent = await repository.getDiffOriginal(params.diffOriginalRev, uri.fsPath);
      if (!originalContent) {
        try {
          const data = await repository.readFile(params.diffOriginalRev, uri.fsPath);
          return data;
        } catch (e) {
          if (e instanceof Error && e.message.includes("No such path")) {
            throw FileSystemError.FileNotFound();
          }
          throw e;
        }
      }
      return originalContent;
    } else if ("rev" in params) {
      try {
        const data = await repository.readFile(params.rev, uri.fsPath);
        return data;
      } catch (e) {
        if (e instanceof Error && e.message.includes("No such path")) {
          throw FileSystemError.FileNotFound();
        }
        throw e;
      }
    }
    throw new Error("Unknown URI params");
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
