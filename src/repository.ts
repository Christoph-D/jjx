import path from "path";
import * as crypto from "crypto";
import * as vscode from "vscode";
import fs from "fs/promises";
import realFs from "fs";
import {
  SHOW_TEMPLATE,
  STATUS_TEMPLATE,
  LOG_TEMPLATE,
  OPERATION_TEMPLATE,
  DIFF_STATS_TEMPLATE,
  BOOKMARK_TRACKING_INFO_TEMPLATE,
} from "./templateBuilder";
import spawn from "cross-spawn";
import { ImmutableError, convertJJErrors } from "./errors";
import {
  spawnJJ,
  handleJJCommand,
  type SpawnOptions,
  collectProcessOutput,
  type ProcessOutput,
  ProcessError,
} from "./process";
import { parseRenamePaths } from "./parseRenamePaths";
import { filepathToFileset, pathEquals, normalizePath } from "./utils";
import {
  getDiffToolConfigs,
  expectDiffToolRequest,
  getSquashToolConfigs,
  expectSquashToolRequest,
  completeSquashToolRequest,
  consumeEditorSession,
  openRecoveredEditor,
} from "./jjEditor";
import { TIMEOUTS } from "./constants";
import type {
  FileStatus,
  FileStatusType,
  RepositoryStatus,
  Show,
  Change,
  ChangeWithDetails,
  LogEntry,
  LogEntryLocalRef,
  LogEntryRemoteRef,
  ParentRef,
  Operation,
} from "./types";

export type {
  FileStatus,
  FileStatusType,
  RepositoryStatus,
  Show,
  Change,
  ChangeWithDetails,
  LogEntry,
  LogEntryLocalRef,
  LogEntryRemoteRef,
  ParentRef,
  Operation,
};

type DiffFileEntry = {
  status_char: string;
  source_path: string;
  target_path: string;
  is_conflict: boolean;
};

type ParsedFileStatuses = {
  fileStatuses: FileStatus[];
  fileStatusesByPath: Map<string, FileStatus>;
  conflictedFiles: Set<string>;
};

export class JJRepository {
  statusCache: RepositoryStatus | undefined;
  gitFetchPromise: Promise<ProcessOutput> | undefined;
  private autoUpdateStaleAttempted = false;
  private _gitDirPromise: Promise<string> | undefined;

  constructor(
    public repositoryRoot: string,
    private jjPath: string,
    private jjConfigArgs: string[],
  ) {}

  async getGitDir(): Promise<string> {
    if (!this._gitDirPromise) {
      this._gitDirPromise = this.jjCommandRead(["git", "root"]).then((buf) => buf.toString().trim());
    }
    return this._gitDirPromise;
  }

  private parseFileStatuses(diffFiles: DiffFileEntry[], conflictedPaths: string[] | undefined): ParsedFileStatuses {
    const fileStatuses: FileStatus[] = [];
    const fileStatusesByPath = new Map<string, FileStatus>();

    for (const diffFile of diffFiles) {
      const statusChar = diffFile.status_char as FileStatusType;
      const targetPath = path.normalize(diffFile.target_path).replace(/\\/g, "/");
      const sourcePath = path.normalize(diffFile.source_path).replace(/\\/g, "/");
      const fullPath = path.join(this.repositoryRoot, targetPath);

      let fileStatus: FileStatus;
      if (statusChar === "R" || statusChar === "C") {
        fileStatus = {
          type: statusChar,
          file: path.basename(targetPath),
          path: fullPath,
          renamedFrom: sourcePath,
        };
      } else {
        fileStatus = {
          type: statusChar,
          file: path.basename(targetPath),
          path: fullPath,
        };
      }
      fileStatuses.push(fileStatus);
      fileStatusesByPath.set(normalizePath(fullPath), fileStatus);
    }

    const conflictedFiles = new Set<string>();
    for (const conflictedPath of conflictedPaths || []) {
      const normalizedPath = path.normalize(conflictedPath).replace(/\\/g, "/");
      const fullPath = path.join(this.repositoryRoot, normalizedPath);
      conflictedFiles.add(fullPath);

      const normalizedFullPath = normalizePath(fullPath);
      if (!fileStatusesByPath.has(normalizedFullPath)) {
        fileStatuses.push({
          type: "X",
          file: path.basename(normalizedPath),
          path: fullPath,
        });
        fileStatusesByPath.set(normalizedFullPath, fileStatuses[fileStatuses.length - 1]);
      }
    }

    return { fileStatuses, fileStatusesByPath, conflictedFiles };
  }

