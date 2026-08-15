import path from "path";
import * as crypto from "crypto";
import * as vscode from "vscode";
import fs from "fs/promises";
import realFs from "fs";
import {
  SHOW_TEMPLATE,
  STATUS_TEMPLATE,
  LOG_TEMPLATE,
  buildLogTemplate,
  buildOperationTemplate,
  DIFF_STATS_TEMPLATE,
  BOOKMARK_TRACKING_INFO_TEMPLATE,
  REMOTE_REF_STATUS_TEMPLATE,
  CONFLICTED_FILES_TEMPLATE,
  WORKSPACE_LIST_TEMPLATE,
} from "./template-builder";
import spawn from "cross-spawn";
import type { ChildProcess } from "child_process";
import { ImmutableError, convertJJErrors } from "./errors";
import {
  spawnJJ,
  handleJJCommand,
  type SpawnOptions,
  collectProcessOutput,
  type ProcessOutput,
  ProcessError,
  CancelledError,
} from "./process";
import { parseRenamePaths } from "./parse-rename-paths";
import { parseFileStatuses, type ParsedFileStatuses, parseUntrackedFileStatuses } from "./parse-file-statuses";
import { parseInterdiffSummary } from "./parse-interdiff-summary";
import { logger } from "./logger";
import { quoteJjName } from "./quote";
import {
  changeIdFromLogEntry,
  decodeFileText,
  filepathToFileset,
  filepathToRootFileset,
  formatChangeIdShort,
  formatWorkingCopyTitle,
  isWindows,
  maxChangeIdPrefixLength,
  normalizePath,
  pathEquals,
} from "./utils";
import {
  getDiffToolConfigs,
  expectDiffToolRequest,
  getSquashToolConfigs,
  expectSquashToolRequest,
  completeSquashToolRequest,
  getSplitToolConfigs,
  expectSplitToolRequest,
  completeSplitToolRequest,
  consumeEditorSession,
  openRecoveredEditor,
} from "./jj-editor";
import { TIMEOUTS, type JJVersion, versionAtLeast, JJ_VERSION_WITH_TAG_TRACKING } from "./constants";
import { withDivergenceHandling } from "./divergence-handling";
import type {
  FileStatus,
  FileStatusType,
  RepositoryStatus,
  Show,
  Change,
  ChangeId,
  ChangeWithDetails,
  LogEntry,
  LogEntryLocalRef,
  LogEntryRemoteRef,
  ParentRef,
  Operation,
  DiffFileEntry,
  FullChangeId,
} from "./types";
import {
  SYMLINK_FILE_MODE,
  buildSplitFileEntry,
  reconstructRightModes,
  reconstructRightSides,
  type SplitCheckboxState,
  type SplitFileEntry,
} from "./split/hunk-model";

export type {
  FileStatus,
  FileStatusType,
  RepositoryStatus,
  Show,
  Change,
  ChangeId,
  ChangeWithDetails,
  LogEntry,
  LogEntryLocalRef,
  LogEntryRemoteRef,
  ParentRef,
  Operation,
  DiffFileEntry,
  SplitFileEntry,
};

export interface WorkspaceInfo {
  name: string;
  /** Absolute path of the workspace root, if it is recorded and resolvable. */
  root?: string;
}

export class JJRepository {
  statusCache: RepositoryStatus | undefined;
  gitFetchPromise: Promise<ProcessOutput> | undefined;
  private autoUpdateStaleAttempted = false;
  private _gitDirPromise: Promise<string> | undefined;

  /**
   * Cancellation sources for in-flight remote ref operations,
   * keyed by `<refType>:<name>`.
   */
  private readonly refCancellationSources = new Map<
    string,
    { source: vscode.CancellationTokenSource; operation: "push" | "delete" }
  >();

  constructor(
    public repositoryRoot: string,
    private jjPath: string,
    private jjConfigArgs: string[],
    private jjVersion: JJVersion | undefined,
  ) {}

  async getGitDir(): Promise<string> {
    if (!this._gitDirPromise) {
      this._gitDirPromise = this.jjCommandRead(["git", "root"]).then((buf) => buf.toString().trim());
    }
    return this._gitDirPromise;
  }

  private refCancellationKey(refType: "bookmark" | "tag", name: string): string {
    return `${refType}:${name}`;
  }

  /**
   * Runs a remote ref operation while registering a
   * cancellation source for the ref so it can be aborted via
   * {@link cancelRefOperation}. Cancelling the source kills the in-flight
   * `jj git push`/`git push` child process (see collectProcessOutput's token
   * handling). Only the outermost operation registers a source; callers that
   * already hold a token (e.g. the multi-remote push loops) pass it through
   * directly.
   */
  private async withRefCancellation<T>(
    refType: "bookmark" | "tag",
    name: string,
    operation: "push" | "delete",
    fn: (token: vscode.CancellationToken) => Promise<T>,
  ): Promise<T> {
    const source = new vscode.CancellationTokenSource();
    const key = this.refCancellationKey(refType, name);
    this.refCancellationSources.set(key, { source, operation });
    try {
      return await fn(source.token);
    } finally {
      // Only remove our source; a newer operation for the same ref may have replaced it.
      if (this.refCancellationSources.get(key)?.source === source) {
        this.refCancellationSources.delete(key);
      }
      source.dispose();
    }
  }

  /**
   * Cancels an in-flight remote ref operation of the given ref by killing the
   * running child process. Returns the operation kind if one was found and
   * cancelled, otherwise null.
   */
  cancelRefOperation(refType: "bookmark" | "tag", name: string): "push" | "delete" | null {
    const entry = this.refCancellationSources.get(this.refCancellationKey(refType, name));
    if (!entry) {
      return null;
    }
    entry.source.cancel();
    return entry.operation;
  }

  private parseFileStatuses(diffFiles: DiffFileEntry[], conflictedPaths: string[] | undefined): ParsedFileStatuses {
    return parseFileStatuses(diffFiles, conflictedPaths, this.repositoryRoot);
  }