  private async retryWithImmutable<T>(
    rev: string,
    operation: () => Promise<T>,
    retryOperation: () => Promise<T>,
    customMessage?: string,
  ): Promise<T | undefined> {
    try {
      return await operation();
    } catch (e) {
      if (e instanceof ImmutableError) {
        const choice = await vscode.window.showQuickPick(["Continue"], {
          title: customMessage ?? `${rev} is immutable, are you sure?`,
        });
        if (!choice) {
          return undefined;
        }
        return await retryOperation();
      }
      throw e;
    }
  }

  private async withEditorRecovery<T>(operation: (sessionId: string) => Promise<T>): Promise<T | undefined> {
    const sessionId = crypto.randomUUID();
    try {
      const result = await operation(sessionId);
      consumeEditorSession(sessionId);
      return result;
    } catch (e) {
      const content = consumeEditorSession(sessionId);
      if (content) {
        await openRecoveredEditor(content, e);
        return undefined;
      }
      throw e;
    }
  }

  spawnJJ(args: string[], options: SpawnOptions) {
    const separatorIndex = args.indexOf("--");
    const finalArgs =
      separatorIndex === -1
        ? [...args, ...this.jjConfigArgs]
        : [...args.slice(0, separatorIndex), ...this.jjConfigArgs, ...args.slice(separatorIndex)];
    return spawnJJ(this.jjPath, finalArgs, options);
  }

  spawnJJRead(args: string[], options: SpawnOptions) {
    return this.spawnJJ(["--ignore-working-copy", ...args], options);
  }

  private jjCommand(
    args: string[],
    options?: { token?: vscode.CancellationToken; timeout?: number; env?: Record<string, string> },
  ) {
    return handleJJCommand(
      this.spawnJJ(args, { timeout: options?.timeout, cwd: this.repositoryRoot, env: options?.env }),
      options?.token,
    );
  }

  private jjCommandRead(args: string[], options?: { token?: vscode.CancellationToken; timeout?: number }) {
    return handleJJCommand(
      this.spawnJJRead(args, { timeout: options?.timeout, cwd: this.repositoryRoot }),
      options?.token,
    );
  }

  private splitLines(output: string | Buffer): string[] {
    return output
      .toString()
      .trim()
      .split("\n")
      .map((r) => r.trim())
      .filter(Boolean);
  }

  /**
   * Note: this command may itself snapshot the working copy and add an operation to the log, in which case it will
   * return the new operation id.
   */
  async getLatestOperationId(ignoreWorkingCopy: boolean = true, token?: vscode.CancellationToken) {
    const args = ["operation", "log", "--limit", "1", "-T", "self.id()", "--no-graph"];
    const buf = ignoreWorkingCopy ? await this.jjCommandRead(args, { token }) : await this.jjCommand(args, { token });
    return buf.toString().trim();
  }

  async getStatus(useCache = false, token?: vscode.CancellationToken): Promise<RepositoryStatus> {
    if (useCache && this.statusCache) {
      return this.statusCache;
    }

    const output = (
      await this.jjCommandRead(["log", "-r", "@", "-T", STATUS_TEMPLATE, "--no-graph"], { token })
    ).toString();

    const entry = JSON.parse(output.trim()) as {
      change_id: string;
      commit_id: string;
      divergent: boolean;
      change_offset: string;
      description: string;
      empty: boolean;
      conflict: boolean;
      local_bookmarks: string[];
      parents: Array<{
        change_id: string;
        commit_id: string;
        divergent: boolean;
        change_offset: string;
        description: string;
        empty: boolean;
        conflict: boolean;
        local_bookmarks: string[];
      }>;
      diff_files: Array<{
        status_char: string;
        source_path: string;
        target_path: string;
        is_conflict: boolean;
      }>;
      conflicted_files: string[];
    };

    const { fileStatuses, conflictedFiles } = this.parseFileStatuses(entry.diff_files, entry.conflicted_files);

    const workingCopy: Change = {
      changeId: entry.change_id,
      commitId: entry.commit_id,
      description: entry.description,
      isEmpty: entry.empty,
      isConflict: entry.conflict,
      bookmarks: entry.local_bookmarks,
      divergent: entry.divergent,
      changeOffset: entry.change_offset || undefined,
    };

    const parentChanges: Change[] = entry.parents.map((p) => ({
      changeId: p.change_id,
      commitId: p.commit_id,
      description: p.description,
      isEmpty: p.empty,
      isConflict: p.conflict,
      bookmarks: p.local_bookmarks,
      divergent: p.divergent,
      changeOffset: p.change_offset || undefined,
    }));

    const status: RepositoryStatus = {
      workingCopy,
      parentChanges,
      fileStatuses,
      conflictedFiles,
    };

    this.statusCache = status;
    return status;
  }

  async fileList(token?: vscode.CancellationToken) {
    return (await this.jjCommandRead(["file", "list"], { token })).toString().trim().split("\n");
  }

  async show(rev: string, token?: vscode.CancellationToken) {
    const results = await this.showAll([rev], token);
    if (results.length > 1) {
      throw new Error("Multiple results found for the given revision.");
    }
    if (results.length === 0) {
      throw new Error("No results found for the given revision.");
    }
    return results[0];
  }

  async showAll(revsets: string[], token?: vscode.CancellationToken) {
    const output = (
      await this.jjCommandRead(
        ["log", "-T", SHOW_TEMPLATE, "--no-graph", ...revsets.flatMap((revset) => ["-r", revset])],
        { token },
      )
    ).toString();

    if (!output.trim()) {
      throw new Error("No output from jj log. Maybe the revision couldn't be found?");
    }

    const results: Show[] = [];
    for (const line of output.trim().split("\n")) {
      if (!line.trim()) {
        continue;
      }
      const entry = JSON.parse(line) as {
        change_id: string;
        commit_id: string;
        divergent: boolean;
        change_offset: string;
        author: { name: string; email: string };
        authored_date: string;
        description: string;
        empty: boolean;
        conflict: boolean;
        diff_files: Array<{
          status_char: string;
          source_path: string;
          target_path: string;
          is_conflict: boolean;
        }>;
        conflicted_files: string[];
      };

      const { fileStatuses, conflictedFiles } = this.parseFileStatuses(entry.diff_files, entry.conflicted_files);

      results.push({
        change: {
          changeId: entry.change_id,
          commitId: entry.commit_id,
          description: entry.description,
          author: {
            name: entry.author.name,
            email: entry.author.email,
          },
          authoredDate: entry.authored_date,
          isEmpty: entry.empty,
          isConflict: entry.conflict,
          divergent: entry.divergent,
          changeOffset: entry.change_offset || undefined,
        },
        fileStatuses,
        conflictedFiles,
      });
    }

    return results;
  }

  readFile(rev: string, filepath: string) {
    return this.jjCommandRead(["file", "show", "--revision", rev, filepathToFileset(filepath)]);
  }

  async describeRetryImmutable(rev: string, message?: string) {
    return this.withEditorRecovery((sessionId) =>
      this.retryWithImmutable(
        rev,
        () => this.describe(rev, message, false, sessionId),
        () => this.describe(rev, message, true, sessionId),
      ),
    );
  }

  private async describe(rev: string, message?: string, ignoreImmutable = false, sessionId?: string) {
    return (
      await this.jjCommand(
        ["describe", ...(message ? ["-m", message] : []), rev, ...(ignoreImmutable ? ["--ignore-immutable"] : [])],
        { timeout: message ? TIMEOUTS.DEFAULT : 0, env: sessionId ? { VSCODE_JJ_SESSION_ID: sessionId } : undefined },
      )
    ).toString();
  }

  async new(message?: string, revs?: string[]) {
    return this.withEditorRecovery((sessionId) =>
      this.jjCommand(["new", ...(message !== undefined ? ["-m", message] : []), ...(revs ? ["-r", ...revs] : [])], {
        env: { VSCODE_JJ_SESSION_ID: sessionId },
      }),
    );
  }

  async commit(message?: string, editor?: boolean) {
    return this.withEditorRecovery((sessionId) =>
      this.jjCommand(["commit", ...(message !== undefined ? ["-m", message] : []), ...(editor ? ["--editor"] : [])], {
        timeout: editor ? 0 : message !== undefined ? TIMEOUTS.DEFAULT : 0,
        env: { VSCODE_JJ_SESSION_ID: sessionId },
      }),
    );
  }

  async describeOpenEditor() {
    return this.withEditorRecovery((sessionId) =>
      this.jjCommand(["describe"], { timeout: 0, env: { VSCODE_JJ_SESSION_ID: sessionId } }),
    );
  }