  private async retryWithImmutable<T>(
    rev: FullChangeId | "@",
    operation: () => Promise<T>,
    retryOperation: () => Promise<T>,
    customMessage?: string,
    continueButtonText: string = "Continue",
  ): Promise<T | undefined> {
    try {
      return await operation();
    } catch (e) {
      if (e instanceof ImmutableError) {
        let message = customMessage;
        if (message === undefined) {
          const shortRev = await this.resolveRevSuffix(rev).catch(() => rev);
          message = `Change "${shortRev}" is immutable, are you sure?`;
        }
        const choice = await vscode.window.showWarningMessage(message, { modal: true }, continueButtonText);
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

  spawnJJRead(args: string[], options: SpawnOptions, operationId?: string) {
    // Reads always run at a fixed operation so they cannot reconcile divergent operation heads
    // (reconciliation writes a new operation, which can cascade when several instances share the
    // repository). When no operationId is given, pin to "@" — this still loads the head operation
    // but never merges divergent heads; the resulting DivergentOperationsError is handled
    // centrally by runReadWithDivergenceHandling.
    const atOp = operationId ?? "@";
    return this.spawnJJ(["--ignore-working-copy", `--at-operation=${atOp}`, ...args], options);
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

  private jjCommandRead(
    args: string[],
    options?: { token?: vscode.CancellationToken; timeout?: number },
    operationId?: string,
  ) {
    if (operationId) {
      // Explicit pin: the read cannot diverge, so no retry/backoff is needed.
      return handleJJCommand(
        this.spawnJJRead(args, { timeout: options?.timeout, cwd: this.repositoryRoot }, operationId),
        options?.token,
      );
    }
    // Unpinned read: spawnJJRead defaults to --at-operation=@, which never reconciles.
    // Reconciliation of divergent operations is handled separately to prevent
    // reconciliation cascades on shared repositories.
    return this.runReadWithDivergenceHandling(args, options);
  }

  /**
   * Randomized delay used before re-checking or reconciling divergent operation heads. The
   * randomization breaks the phase-lock between multiple jjx instances sharing one repository, so
   * their reconciliations cannot sustain a cascade. Resolves early if the token is cancelled.
   */
  private jitteredDelay(maxDelayMs: number, token?: vscode.CancellationToken): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        disposable?.dispose();
        resolve();
      }, Math.random() * maxDelayMs);
      const disposable = token?.onCancellationRequested(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Runs an unpinned read with central handling of divergent operation heads. The read is first
   * attempted at --at-operation=@ (see spawnJJRead), which never writes an operation. If the heads
   * are divergent, the read is retried after a jittered backoff — usually another process sharing
   * the repository will have reconciled by then, so this instance writes nothing. If the heads are
   * still divergent after the retry, exactly one reconcile is performed by issuing the read without
   * --at-operation, which makes jj merge the divergent heads into a new operation.
   */
  private runReadWithDivergenceHandling(
    args: string[],
    options: { token?: vscode.CancellationToken; timeout?: number } = {},
  ): Promise<Buffer> {
    const token = options.token;
    const spawnOpts = { timeout: options.timeout, cwd: this.repositoryRoot };
    return withDivergenceHandling(
      () => handleJJCommand(this.spawnJJRead(args, spawnOpts), token),
      () => {
        logger.info(`Reconciling divergent operations after retries for: jj ${args.join(" ")}`);
        return handleJJCommand(this.spawnJJ(["--ignore-working-copy", ...args], spawnOpts), token);
      },
      (maxDelayMs) => this.jitteredDelay(maxDelayMs, token),
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
   * Note: when called with `ignoreWorkingCopy: false`, this command may itself snapshot the working copy and add an
   * operation to the log, in which case it will return the new operation id.
   *
   * The command is run with `--at-operation=@` first, which loads the current operation head without reconciling
   * divergent operation heads (reconciliation writes a new operation, which can cascade when several instances share
   * the repository). If the heads have diverged, withDivergenceHandling backs off and retries before reconciling.
   */
  async getLatestOperationId(ignoreWorkingCopy: boolean = true, token?: vscode.CancellationToken) {
    const args = ["operation", "log", "--limit", "1", "-T", "self.id()", "--no-graph"];
    const attemptArgs = ignoreWorkingCopy
      ? ["--ignore-working-copy", "--at-operation=@", ...args]
      : ["--at-operation=@", ...args];
    const reconcileArgs = ignoreWorkingCopy ? ["--ignore-working-copy", ...args] : args;
    const buf = await withDivergenceHandling(
      () => handleJJCommand(this.spawnJJ(attemptArgs, { cwd: this.repositoryRoot }), token),
      () => handleJJCommand(this.spawnJJ(reconcileArgs, { cwd: this.repositoryRoot }), token),
      (maxDelayMs) => this.jitteredDelay(maxDelayMs, token),
    );
    return buf.toString().trim();
  }

  async getStatus(useCache = false, token?: vscode.CancellationToken, operationId?: string): Promise<RepositoryStatus> {
    if (useCache && this.statusCache) {
      return this.statusCache;
    }

    const output = (
      await this.jjCommandRead(["log", "-r", "@", "-T", STATUS_TEMPLATE, "--no-graph"], { token }, operationId)
    ).toString();

    const entry = JSON.parse(output.trim()) as {
      change_id: string;
      change_id_shortest: string;
      commit_id: string;
      divergent: boolean;
      change_offset: string;
      description: string;
      empty: boolean;
      conflict: boolean;
      local_bookmarks: string[];
      parents: Array<{
        change_id: string;
        change_id_shortest: string;
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

    const untrackedFiles = await this.getUntrackedFiles(token);

    const maxPrefixLength = maxChangeIdPrefixLength([
      entry.change_id_shortest,
      ...entry.parents.map((p) => p.change_id_shortest),
    ]);

    const workingCopy: Change = {
      changeId: changeIdFromLogEntry(entry, maxPrefixLength),
      commitId: entry.commit_id,
      description: entry.description,
      isEmpty: entry.empty,
      isConflict: entry.conflict,
      bookmarks: entry.local_bookmarks,
      divergent: entry.divergent,
    };

    const parentChanges: Change[] = entry.parents.map((p) => ({
      changeId: changeIdFromLogEntry(p, maxPrefixLength),
      commitId: p.commit_id,
      description: p.description,
      isEmpty: p.empty,
      isConflict: p.conflict,
      bookmarks: p.local_bookmarks,
      divergent: p.divergent,
    }));

    const status: RepositoryStatus = {
      workingCopy,
      parentChanges,
      fileStatuses,
      untrackedFiles,
      conflictedFiles,
    };

    this.statusCache = status;
    return status;
  }

  async fileList(token?: vscode.CancellationToken, operationId?: string) {
    return (await this.jjCommandRead(["file", "list"], { token }, operationId)).toString().trim().split("\n");
  }

  /**
   * Returns the untracked files in the working copy, parsed from the
   * "Untracked paths:" section of `jj status`. Unlike the diff-based status,
   * this requires snapshotting the working copy (no `--ignore-working-copy`),
   * since untracked files (e.g. files exceeding the max file size, or excluded
   * by `snapshot.auto-track`) are only surfaced by the snapshot.
   */
  async getUntrackedFiles(token?: vscode.CancellationToken): Promise<FileStatus[]> {
    const output = (await this.jjCommand(["status"], { token })).toString();
    return parseUntrackedFileStatuses(output, this.repositoryRoot);
  }

  /**
   * Tracks the given paths in the working copy via `jj file track
   * --include-ignored`, which tracks files regardless of size or ignore rules.
   *
   * Uses a path-prefix fileset (`root:"..."`) rather than the exact-file
   * `file:"..."` form, so that untracked directories are tracked recursively.
   */
  async fileTrack(filepaths: string[]): Promise<Buffer> {
    const relativePaths = filepaths.map((filepath) =>
      filepathToRootFileset(path.relative(this.repositoryRoot, filepath).replace(/\\/g, "/")),
    );
    return this.jjCommand(["file", "track", "--include-ignored", "--", ...relativePaths]);
  }

  async show(rev: string, token?: vscode.CancellationToken, operationId?: string) {
    const results = await this.showAll([rev], token, operationId);
    if (results.length > 1) {
      throw new Error("Multiple results found for the given revision.");
    }
    if (results.length === 0) {
      throw new Error("No results found for the given revision.");
    }
    return results[0];
  }

  async resolveRevSuffix(rev: string): Promise<string> {
    if (rev === "@") {
      return formatWorkingCopyTitle();
    }
    const { change } = await this.show(rev);
    return formatChangeIdShort(change.changeId);
  }

  async showAll(revsets: string[], token?: vscode.CancellationToken, operationId?: string) {
    const output = (
      await this.jjCommandRead(
        ["log", "-T", SHOW_TEMPLATE, "--no-graph", ...revsets.flatMap((revset) => ["-r", revset])],
        { token },
        operationId,
      )
    ).toString();

    if (!output.trim()) {
      throw new Error("No output from jj log. Maybe the revision couldn't be found?");
    }

    const entries = output
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        return JSON.parse(line) as {
          change_id: string;
          change_id_shortest: string;
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
      });

    const maxPrefixLength = maxChangeIdPrefixLength(entries.map((e) => e.change_id_shortest));

    return entries.map((entry) => {
      const { fileStatuses, conflictedFiles } = this.parseFileStatuses(entry.diff_files, entry.conflicted_files);

      return {
        change: {
          changeId: changeIdFromLogEntry(entry, maxPrefixLength),
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
        },
        fileStatuses,
        conflictedFiles,
      };
    });
  }

  readFile(rev: string, filepath: string) {
    filepath = resolveRealpath(filepath);
    const relativePath = path.relative(this.repositoryRoot, filepath).replace(/\\/g, "/");
    return this.jjCommandRead(["file", "show", "--revision", rev, filepathToFileset(relativePath)]);
  }

  async describeRetryImmutable(rev: FullChangeId | "@", message?: string) {
    return this.withEditorRecovery((sessionId) =>
      this.retryWithImmutable(
        rev,
        () => this.describe(rev, message, false, sessionId),
        () => this.describe(rev, message, true, sessionId),
        undefined,
        "Describe Immutable Change",
      ),
    );
  }

  private async describe(rev: FullChangeId | "@", message?: string, ignoreImmutable = false, sessionId?: string) {
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
    fromRevs,
    toRev,
    message,
    filepaths,
  }: {
    fromRevs: (FullChangeId | "@")[];
    toRev: FullChangeId | "@";
    message?: string;
    filepaths?: string[];
  }) {
    return this.retryWithImmutable(
      toRev,
      () =>
        this.squash({
          fromRevs,
          toRev,
          message,
          filepaths,
        }),
      () =>
        this.squash({
          fromRevs,
          toRev,
          message,
          filepaths,
          ignoreImmutable: true,
        }),
      undefined,
      "Squash Into Immutable Change",
    );
  }

  private async squash({
    fromRevs,
    toRev,
    message,
    filepaths,
    ignoreImmutable = false,
  }: {
    fromRevs: (FullChangeId | "@")[];
    toRev: FullChangeId | "@";
    message?: string;
    filepaths?: string[];
    ignoreImmutable?: boolean;
  }) {
    const fromRev = fromRevs.join("|");
    return (
      await this.jjCommand(
        [
          "squash",
          "--from",
          fromRev,
          "--into",
          toRev,
          ...(message ? ["-m", message] : []),
          ...(filepaths
            ? filepaths.map((filepath) =>
                filepathToFileset(path.relative(this.repositoryRoot, filepath).replace(/\\/g, "/")),
              )
            : []),
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
    fromRev: FullChangeId | "@";
    toRev: FullChangeId;
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
      undefined,
      "Squash Into Immutable Change",
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
    fromRev: FullChangeId | "@";
    toRev: FullChangeId;
    filepath: string;
    content: string;
    ignoreImmutable?: boolean;
  }): Promise<void> {
    filepath = resolveRealpath(filepath);

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
        env: { VSCODE_JJ_SQUASH_REQUEST_ID: requestId },
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

  async splitChangeRetryImmutable({ commitId, state }: { commitId: string; state: SplitCheckboxState }) {
    return this.retryWithImmutable(
      commitId as FullChangeId,
      () => this.splitChange({ commitId, state }),
      () => this.splitChange({ commitId, state, ignoreImmutable: true }),
      undefined,
      "Split Immutable Change",
    );
  }

  /**
   * Splits the commit `commitId` into two commits: the changes selected in the Split view
   * (`state`) go into the first commit and the remainder into the second. The interactive
   * selection already happened in the webview, so the `jjx-vscode-split` tool phase only
   * writes the reconstructed right side into the diff tool's directories; without `-m`, jj
   * afterwards opens the integrated description editors for the resulting commits.
   *
   * @param options.commitId - Full commit id of the commit to split, pinning the content the
   * selection was made against.
   * @param options.state - Checkbox state confirmed in the Split view.
   * @param options.ignoreImmutable - Retry flag allowing the split of an immutable commit.
   */
  async splitChange({
    commitId,
    state,
    ignoreImmutable = false,
  }: {
    commitId: string;
    state: SplitCheckboxState;
    ignoreImmutable?: boolean;
  }): Promise<void> {
    const splitConfigs = getSplitToolConfigs();
    if (!splitConfigs.length) {
      throw new Error("Split tool not initialized.");
    }

    const requestId = crypto.randomUUID();
    const pathPromise = expectSplitToolRequest(requestId);

    const childProcess = this.spawnJJ(
      [
        "split",
        "-r",
        commitId,
        ...(ignoreImmutable ? ["--ignore-immutable"] : []),
        "--tool=jjx-vscode-split",
        ...splitConfigs.flatMap((c) => ["--config", c]),
      ],
      {
        // No timeout: after the diff-tool phase jj opens its interactive description editors,
        // which must not be killed while the user is writing the commit messages. The
        // Promise.race against jjExit below already covers jj dying before the tool runs.
        timeout: 0,
        cwd: this.repositoryRoot,
        env: { VSCODE_JJ_SPLIT_REQUEST_ID: requestId },
      },
    );

    const jjExit = collectProcessOutput(childProcess)
      .catch(convertJJErrors)
      .then(() => {});

    try {
      // If jj exits before invoking the split tool (e.g. the commit is immutable or was
      // abandoned meanwhile), surface its error instead of waiting for a tool request forever.
      const { leftPath, rightPath } = await Promise.race([
        pathPromise,
        jjExit.then(() => {
          throw new Error("jj split finished before the split tool was invoked");
        }),
      ]);

      const leftFolderAbsolutePath = path.isAbsolute(leftPath) ? leftPath : path.join(this.repositoryRoot, leftPath);
      const rightFolderAbsolutePath = path.isAbsolute(rightPath)
        ? rightPath
        : path.join(this.repositoryRoot, rightPath);

      const entries = (await this.getSplitFileEntries(commitId)).map((entry) =>
        buildSplitFileEntry({
          path: entry.path,
          status: entry.status,
          renamedFrom: entry.renamedFrom,
          binary: entry.binary,
          conflict: entry.conflict,
          modeChangedFrom: entry.modeChangedFrom,
          modeChangedTo: entry.modeChangedTo,
          left: entry.leftBase64 !== undefined ? Buffer.from(entry.leftBase64, "base64") : undefined,
          right: entry.rightBase64 !== undefined ? Buffer.from(entry.rightBase64, "base64") : undefined,
        }),
      );
      const rightSides = reconstructRightSides(entries, state);
      const rightModes = reconstructRightModes(entries, state);

      // The unchecked side is the parent state by construction: start from the left directory
      // and write the reconstructed right contents on top of it.
      await fs.rm(rightFolderAbsolutePath, { recursive: true, force: true });
      await fs.mkdir(rightFolderAbsolutePath, { recursive: true });
      await fs.cp(leftFolderAbsolutePath, rightFolderAbsolutePath, {
        recursive: true,
      });
      for (const [filePath, content] of rightSides) {
        const relativePath = (
          path.isAbsolute(filePath) ? path.relative(this.repositoryRoot, filePath) : filePath
        ).replace(/\\/g, "/");
        const target = path.join(rightFolderAbsolutePath, relativePath);
        // jj creates the diff-edit files read-only, so replace them instead of truncating.
        await fs.rm(target, { force: true });
        if (content === undefined) {
          continue;
        }
        await fs.mkdir(path.dirname(target), { recursive: true });
        const mode = rightModes.get(relativePath);
        if (mode === SYMLINK_FILE_MODE) {
          // A symlink's content is its target string: recreate the link itself, since the
          // git-style type bits cannot be applied to a regular file by a chmod.
          await fs.symlink(content.toString("utf8"), target);
          continue;
        }
        await fs.writeFile(target, content);
        // A selected mode change (or the restored old mode of a deselected one) is applied on
        // top; the permission bits carry it, the git-style type bits do not survive a chmod.
        if (mode !== undefined) {
          await fs.chmod(target, parseInt(mode, 8) & 0o777);
        }
      }

      completeSplitToolRequest(requestId, true);
    } catch (error) {
      completeSplitToolRequest(requestId, false);
      throw error;
    }

    await jjExit;
  }

  async log(
    rev: string,
    limit: number = 100,
    opts?: { includeFiles?: boolean },
    operationId?: string,
  ): Promise<LogEntry[]> {
    const template = opts?.includeFiles ? buildLogTemplate({ includeFiles: true }) : LOG_TEMPLATE;
    const output = (
      await this.jjCommandRead(["log", "-r", rev, "-n", limit.toString(), "-T", template], undefined, operationId)
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

    if (opts?.includeFiles) {
      for (const entry of entries) {
        entry.fileStatuses = parseFileStatuses(
          entry.diff_files ?? [],
          entry.conflicted_files ?? [],
          this.repositoryRoot,
        ).fileStatuses;
      }
    }

    return entries;
  }

  async getDiffStats(
    changeId: FullChangeId,
  ): Promise<{ filesChanged: number; linesAdded: number; linesRemoved: number }> {
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

  async editRetryImmutable(rev: FullChangeId | "@") {
    return this.retryWithImmutable(
      rev,
      () => this.edit(rev),
      () => this.edit(rev, true),
      undefined,
      "Edit Immutable Change",
    );
  }

  private async edit(rev: FullChangeId | "@", ignoreImmutable = false) {
    return this.jjCommand(["edit", "-r", rev, ...(ignoreImmutable ? ["--ignore-immutable"] : [])]);
  }

  async moveBookmark(bookmark: string, targetRev: string, allowBackwards = false) {
    return this.jjCommand([
      "bookmark",
      "move",
      quoteJjName(bookmark),
      "-t",
      targetRev,
      ...(allowBackwards ? ["--allow-backwards"] : []),
    ]);
  }

  async createBookmark(bookmark: string, targetRev: string) {
    return this.jjCommand(["bookmark", "create", quoteJjName(bookmark), "-r", targetRev]);
  }

  async createTag(tag: string, targetRev: string) {
    return this.jjCommand(["tag", "set", quoteJjName(tag), "-r", targetRev]);
  }

  async deleteBookmark(bookmark: string) {
    return this.jjCommand(["bookmark", "delete", quoteJjName(bookmark)]);
  }

  async pushBookmark(bookmark: string): Promise<string[]> {
    const remotes = await this.getBookmarkTrackingRemotes(bookmark, true);
    if (remotes.length === 0) {
      return [];
    }
    const pushedRemotes: string[] = [];
    const failedRemoteErrors: string[] = [];
    let cancelled = false;
    await this.withRefCancellation("bookmark", bookmark, "push", async (token) => {
      for (const remote of remotes) {
        if (token.isCancellationRequested) {
          cancelled = true;
          break;
        }
        try {
          await this.pushBookmarkToRemote(bookmark, remote, token);
          pushedRemotes.push(remote);
        } catch (e) {
          if (token.isCancellationRequested || e instanceof CancelledError) {
            cancelled = true;
            break;
          }
          const reason = e instanceof ProcessError ? e.stderr : e instanceof Error ? e.message : String(e);
          failedRemoteErrors.push(`${remote}: ${reason}`);
        }
      }
    });
    if (cancelled) {
      throw new CancelledError();
    }
    if (failedRemoteErrors.length > 0) {
      throw new Error(`Failed to push bookmark "${bookmark}":\n${failedRemoteErrors.join("\n")}`);
    }
    return pushedRemotes;
  }

  async getBookmarksWithUnsyncedNonGitRemotes(operationId?: string): Promise<Set<string>> {
    const output = (
      await this.jjCommandRead(
        ["bookmark", "list", "-T", `if(remote != "" && tracked && !synced && remote != "git", name ++ "\\n", "")`],
        undefined,
        operationId,
      )
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
        quoteJjName(bookmark),
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
      this.jjCommandRead([
        "bookmark",
        "list",
        "--all-remotes",
        quoteJjName(bookmark),
        "-T",
        BOOKMARK_TRACKING_INFO_TEMPLATE,
      ]),
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
    await this.jjCommand(["bookmark", "track", quoteJjName(bookmark), `--remote=${remote}`]);
  }

  async untrackBookmark(bookmark: string, remote: string): Promise<void> {
    await this.jjCommand(["bookmark", "untrack", quoteJjName(bookmark), `--remote=${remote}`]);
  }

  async pushBookmarkToRemote(bookmark: string, remote: string, token?: vscode.CancellationToken): Promise<void> {
    const run = (t: vscode.CancellationToken) =>
      this.jjCommand(["git", "push", "--bookmark", quoteJjName(bookmark), "--remote", remote], {
        token: t,
        timeout: TIMEOUTS.GIT_FETCH,
      });
    if (token) {
      // Caller (e.g. pushBookmark loop) owns the cancellation source.
      await run(token);
      return;
    }
    await this.withRefCancellation("bookmark", bookmark, "push", run);
  }

  /**
   * Deletes a bookmark from a remote.
   * Expects the local bookmark to already be gone.
   */
  async deleteBookmarkFromRemote(bookmark: string, remote: string, token?: vscode.CancellationToken): Promise<void> {
    const run = (t: vscode.CancellationToken) =>
      this.jjCommand(["git", "push", "--bookmark", quoteJjName(bookmark), "--remote", remote], {
        token: t,
        timeout: TIMEOUTS.GIT_FETCH,
      });
    if (token) {
      await run(token);
      return;
    }
    await this.withRefCancellation("bookmark", bookmark, "delete", run);
  }

  async deleteTag(tag: string) {
    return this.jjCommand(["tag", "delete", quoteJjName(tag)]);
  }

  async getRemotes(): Promise<string[]> {
    const output = await this.jjCommandRead(["git", "remote", "list"]);
    return this.splitLines(output).map((line) => line.split(/\s+/)[0]);
  }

  /**
   * jj 0.44 introduced tag tracking on remotes (`jj tag track`/`untrack` and
   * `jj git push --tag`), mirroring bookmark tracking. When this is false, tags
   * fall back to being pushed directly via `git push`.
   */
  supportsTagTracking(): boolean {
    return !!this.jjVersion && versionAtLeast(this.jjVersion, JJ_VERSION_WITH_TAG_TRACKING);
  }

  async pushTagToRemote(tag: string, remote: string, token?: vscode.CancellationToken): Promise<void> {
    if (this.supportsTagTracking()) {
      const run = async (t: vscode.CancellationToken) => {
        await this.jjCommand(["tag", "track", quoteJjName(tag), `--remote=${remote}`], { token: t });
        await this.jjCommand(["git", "push", "--tag", quoteJjName(tag), "--remote", remote], {
          token: t,
          timeout: TIMEOUTS.GIT_FETCH,
        });
      };
      if (token) {
        await run(token);
        return;
      }
      await this.withRefCancellation("tag", tag, "push", run);
      return;
    }
    const gitDir = await this.getGitDir();
    const run = (t: vscode.CancellationToken) =>
      collectProcessOutput(
        spawn("git", ["push", remote, tag], {
          cwd: this.repositoryRoot,
          env: { ...process.env, GIT_DIR: gitDir },
        }),
        t,
      );
    if (token) {
      await run(token);
      return;
    }
    await this.withRefCancellation("tag", tag, "push", run);
  }

  /**
   * Deletes a tag from a remote. On jj 0.44+ this is the same push command as a
   * normal push (a locally-deleted tag is removed from the remote on push).
   * On older jj versions the tag is deleted directly via `git push --delete`.
   */
  async deleteTagFromRemote(tag: string, remote: string, token?: vscode.CancellationToken): Promise<void> {
    const run = async (t: vscode.CancellationToken) => {
      if (this.supportsTagTracking()) {
        await this.jjCommand(["git", "push", "--tag", quoteJjName(tag), "--remote", remote], {
          token: t,
          timeout: TIMEOUTS.GIT_FETCH,
        });
        return;
      }
      const gitDir = await this.getGitDir();
      await collectProcessOutput(
        spawn("git", ["push", "--delete", remote, tag], {
          cwd: this.repositoryRoot,
          env: { ...process.env, GIT_DIR: gitDir },
        }),
        t,
      );
    };
    if (token) {
      await run(token);
      return;
    }
    await this.withRefCancellation("tag", tag, "delete", run);
  }

  /**
   * Recreates a locally-deleted bookmark or tag by pointing it at the ref still
   * present on the given remote (`<name>@<remote>`).
   */
  async restoreRemoteRef(type: "bookmark" | "tag", name: string, remote: string): Promise<void> {
    const command = type === "bookmark" ? "bookmark" : "tag";
    const target = `${quoteJjName(name)}@${remote}`;
    await this.jjCommand([command, "set", quoteJjName(name), "-r", target]);
  }

  /**
   * Queries the tracking/sync status of a single remote bookmark or tag, plus
   * whether the corresponding local ref is present (exists and points at a
   * commit). Used to decide which action (if any) to offer when right-clicking
   * a remote ref pill. Returns null when the remote ref cannot be found.
   */
  async getRemoteRefStatus(
    type: "bookmark" | "tag",
    name: string,
    remote: string,
  ): Promise<{ tracked: boolean; synced: boolean; present: boolean } | null> {
    const command = type === "bookmark" ? "bookmark" : "tag";
    const entries = this.splitLines(
      await this.jjCommandRead([command, "list", "--all-remotes", quoteJjName(name), "-T", REMOTE_REF_STATUS_TEMPLATE]),
    ).map((line) => JSON.parse(line) as { remote: string; tracked: boolean; synced: boolean; present: boolean });
    const remoteEntry = entries.find((e) => e.remote === remote);
    if (!remoteEntry) {
      return null;
    }
    const localEntry = entries.find((e) => e.remote === "");
    return {
      tracked: remoteEntry.tracked,
      synced: remoteEntry.synced,
      present: localEntry ? localEntry.present : false,
    };
  }

  async getTagsWithUnsyncedNonGitRemotes(operationId?: string): Promise<Set<string>> {
    const output = (
      await this.jjCommandRead(
        ["tag", "list", "-T", `if(remote != "" && tracked && !synced && remote != "git", name ++ "\\n", "")`],
        undefined,
        operationId,
      )
    )
      .toString()
      .trim();
    if (!output) {
      return new Set();
    }
    return new Set(this.splitLines(output));
  }

  async getTagTrackingRemotes(tag: string, unsyncedOnly = false): Promise<string[]> {
    const filter = unsyncedOnly ? "tracked && !synced" : "tracked";
    const output = (
      await this.jjCommandRead([
        "tag",
        "list",
        "--all-remotes",
        quoteJjName(tag),
        "-T",
        `if(remote != "", if(${filter}, remote ++ "\\n", ""), "")`,
      ])
    )
      .toString()
      .trim();
    return this.splitLines(output).filter((r) => r !== "git");
  }

  /**
   * For jj 0.44+ (tag tracking), returns the remotes a local tag can be pushed
   * to: every remote where `<tag>@<remote>` is not synced.
   */
  async getTagTrackingInfo(tag: string): Promise<{ pushRemotes: string[] }> {
    const [trackingOutput, remotesOutput] = await Promise.all([
      this.jjCommandRead(["tag", "list", "--all-remotes", quoteJjName(tag), "-T", BOOKMARK_TRACKING_INFO_TEMPLATE]),
      this.jjCommandRead(["git", "remote", "list"]),
    ]);
    const syncedRemotes = new Set(
      this.splitLines(trackingOutput)
        .map((line) => JSON.parse(line) as { remote: string; tracked: boolean; synced: boolean })
        .filter((e) => e.remote !== "" && e.remote !== "git" && e.synced)
        .map((e) => e.remote),
    );
    const allRemotes = this.splitLines(remotesOutput).map((line) => line.split(/\s+/)[0]);
    const pushRemotes = allRemotes.filter((r) => !syncedRemotes.has(r));
    return { pushRemotes };
  }

  async trackTag(tag: string, remote: string): Promise<void> {
    await this.jjCommand(["tag", "track", quoteJjName(tag), `--remote=${remote}`]);
  }

  async untrackTag(tag: string, remote: string): Promise<void> {
    await this.jjCommand(["tag", "untrack", quoteJjName(tag), `--remote=${remote}`]);
  }

  async pushTag(tag: string): Promise<string[]> {
    const remotes = await this.getTagTrackingRemotes(tag, true);
    if (remotes.length === 0) {
      return [];
    }
    const pushedRemotes: string[] = [];
    const failedRemoteErrors: string[] = [];
    let cancelled = false;
    await this.withRefCancellation("tag", tag, "push", async (token) => {
      for (const remote of remotes) {
        if (token.isCancellationRequested) {
          cancelled = true;
          break;
        }
        try {
          await this.pushTagToRemote(tag, remote, token);
          pushedRemotes.push(remote);
        } catch (e) {
          if (token.isCancellationRequested || e instanceof CancelledError) {
            cancelled = true;
            break;
          }
          const reason = e instanceof ProcessError ? e.stderr : e instanceof Error ? e.message : String(e);
          failedRemoteErrors.push(`${remote}: ${reason}`);
        }
      }
    });
    if (cancelled) {
      throw new CancelledError();
    }
    if (failedRemoteErrors.length > 0) {
      throw new Error(`Failed to push tag "${tag}":\n${failedRemoteErrors.join("\n")}`);
    }
    return pushedRemotes;
  }

  async absorb(fromRev: string) {
    return await collectProcessOutput(
      this.spawnJJ(["absorb", "-f", fromRev], { timeout: TIMEOUTS.DEFAULT, cwd: this.repositoryRoot }),
    );
  }

  async abandonRetryImmutable(rev: FullChangeId, customMessage?: string) {
    return this.retryWithImmutable(
      rev,
      () => this.abandon([rev]),
      () => this.abandon([rev], true),
      customMessage,
      "Abandon Immutable Change",
    );
  }

  async abandonRetryImmutableMultiple(revs: FullChangeId[], customMessage?: string) {
    return this.retryWithImmutable(
      revs[0] ?? "@", // ignored because custom_message is set
      () => this.abandon(revs),
      () => this.abandon(revs, true),
      customMessage,
      "Abandon Immutable Changes",
    );
  }

  async getCommitUrl(changeId: FullChangeId): Promise<string | null> {
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

  private async abandon(revs: FullChangeId[], ignoreImmutable = false) {
    const revset = revs.join("|");
    return this.jjCommand(["abandon", "-r", revset, ...(ignoreImmutable ? ["--ignore-immutable"] : [])]);
  }

  private async rebase(
    sources: FullChangeId[],
    destination: FullChangeId,
    mode: "onto" | "after" | "before",
    withDescendants = false,
    ignoreImmutable = false,
  ) {
    const source = sources.join("|");
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
    sources: FullChangeId[],
    destination: FullChangeId,
    mode: "onto" | "after" | "before",
    withDescendants = false,
  ) {
    return this.retryWithImmutable(
      sources[0] ?? "@",
      () => this.rebase(sources, destination, mode, withDescendants),
      () => this.rebase(sources, destination, mode, withDescendants, true),
      "This rebase modifies one or more immutable commits, are you sure?",
      "Modify Immutable Change",
    );
  }

  private async rebaseAddParent(source: FullChangeId, destination: FullChangeId, ignoreImmutable = false) {
    return this.jjCommand([
      "rebase",
      "--source",
      source,
      "--onto",
      `parents(${source})`,
      "--onto",
      destination,
      ...(ignoreImmutable ? ["--ignore-immutable"] : []),
    ]);
  }

  async rebaseAddParentRetryImmutable(source: FullChangeId, destination: FullChangeId) {
    return this.retryWithImmutable(
      source,
      () => this.rebaseAddParent(source, destination),
      () => this.rebaseAddParent(source, destination, true),
      "This rebase modifies one or more immutable commits, are you sure?",
      "Modify Immutable Change",
    );
  }

  private async rebaseRemoveParent(source: FullChangeId, target: FullChangeId, ignoreImmutable = false) {
    return this.jjCommand([
      "rebase",
      "--source",
      source,
      "--onto",
      `parents(${source}) ~ ${target}`,
      ...(ignoreImmutable ? ["--ignore-immutable"] : []),
    ]);
  }

  async rebaseRemoveParentRetryImmutable(source: FullChangeId, target: FullChangeId) {
    return this.retryWithImmutable(
      source,
      () => this.rebaseRemoveParent(source, target),
      () => this.rebaseRemoveParent(source, target, true),
      "This rebase modifies one or more immutable commits, are you sure?",
      "Modify Immutable Change",
    );
  }

  private async duplicate(
    sources: FullChangeId[],
    destination: FullChangeId,
    mode: "onto" | "after" | "before",
    ignoreImmutable = false,
  ) {
    const source = sources.join("|");
    const flag = mode === "onto" ? "-o" : mode === "after" ? "-A" : "-B";
    return this.jjCommand([
      "duplicate",
      "-r",
      source,
      flag,
      destination,
      ...(ignoreImmutable ? ["--ignore-immutable"] : []),
    ]);
  }

  async duplicateRetryImmutable(sources: FullChangeId[], destination: FullChangeId, mode: "onto" | "after" | "before") {
    return this.retryWithImmutable(
      sources[0] ?? "@",
      () => this.duplicate(sources, destination, mode),
      () => this.duplicate(sources, destination, mode, true),
      "This duplicate modifies one or more immutable commits, are you sure?",
      "Modify Immutable Change",
    );
  }

  private async revert(
    sources: FullChangeId[],
    destination: FullChangeId,
    mode: "onto" | "after" | "before",
    ignoreImmutable = false,
  ) {
    const source = sources.join("|");
    const flag = mode === "onto" ? "-o" : mode === "after" ? "-A" : "-B";
    return this.jjCommand([
      "revert",
      "-r",
      source,
      flag,
      destination,
      ...(ignoreImmutable ? ["--ignore-immutable"] : []),
    ]);
  }

  async revertRetryImmutable(sources: FullChangeId[], destination: FullChangeId, mode: "onto" | "after" | "before") {
    return this.retryWithImmutable(
      sources[0] ?? "@",
      () => this.revert(sources, destination, mode),
      () => this.revert(sources, destination, mode, true),
      "This revert modifies one or more immutable commits, are you sure?",
      "Modify Immutable Change",
    );
  }

  async restoreRetryImmutable(rev?: FullChangeId | "@", filepaths?: string[]) {
    return this.retryWithImmutable(
      rev ?? "@",
      () => this.restore(rev, filepaths),
      () => this.restore(rev, filepaths, true),
      undefined,
      "Modify Immutable Change",
    );
  }

  private async restore(rev?: FullChangeId | "@", filepaths?: string[], ignoreImmutable = false) {
    return this.jjCommand([
      "restore",
      "--changes-in",
      rev ? rev : "@",
      ...(filepaths
        ? filepaths.map((filepath) =>
            filepathToFileset(path.relative(this.repositoryRoot, filepath).replace(/\\/g, "/")),
          )
        : []),
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

  private workspacesCache: { operationId: string; workspaces: WorkspaceInfo[] } | undefined;

  async listWorkspaces(operationId?: string): Promise<WorkspaceInfo[]> {
    if (operationId && this.workspacesCache?.operationId === operationId) {
      return this.workspacesCache.workspaces;
    }
    const output = (
      await this.jjCommandRead(["workspace", "list", "-T", WORKSPACE_LIST_TEMPLATE], undefined, operationId)
    ).toString();
    const workspaces = output
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .flatMap((line) => {
        try {
          const workspace = JSON.parse(line) as { name: string; root: string };
          return [{ name: workspace.name, ...(workspace.root ? { root: workspace.root } : {}) }];
        } catch {
          // jj 0.40–0.43 render `self.root()` evaluation failures inline (e.g.
          // "<Error: Failed to resolve workspace root: ...>"), which breaks the
          // JSON line for workspaces whose root is unrecorded or stale. Skip
          // such lines instead of failing the whole listing.
          return [];
        }
      });
    if (operationId) {
      this.workspacesCache = { operationId, workspaces };
    }
    return workspaces;
  }

  async getWorkspaceRoot(name: string, operationId?: string): Promise<string | undefined> {
    // `jj workspace list` templates cannot report this reliably: on jj 0.44+
    // `self.root()` silently renders empty when the recorded root is stale or
    // was never recorded (workspaces created before jj 0.38), on jj 0.40–0.43
    // it breaks the output with an inline error, and on jj 0.38–0.39 it doesn't
    // exist at all. `jj workspace root --name` (jj's strict diagnostics) fails
    // loudly instead, and prints an absolute path on jj 0.40+.
    let root: string;
    try {
      root = (await this.jjCommandRead(["workspace", "root", "--name", name], undefined, operationId)).toString();
    } catch {
      // No such workspace, or its root is unrecorded/unresolvable.
      return undefined;
    }
    root = root.trim();
    // jj 0.38–0.39 print a path relative to the repo's .jj directory, which
    // cannot be resolved reliably (and must never be used for deletion).
    return path.isAbsolute(root) ? root : undefined;
  }

  async getCurrentWorkspaceName(operationId?: string): Promise<string | undefined> {
    const workspaces = await this.listWorkspaces(operationId);
    for (const workspace of workspaces) {
      if (!workspace.root) {
        continue;
      }
      if (pathEquals(workspace.root, this.repositoryRoot)) {
        return workspace.name;
      }
      // The recorded root may contain symlinks that the (canonicalized)
      // repository root doesn't, e.g. /tmp vs /private/tmp on macOS.
      try {
        if (pathEquals(realFs.realpathSync.native(workspace.root), this.repositoryRoot)) {
          return workspace.name;
        }
      } catch {
        // Unresolvable path (e.g. the workspace directory was moved) — skip.
      }
    }
    return undefined;
  }

  async forgetWorkspace(name: string): Promise<void> {
    await this.jjCommand(["workspace", "forget", name]);
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
    filepath = resolveRealpath(filepath);
    const relativePath = path.relative(this.repositoryRoot, filepath).replace(/\\/g, "/");
    const output = (
      await this.jjCommandRead(
        [
          "file",
          "annotate",
          "-r",
          rev,
          "-T",
          'self.commit().change_id() ++ if(self.commit().change_offset(), "/" ++ self.commit().change_offset(), "") ++ "\\n"',
          relativePath,
        ],
        { timeout: TIMEOUTS.ANNOTATE },
      )
    ).toString();
    if (output === "") {
      return [];
    }
    return output.trim().split("\n");
  }

  async operationLog(operationId?: string): Promise<Operation[]> {
    const output = (
      await this.jjCommandRead(
        ["operation", "log", "--limit", "10", "--no-graph", "-T", buildOperationTemplate(this.jjVersion)],
        undefined,
        operationId ?? "@",
      )
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
    logger.trace(`[getDiffOriginal] enter: rev=${rev} filepath=${filepath} renamedFrom=${renamedFrom ?? "<none>"}`);
    filepath = resolveRealpath(filepath);

    const relativePath = path.relative(this.repositoryRoot, filepath).replace(/\\/g, "/");
    const filesetArgs = renamedFrom
      ? [filepathToFileset(renamedFrom.replace(/\\/g, "/")), filepathToFileset(relativePath)]
      : [filepathToFileset(relativePath)];
    logger.trace(`[getDiffOriginal] relativePath=${relativePath} filesetArgs=${JSON.stringify(filesetArgs)}`);

    const { summary, leftFiles } = await this.runDiffToolSummary(["diff", "-r", rev], filesetArgs);
    logger.trace(`[getDiffOriginal] summary (${summary.length} chars): ${JSON.stringify(summary)}`);
    logger.trace(`[getDiffOriginal] leftFiles keys: ${Object.keys(leftFiles).join(", ") || "<empty>"}`);

    const leftPath = this.matchDiffSummaryLine(summary, filepath)?.leftPath;
    if (!leftPath) {
      // Expected when the file was not modified in `rev`.
      logger.trace(`[getDiffOriginal] no diff entry for filepath=${filepath} in rev=${rev}; returning undefined`);
      return undefined;
    }
    const content = leftFiles[leftPath];
    if (content === undefined) {
      logger.warn(`[getDiffOriginal] path matched but leftFiles has no entry for ${JSON.stringify(leftPath)}`);
      return undefined;
    }
    logger.trace(`[getDiffOriginal] match found: leftPath=${leftPath} bytes=${content.length}`);
    return Buffer.from(content, "base64");
  }

  /**
   * Lists the files that differ between two revisions. With `mode === "interdiff"` this runs
   * `jj interdiff --summary --from <from> --to <to>` (the diff that `to` introduces, expressed
   * against `from`); with `mode === "diff"` it runs `jj diff --summary --from <from> --to <to>`
   * (a direct tree-to-tree comparison). Output format is `<status> <path>`, renames as
   * `{from => to}`.
   */
  async comparisonSummary(mode: "diff" | "interdiff", fromRev: string, toRev: string): Promise<FileStatus[]> {
    const output = (await this.jjCommandRead([mode, "--summary", "--from", fromRev, "--to", toRev])).toString();
    return parseInterdiffSummary(output, this.repositoryRoot);
  }

  /**
   * Returns the left (from-rev) and right (to-rev) content of a single file's two-revision
   * comparison, captured via the `jjx-vscode-diff` diff tool (mirrors {@link getDiffOriginal} but
   * for an arbitrary two-revision diff or interdiff). `left`/`right` are undefined when the file
   * is absent on that side (pure addition/deletion).
   */
  async getComparisonDiff(
    mode: "diff" | "interdiff",
    fromRev: string,
    toRev: string,
    filepath: string,
  ): Promise<{ left: Buffer | undefined; right: Buffer | undefined }> {
    logger.trace(`[getComparisonDiff] enter: mode=${mode} from=${fromRev} to=${toRev} filepath=${filepath}`);
    filepath = resolveRealpath(filepath);

    const relativePath = path.relative(this.repositoryRoot, filepath).replace(/\\/g, "/");
    logger.trace(`[getComparisonDiff] relativePath=${relativePath}`);

    const { summary, leftFiles, rightFiles } = await this.runDiffToolSummary(
      [mode, "--from", fromRev, "--to", toRev],
      [filepathToFileset(relativePath)],
    );
    logger.trace(`[getComparisonDiff] summary (${summary.length} chars): ${JSON.stringify(summary)}`);

    const match = this.matchDiffSummaryLine(summary, filepath);
    if (!match) {
      logger.warn(`[getComparisonDiff] no matching summary line for filepath=${filepath}`);
      return { left: undefined, right: undefined };
    }
    const left = match.leftPath !== undefined ? leftFiles[match.leftPath] : undefined;
    const right = match.rightPath !== undefined ? rightFiles[match.rightPath] : undefined;
    logger.trace(`[getComparisonDiff] match left=${left !== undefined} right=${right !== undefined}`);
    return {
      left: left !== undefined ? Buffer.from(left, "base64") : undefined,
      right: right !== undefined ? Buffer.from(right, "base64") : undefined,
    };
  }

  /**
   * Collects the per-file diff data of the commit `commitId` for the Split view: the file
   * statuses parsed from `jj diff --summary` (M/A/D/R/C) plus the base64-encoded left (parent)
   * and right (commit) contents of every changed file, captured via the `jjx-vscode-diff` diff
   * tool handshake. Conflicted files are fetched with an extra `jj log` call so
   * {@link SplitFileEntry.conflict} can be set (their contents contain jj's materialized
   * conflict markers); non-binary contents are decoded into `leftText`/`rightText` for hunk
   * splitting.
   *
   * `commitId` must be a full (unabbreviated) commit id so the diff stays pinned across
   * concurrent repo updates.
   */
  async getSplitFileEntries(commitId: string, token?: vscode.CancellationToken): Promise<SplitFileEntry[]> {
    const { summary, leftFiles, rightFiles, leftModes, rightModes } = await this.runDiffToolSummary(
      ["diff", "-r", commitId],
      [],
    );
    const fileStatuses = parseInterdiffSummary(summary, this.repositoryRoot);

    const conflictedPaths = new Set(
      (await this.getConflictedFilePaths(commitId, token)).map((conflictedPath) =>
        normalizePath(path.join(this.repositoryRoot, conflictedPath.replace(/\\/g, "/"))),
      ),
    );

    return fileStatuses.map((fileStatus) => {
      const relativePath = path.relative(this.repositoryRoot, fileStatus.path).replace(/\\/g, "/");
      const renamedFrom = fileStatus.renamedFrom?.replace(/\\/g, "/");
      const leftPath = fileStatus.type === "A" ? undefined : (renamedFrom ?? relativePath);
      const rightPath = fileStatus.type === "D" ? undefined : relativePath;
      const leftBase64 = leftPath !== undefined ? leftFiles[leftPath] : undefined;
      const rightBase64 = rightPath !== undefined ? rightFiles[rightPath] : undefined;
      const leftBuffer = leftBase64 !== undefined ? Buffer.from(leftBase64, "base64") : undefined;
      const rightBuffer = rightBase64 !== undefined ? Buffer.from(rightBase64, "base64") : undefined;
      const leftText = leftBuffer !== undefined ? decodeFileText(leftBuffer) : undefined;
      const rightText = rightBuffer !== undefined ? decodeFileText(rightBuffer) : undefined;
      const binary =
        (leftBuffer !== undefined && leftText === undefined) || (rightBuffer !== undefined && rightText === undefined);
      // A mode change is only offered for modified/renamed files whose mode differs between the
      // two sides (see SplitFileEntry.modeChangedFrom). Symlink modes ("120000") ride along
      // even when unchanged, for retargeted links. Modes are empty on platforms that cannot
      // track them (see jj-diff-tool-main.ts).
      const modeEligible = fileStatus.type === "M" || renamedFrom !== undefined;
      const leftMode = modeEligible && leftPath !== undefined ? leftModes[leftPath] : undefined;
      const rightMode = modeEligible && rightPath !== undefined ? rightModes[rightPath] : undefined;
      const modeChanged =
        leftMode !== undefined && rightMode !== undefined && (leftMode !== rightMode || rightMode === SYMLINK_FILE_MODE)
          ? rightMode
          : undefined;
      logger.trace(
        `[getSplitFileEntries] ${fileStatus.type} ${relativePath} left=${leftBase64 !== undefined} ` +
          `right=${rightBase64 !== undefined} binary=${binary} modeChangedTo=${modeChanged ?? "<none>"}`,
      );
      return {
        status: fileStatus.type,
        path: relativePath,
        renamedFrom,
        binary,
        conflict: conflictedPaths.has(normalizePath(fileStatus.path)),
        modeChangedFrom: modeChanged !== undefined ? leftMode : undefined,
        modeChangedTo: modeChanged,
        leftBase64,
        rightBase64,
        leftText,
        rightText,
      };
    });
  }

  /** Returns the repo-relative paths of the files conflicted in the commit `commitId`. */
  private async getConflictedFilePaths(commitId: string, token?: vscode.CancellationToken): Promise<string[]> {
    const output = (
      await this.jjCommandRead(["log", "-r", commitId, "--no-graph", "-T", CONFLICTED_FILES_TEMPLATE], { token })
    ).toString();
    const trimmed = output.trim();
    if (!trimmed) {
      return [];
    }
    const entry = JSON.parse(trimmed) as { conflicted_files?: string[] };
    return entry.conflicted_files ?? [];
  }

  /**
   * Runs `jj <revArgs> --summary --tool=jjx-vscode-diff -- <filesetArgs>` and captures both sides'
   * file contents via the `jjx-vscode-diff` IPC handshake. Retries with `--ignore-working-copy`
   * reconciliation on divergent operations.
   */
  private async runDiffToolSummary(
    revArgs: string[],
    filesetArgs: string[],
  ): Promise<{
    summary: string;
    leftFiles: Record<string, string>;
    rightFiles: Record<string, string>;
    leftModes: Record<string, string>;
    rightModes: Record<string, string>;
  }> {
    const diffConfigs = getDiffToolConfigs();
    if (!diffConfigs.length) {
      throw new Error("Diff tool not initialized.");
    }

    const buildArgs = () =>
      [
        ...revArgs,
        "--summary",
        "--tool=jjx-vscode-diff",
        ...diffConfigs.flatMap((c) => ["--config", c]),
        "--",
        ...filesetArgs,
      ] as string[];

    const run = async (spawnFn: (args: string[], options: SpawnOptions) => ChildProcess) => {
      const requestId = crypto.randomUUID();
      const pathPromise = expectDiffToolRequest(requestId);
      const childProcess = spawnFn(buildArgs(), {
        timeout: TIMEOUTS.DIFF_TOOL,
        cwd: this.repositoryRoot,
        env: { VSCODE_JJ_DIFF_REQUEST_ID: requestId },
      });
      // collectProcessOutput rejects (via convertJJErrors) on DivergentOperationsError, which
      // exits run before awaiting pathPromise — so the IPC handshake is only consumed when the
      // spawn actually ran the diff tool.
      const { stdout } = await collectProcessOutput(childProcess).catch(convertJJErrors);
      const { leftFiles, rightFiles, leftModes, rightModes } = await pathPromise;
      return { summary: stdout.toString(), leftFiles, rightFiles, leftModes, rightModes };
    };

    return withDivergenceHandling(
      () => run((args, options) => this.spawnJJRead(args, options)),
      () => run((args, options) => this.spawnJJ(["--ignore-working-copy", ...args], options)),
      (maxDelayMs) => this.jitteredDelay(maxDelayMs),
    );
  }

  /**
   * Finds the `jj diff`/`jj interdiff --summary` line whose (post-rename) target path equals
   * `filepath`, and returns the left/right content keys it implies. Returns undefined when no line
   * matches. `M`/`A`/`D` lines use `file` for both sides (left absent for adds, right absent for
   * deletes); `R`/`C` rename lines map left to `fromPath` and right to `toPath`.
   */
  private matchDiffSummaryLine(
    summary: string,
    filepath: string,
  ): { leftPath?: string; rightPath?: string } | undefined {
    const normalizedTargetPath = path.normalize(filepath).replace(/\\/g, "/");
    for (const summaryLineRaw of summary.trim().split("\n")) {
      const summaryLine = summaryLineRaw.trim();
      if (!summaryLine) {
        continue;
      }
      const type = summaryLine.charAt(0);
      const file = isWindows ? summaryLine.slice(2).trim().replace(/\\/g, "/") : summaryLine.slice(2).trim();

      if (type === "M" || type === "D" || type === "A") {
        const normalizedSummaryPath = path.join(this.repositoryRoot, file).replace(/\\/g, "/");
        if (pathEquals(normalizedSummaryPath, normalizedTargetPath)) {
          return { leftPath: type === "A" ? undefined : file, rightPath: type === "D" ? undefined : file };
        }
      } else if (type === "R" || type === "C") {
        const parseResult = parseRenamePaths(file);
        if (!parseResult) {
          throw new Error(`Unexpected rename line: ${summaryLineRaw}`);
        }
        const normalizedSummaryPath = path.join(this.repositoryRoot, parseResult.toPath).replace(/\\/g, "/");
        if (pathEquals(normalizedSummaryPath, normalizedTargetPath)) {
          return { leftPath: parseResult.fromPath, rightPath: parseResult.toPath };
        }
      }
    }
    return undefined;
  }
}

export function resolveRealpath(filepath: string): string {
  try {
    return realFs.realpathSync.native(filepath);
  } catch {
    return filepath;
  }
}