  async squashRetryImmutable({
    fromRev,
    toRev,
    message,
    filepaths,
  }: {
    fromRev: string;
    toRev: string;
    message?: string;
    filepaths?: string[];
  }) {
    return this.retryWithImmutable(
      toRev,
      () =>
        this.squash({
          fromRev,
          toRev,
          message,
          filepaths,
        }),
      () =>
        this.squash({
          fromRev,
          toRev,
          message,
          filepaths,
          ignoreImmutable: true,
        }),
    );
  }

  private async squash({
    fromRev,
    toRev,
    message,
    filepaths,
    ignoreImmutable = false,
  }: {
    fromRev: string;
    toRev: string;
    message?: string;
    filepaths?: string[];
    ignoreImmutable?: boolean;
  }) {
    return (
      await this.jjCommand(
        [
          "squash",
          "--from",
          fromRev,
          "--into",
          toRev,
          ...(message ? ["-m", message] : []),
          ...(filepaths ? filepaths.map((filepath) => filepathToFileset(filepath)) : []),
          ...(ignoreImmutable ? ["--ignore-immutable"] : []),
        ],
        { timeout: message ? TIMEOUTS.DEFAULT : 0 },
      )
    ).toString();
  }

  async squashContentRetryImmutable({
    fromRev,
    toRev,
    filepath,
    content,
  }: {
    fromRev: string;
    toRev: string;
    filepath: string;
    content: string;
  }) {
    return this.retryWithImmutable(
      toRev,
      () =>
        this.squashContent({
          fromRev,
          toRev,
          filepath,
          content,
        }),
      () =>
        this.squashContent({
          fromRev,
          toRev,
          filepath,
          content,
          ignoreImmutable: true,
        }),
    );
  }

  /**
   * Squashes a portion of the changes in a file from one revision into another.
   *
   * @param options.fromRev - The revision to squash changes from.
   * @param options.toRev - The revision to squash changes into.
   * @param options.filepath - The path of the file whose changes will be moved.
   * @param options.content - The contents of the file at filepath with some of the changes in fromRev applied to it;
   *                          those changes will be moved to the destination revision.
   */
  private async squashContent({
    fromRev,
    toRev,
    filepath,
    content,
    ignoreImmutable = false,
  }: {
    fromRev: string;
    toRev: string;
    filepath: string;
    content: string;
    ignoreImmutable?: boolean;
  }): Promise<void> {
    try {
      filepath = realFs.realpathSync.native(filepath);
    } catch {
      // Fall back to original path if realpath fails
    }

    const squashConfigs = getSquashToolConfigs();
    if (!squashConfigs.length) {
      throw new Error("Squash tool not initialized. Ensure useVSCodeAsJJEditor is enabled.");
    }

    const requestId = crypto.randomUUID();
    const pathPromise = expectSquashToolRequest(requestId);

    const childProcess = this.spawnJJ(
      [
        "squash",
        "--from",
        fromRev,
        "--into",
        toRev,
        "--interactive",
        "--tool=jjx-vscode-squash",
        ...squashConfigs.flatMap((c) => ["--config", c]),
        "--use-destination-message",
        ...(ignoreImmutable ? ["--ignore-immutable"] : []),
      ],
      {
        timeout: TIMEOUTS.SQUASH_TOOL,
        cwd: this.repositoryRoot,
        env: { ...process.env, VSCODE_JJ_SQUASH_REQUEST_ID: requestId },
      },
    );

    const jjExit = collectProcessOutput(childProcess)
      .catch(convertJJErrors)
      .then(() => {});

    try {
      const { leftPath, rightPath } = await pathPromise;

      const leftFolderAbsolutePath = path.isAbsolute(leftPath) ? leftPath : path.join(this.repositoryRoot, leftPath);
      const rightFolderAbsolutePath = path.isAbsolute(rightPath)
        ? rightPath
        : path.join(this.repositoryRoot, rightPath);

      const relativeFilePath = path.relative(this.repositoryRoot, filepath);
      const fileToEdit = path.join(rightFolderAbsolutePath, relativeFilePath);

      await fs.rm(rightFolderAbsolutePath, { recursive: true, force: true });
      await fs.mkdir(rightFolderAbsolutePath, { recursive: true });
      await fs.cp(leftFolderAbsolutePath, rightFolderAbsolutePath, {
        recursive: true,
      });
      await fs.rm(fileToEdit, { force: true });
      await fs.writeFile(fileToEdit, content);

      completeSquashToolRequest(requestId, true);
    } catch (error) {
      completeSquashToolRequest(requestId, false);
      throw error;
    }

    await jjExit;
  }

  async log(rev: string, limit: number = 100): Promise<LogEntry[]> {
    const output = (
      await this.jjCommandRead(["log", "-r", rev, "-n", limit.toString(), "-T", LOG_TEMPLATE])
    ).toString();

    if (!output.trim()) {
      return [];
    }

    const entries: LogEntry[] = [];
    for (const line of output.trim().split("\n")) {
      const jsonStart = line.indexOf("{");
      if (jsonStart === -1) {
        continue;
      }
      entries.push(JSON.parse(line.slice(jsonStart)) as LogEntry);
    }
    return entries;
  }

  async getDiffStats(changeId: string): Promise<{ filesChanged: number; linesAdded: number; linesRemoved: number }> {
    const output = (
      await this.jjCommandRead(["log", "-r", changeId, "-n", "1", "--no-graph", "-T", DIFF_STATS_TEMPLATE])
    ).toString();

    const entry = JSON.parse(output.trim()) as {
      files_changed: number;
      total_added: number;
      total_removed: number;
    };

    return {
      filesChanged: entry.files_changed,
      linesAdded: entry.total_added,
      linesRemoved: entry.total_removed,
    };
  }

  async editRetryImmutable(rev: string) {
    return this.retryWithImmutable(
      rev,
      () => this.edit(rev),
      () => this.edit(rev, true),
    );
  }

  private async edit(rev: string, ignoreImmutable = false) {
    return this.jjCommand(["edit", "-r", rev, ...(ignoreImmutable ? ["--ignore-immutable"] : [])]);
  }

  async moveBookmark(bookmark: string, targetRev: string, allowBackwards = false) {
    return this.jjCommand([
      "bookmark",
      "move",
      bookmark,
      "-t",
      targetRev,
      ...(allowBackwards ? ["--allow-backwards"] : []),
    ]);
  }

  async createBookmark(bookmark: string, targetRev: string) {
    return this.jjCommand(["bookmark", "create", bookmark, "-r", targetRev]);
  }

  async createTag(tag: string, targetRev: string) {
    return this.jjCommand(["tag", "set", tag, "-r", targetRev]);
  }

  async deleteBookmark(bookmark: string) {
    return this.jjCommand(["bookmark", "delete", bookmark]);
  }

  async pushBookmark(bookmark: string): Promise<string[]> {
    const remotes = await this.getBookmarkTrackingRemotes(bookmark, true);
    if (remotes.length === 0) {
      return [];
    }
    const failedRemoteErrors: string[] = [];
    for (const remote of remotes) {
      try {
        await this.pushBookmarkToRemote(bookmark, remote);
      } catch (e) {
        const reason = e instanceof ProcessError ? e.stderr : e instanceof Error ? e.message : String(e);
        failedRemoteErrors.push(`${remote}: ${reason}`);
      }
    }
    if (failedRemoteErrors.length > 0) {
      throw new Error(`Failed to push bookmark "${bookmark}":\n${failedRemoteErrors.join("\n")}`);
    }
    return remotes;
  }

  async getBookmarksWithUnsyncedNonGitRemotes(): Promise<Set<string>> {
    const output = (
      await this.jjCommandRead([
        "bookmark",
        "list",
        "-T",
        `if(remote != "" && tracked && !synced && remote != "git", name ++ "\\n", "")`,
      ])
    )
      .toString()
      .trim();
    if (!output) {
      return new Set();
    }
    return new Set(this.splitLines(output));
  }

  async getBookmarkTrackingRemotes(bookmark: string, unsyncedOnly = false): Promise<string[]> {
    const filter = unsyncedOnly ? "tracked && !synced" : "tracked";
    const output = (
      await this.jjCommandRead([
        "bookmark",
        "list",
        "--all-remotes",
        bookmark,
        "-T",
        `if(remote != "", if(${filter}, remote ++ "\\n", ""), "")`,
      ])
    )
      .toString()
      .trim();
    return this.splitLines(output).filter((r) => r !== "git");
  }

  async getBookmarkTrackingInfo(
    bookmark: string,
  ): Promise<{ trackedRemotes: string[]; unsyncedTrackedRemotes: string[]; untrackedRemotes: string[] }> {
    const [trackingOutput, remotesOutput] = await Promise.all([
      this.jjCommandRead(["bookmark", "list", "--all-remotes", bookmark, "-T", BOOKMARK_TRACKING_INFO_TEMPLATE]),
      this.jjCommandRead(["git", "remote", "list"]),
    ]);
    const trackingEntries = this.splitLines(trackingOutput)
      .map((line) => JSON.parse(line) as { remote: string; tracked: boolean; synced: boolean })
      .filter((e) => e.remote !== "" && e.remote !== "git" && e.tracked);
    const trackedRemotes = trackingEntries.map((e) => e.remote);
    const unsyncedTrackedRemotes = trackingEntries.filter((e) => !e.synced).map((e) => e.remote);
    const allRemotes = this.splitLines(remotesOutput).map((line) => line.split(/\s+/)[0]);
    const untrackedRemotes = allRemotes.filter((r) => !trackedRemotes.includes(r));
    return { trackedRemotes, unsyncedTrackedRemotes, untrackedRemotes };
  }

  async trackBookmark(bookmark: string, remote: string): Promise<void> {
    await this.jjCommand(["bookmark", "track", bookmark, `--remote=${remote}`]);
  }

  async untrackBookmark(bookmark: string, remote: string): Promise<void> {
    await this.jjCommand(["bookmark", "untrack", bookmark, `--remote=${remote}`]);
  }

  async pushBookmarkToRemote(bookmark: string, remote: string): Promise<void> {
    await this.jjCommand(["git", "push", "--bookmark", bookmark, "--remote", remote], {
      timeout: TIMEOUTS.GIT_FETCH,
    });
  }

  async deleteTag(tag: string) {
    return this.jjCommand(["tag", "delete", tag]);
  }

  async getRemotes(): Promise<string[]> {
    const output = await this.jjCommandRead(["git", "remote", "list"]);
    return this.splitLines(output).map((line) => line.split(/\s+/)[0]);
  }

  async pushTagToRemote(tag: string, remote: string): Promise<void> {
    const gitDir = await this.getGitDir();
    await collectProcessOutput(
      spawn("git", ["push", remote, tag], {
        cwd: this.repositoryRoot,
        env: { ...process.env, GIT_DIR: gitDir },
      }),
    );
  }

  async absorb(fromRev: string) {
    return await collectProcessOutput(
      this.spawnJJ(["absorb", "-f", fromRev], { timeout: TIMEOUTS.DEFAULT, cwd: this.repositoryRoot }),
    );
  }

  async abandonRetryImmutable(revs: string[], customMessage?: string) {
    const revset = revs.join("|");
    return this.retryWithImmutable(
      revset,
      () => this.abandon(revs),
      () => this.abandon(revs, true),
      customMessage,
    );
  }

  async getCommitUrl(changeId: string): Promise<string | null> {
    try {
      const config = vscode.workspace.getConfiguration("jjx", vscode.Uri.file(this.repositoryRoot));
      const baseWebURL = config.get<string>("baseWebURL") ?? "";

      if (baseWebURL) {
        const commitId = (await this.jjCommandRead(["show", "-r", changeId, "--no-patch", "-T", "commit_id"]))
          .toString()
          .trim();

        const base = baseWebURL.endsWith("/") ? baseWebURL.slice(0, -1) : baseWebURL;
        return `${base}/commit/${commitId}`;
      }

      const output = (
        await this.jjCommandRead([
          "show",
          "-r",
          changeId,
          "--no-patch",
          "-T",
          'git_web_url() ++ "/commit/" ++ commit_id',
        ])
      )
        .toString()
        .trim();

      return output && !output.startsWith("/commit/") ? output : null;
    } catch {
      return null;
    }
  }

  private async abandon(revs: string[], ignoreImmutable = false) {
    const revset = revs.join("|");
    return this.jjCommand(["abandon", "-r", revset, ...(ignoreImmutable ? ["--ignore-immutable"] : [])]);
  }

  private async rebase(
    source: string,
    destination: string,
    mode: "onto" | "after" | "before",
    withDescendants = false,
    ignoreImmutable = false,
  ) {
    const sourceFlag = withDescendants ? "-s" : "-r";
    const flag = mode === "onto" ? "-o" : mode === "after" ? "-A" : "-B";
    return this.jjCommand([
      "rebase",
      sourceFlag,
      source,
      flag,
      destination,
      ...(ignoreImmutable ? ["--ignore-immutable"] : []),
    ]);
  }

  async rebaseRetryImmutable(
    source: string,
    destination: string,
    mode: "onto" | "after" | "before",
    withDescendants = false,
  ) {
    return this.retryWithImmutable(
      source,
      () => this.rebase(source, destination, mode, withDescendants),
      () => this.rebase(source, destination, mode, withDescendants, true),
      "This rebase modifies one or more immutable commits, are you sure?",
    );
  }

  async duplicate(source: string, destination: string, mode: "onto" | "after" | "before") {
    const flag = mode === "onto" ? "-o" : mode === "after" ? "-A" : "-B";
    return this.jjCommand(["duplicate", "-r", source, flag, destination]);
  }

  async revert(source: string, destination: string, mode: "onto" | "after" | "before") {
    const flag = mode === "onto" ? "-o" : mode === "after" ? "-A" : "-B";
    return this.jjCommand(["revert", "-r", source, flag, destination]);
  }

  async restoreRetryImmutable(rev?: string, filepaths?: string[]) {
    return this.retryWithImmutable(
      rev ?? "@",
      () => this.restore(rev, filepaths),
      () => this.restore(rev, filepaths, true),
    );
  }

  private async restore(rev?: string, filepaths?: string[], ignoreImmutable = false) {
    return this.jjCommand([
      "restore",
      "--changes-in",
      rev ? rev : "@",
      ...(filepaths ? filepaths.map((filepath) => filepathToFileset(filepath)) : []),
      ...(ignoreImmutable ? ["--ignore-immutable"] : []),
    ]);
  }

  gitFetch(): Promise<ProcessOutput> {
    if (!this.gitFetchPromise) {
      this.gitFetchPromise = (async () => {
        try {
          return await collectProcessOutput(
            this.spawnJJ(["git", "fetch"], { timeout: TIMEOUTS.GIT_FETCH, cwd: this.repositoryRoot }),
          );
        } finally {
          this.gitFetchPromise = undefined;
        }
      })();
    }
    return this.gitFetchPromise;
  }

  private gitFetchAllRemotesPromise: Promise<ProcessOutput> | undefined;

  gitFetchAllRemotes(): Promise<ProcessOutput> {
    if (!this.gitFetchAllRemotesPromise) {
      this.gitFetchAllRemotesPromise = (async () => {
        try {
          return await collectProcessOutput(
            this.spawnJJ(["git", "fetch", "--all-remotes"], {
              timeout: TIMEOUTS.GIT_FETCH,
              cwd: this.repositoryRoot,
            }),
          );
        } finally {
          this.gitFetchAllRemotesPromise = undefined;
        }
      })();
    }
    return this.gitFetchAllRemotesPromise;
  }

  private gitFetchFromRemotePromises = new Map<string, Promise<ProcessOutput>>();

  gitFetchFromRemote(remote: string): Promise<ProcessOutput> {
    let promise = this.gitFetchFromRemotePromises.get(remote);
    if (!promise) {
      promise = (async () => {
        try {
          return await collectProcessOutput(
            this.spawnJJ(["git", "fetch", "--remote", remote], {
              timeout: TIMEOUTS.GIT_FETCH,
              cwd: this.repositoryRoot,
            }),
          );
        } finally {
          this.gitFetchFromRemotePromises.delete(remote);
        }
      })();
      this.gitFetchFromRemotePromises.set(remote, promise);
    }
    return promise;
  }

  async updateStale(token?: vscode.CancellationToken): Promise<void> {
    await this.jjCommand(["workspace", "update-stale"], { token, timeout: TIMEOUTS.UPDATE_STALE });
  }

  async tryAutoUpdateStale(token?: vscode.CancellationToken): Promise<boolean> {
    const config = vscode.workspace.getConfiguration("jjx", vscode.Uri.file(this.repositoryRoot));
    if (!config.get<boolean>("autoUpdateStaleWorkspace")) {
      return false;
    }
    if (this.autoUpdateStaleAttempted) {
      return false;
    }
    this.autoUpdateStaleAttempted = true;
    try {
      await this.updateStale(token);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Auto update-stale failed: ${errorMessage}`);
      return false;
    }
  }

  resetAutoUpdateStaleAttempted() {
    this.autoUpdateStaleAttempted = false;
  }

  async annotate(filepath: string, rev: string): Promise<string[]> {
    const output = (
      await this.jjCommandRead(["file", "annotate", "-r", rev, filepath], { timeout: TIMEOUTS.ANNOTATE })
    ).toString();
    if (output === "") {
      return [];
    }
    const lines = output.trim().split("\n");
    const changeIdsByLine = lines.map((line) => line.split(" ")[0]);
    return changeIdsByLine;
  }

  async operationLog(): Promise<Operation[]> {
    const output = (
      await this.jjCommandRead([
        "operation",
        "log",
        "--limit",
        "10",
        "--no-graph",
        "--at-operation=@",
        "-T",
        OPERATION_TEMPLATE,
      ])
    ).toString();

    const ret: Operation[] = [];
    for (const line of output.trim().split("\n")) {
      if (!line.trim()) {
        continue;
      }
      ret.push(JSON.parse(line) as Operation);
    }

    return ret;
  }

  async operationRevert(id: string) {
    return (await this.jjCommand(["operation", "revert", id])).toString();
  }

  async operationRestore(id: string) {
    return (await this.jjCommand(["operation", "restore", id])).toString();
  }

  async undo() {
    return this.jjCommand(["undo"]);
  }

  async redo() {
    return this.jjCommand(["redo"]);
  }

  /**
   * @returns undefined if the file was not modified in `rev`
   */
  async getDiffOriginal(rev: string, filepath: string, renamedFrom?: string): Promise<Buffer | undefined> {
    try {
      filepath = realFs.realpathSync.native(filepath);
    } catch {
      // Fall back to original path if realpath fails
    }

    const diffConfigs = getDiffToolConfigs();
    if (!diffConfigs.length) {
      throw new Error("Diff tool not initialized.");
    }

    const requestId = crypto.randomUUID();
    const pathPromise = expectDiffToolRequest(requestId);

    const relativePath = path.relative(this.repositoryRoot, filepath).replace(/\\/g, "/");
    const filesetArgs = renamedFrom
      ? [filepathToFileset(renamedFrom.replace(/\\/g, "/")), filepathToFileset(relativePath)]
      : [filepathToFileset(relativePath)];
    const childProcess = this.spawnJJRead(
      [
        "diff",
        "--summary",
        "--tool=jjx-vscode-diff",
        ...diffConfigs.flatMap((c) => ["--config", c]),
        "-r",
        rev,
        "--",
        ...filesetArgs,
      ],
      {
        timeout: 10_000,
        cwd: this.repositoryRoot,
        env: { ...process.env, VSCODE_JJ_DIFF_REQUEST_ID: requestId },
      },
    );

    const { stdout: summaryOutput } = await collectProcessOutput(childProcess).catch(convertJJErrors);
    const summaryOutputStr = summaryOutput.toString();

    const { leftFiles } = await pathPromise;

    const summaryLines = summaryOutputStr.trim().split("\n");

    for (const summaryLineRaw of summaryLines) {
      const summaryLine = summaryLineRaw.trim();

      const type = summaryLine.charAt(0);
      const file = summaryLine.slice(2).trim();

      if (type === "M" || type === "D") {
        const normalizedSummaryPath = path.join(this.repositoryRoot, file).replace(/\\/g, "/");
        const normalizedTargetPath = path.normalize(filepath).replace(/\\/g, "/");
        if (pathEquals(normalizedSummaryPath, normalizedTargetPath)) {
          const content = leftFiles[file];
          if (content !== undefined) {
            return Buffer.from(content, "utf8");
          }
          return undefined;
        }
      } else if (type === "R" || type === "C") {
        const parseResult = parseRenamePaths(file);
        if (!parseResult) {
          throw new Error(`Unexpected rename line: ${summaryLineRaw}`);
        }

        const normalizedSummaryPath = path.join(this.repositoryRoot, parseResult.toPath).replace(/\\/g, "/");
        const normalizedTargetPath = path.normalize(filepath).replace(/\\/g, "/");
        if (pathEquals(normalizedSummaryPath, normalizedTargetPath)) {
          const content = leftFiles[parseResult.fromPath];
          if (content !== undefined) {
            return Buffer.from(content, "utf8");
          }
          return undefined;
        }
      }
    }

    // File was either added or unchanged in this revision.
    return undefined;
  }
}
