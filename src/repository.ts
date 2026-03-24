import path from "path";
import * as crypto from "crypto";
import * as vscode from "vscode";
import fs from "fs/promises";
import spawn from "cross-spawn";
import { SHOW_TEMPLATE, STATUS_TEMPLATE, LOG_TEMPLATE, OPERATION_TEMPLATE } from "./templateBuilder";
import { ImmutableError, convertJJErrors, parseJJError } from "./errors";
import { spawnJJ, handleJJCommand } from "./process";
import { parseRenamePaths } from "./parseRenamePaths";
import { filepathToFileset } from "./utils";
import {
  getDiffToolPath,
  expectDiffToolRequest,
  getSquashToolPath,
  expectSquashToolRequest,
  completeSquashToolRequest,
} from "./jjEditor";
import { pathEquals } from "./utils";
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

export class JJRepository {
  statusCache: RepositoryStatus | undefined;
  gitFetchPromise: Promise<void> | undefined;

  constructor(
    public repositoryRoot: string,
    private jjPath: string,
    private jjConfigArgs: string[],
  ) {}

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

  spawnJJ(args: string[], options: Parameters<typeof spawn>[2] & { cwd: string }) {
    const separatorIndex = args.indexOf("--");
    const finalArgs =
      separatorIndex === -1
        ? [...args, ...this.jjConfigArgs]
        : [...args.slice(0, separatorIndex), ...this.jjConfigArgs, ...args.slice(separatorIndex)];
    return spawnJJ(this.jjPath, finalArgs, options);
  }

  spawnJJRead(args: string[], options: Parameters<typeof spawn>[2] & { cwd: string }) {
    return this.spawnJJ(["--ignore-working-copy", ...args], options);
  }

  /**
   * Note: this command may itself snapshot the working copy and add an operation to the log, in which case it will
   * return the new operation id.
   */
  async getLatestOperationId(ignoreWorkingCopy: boolean = true) {
    const spawn = ignoreWorkingCopy ? this.spawnJJRead.bind(this) : this.spawnJJ.bind(this);
    return (
      await handleJJCommand(
        spawn(["operation", "log", "--limit", "1", "-T", "self.id()", "--no-graph"], {
          cwd: this.repositoryRoot,
        }),
      )
    )
      .toString()
      .trim();
  }

  async getStatus(useCache = false): Promise<RepositoryStatus> {
    if (useCache && this.statusCache) {
      return this.statusCache;
    }

    const output = (
      await handleJJCommand(
        this.spawnJJRead(["log", "-r", "@", "-T", STATUS_TEMPLATE, "--no-graph"], {
          timeout: TIMEOUTS.DEFAULT,
          cwd: this.repositoryRoot,
        }),
      )
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

    const fileStatuses: FileStatus[] = [];
    const fileStatusesByPath = new Map<string, FileStatus>();

    for (const diffFile of entry.diff_files) {
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
      fileStatusesByPath.set(fullPath, fileStatus);
    }

    const conflictedFiles = new Set<string>();
    for (const conflictedPath of entry.conflicted_files || []) {
      const normalizedPath = path.normalize(conflictedPath).replace(/\\/g, "/");
      const fullPath = path.join(this.repositoryRoot, normalizedPath);
      conflictedFiles.add(fullPath);

      if (!fileStatusesByPath.has(fullPath)) {
        fileStatuses.push({
          type: "X",
          file: path.basename(normalizedPath),
          path: fullPath,
        });
        fileStatusesByPath.set(fullPath, fileStatuses[fileStatuses.length - 1]);
      }
    }

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

  async status(useCache = false): Promise<RepositoryStatus> {
    const status = await this.getStatus(useCache);
    return status;
  }

  async fileList() {
    return (
      await handleJJCommand(
        this.spawnJJRead(["file", "list"], {
          timeout: TIMEOUTS.DEFAULT,
          cwd: this.repositoryRoot,
        }),
      )
    )
      .toString()
      .trim()
      .split("\n");
  }

  async show(rev: string) {
    const results = await this.showAll([rev]);
    if (results.length > 1) {
      throw new Error("Multiple results found for the given revision.");
    }
    if (results.length === 0) {
      throw new Error("No results found for the given revision.");
    }
    return results[0];
  }

  async showAll(revsets: string[]) {
    const output = (
      await handleJJCommand(
        this.spawnJJRead(["log", "-T", SHOW_TEMPLATE, "--no-graph", ...revsets.flatMap((revset) => ["-r", revset])], {
          timeout: TIMEOUTS.DEFAULT,
          cwd: this.repositoryRoot,
        }),
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

      const fileStatuses: FileStatus[] = [];
      const fileStatusesByPath = new Map<string, FileStatus>();

      for (const diffFile of entry.diff_files) {
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
        fileStatusesByPath.set(fullPath, fileStatus);
      }

      const conflictedFiles = new Set<string>();
      for (const conflictedPath of entry.conflicted_files || []) {
        const normalizedPath = path.normalize(conflictedPath).replace(/\\/g, "/");
        const fullPath = path.join(this.repositoryRoot, normalizedPath);
        conflictedFiles.add(fullPath);

        if (!fileStatusesByPath.has(fullPath)) {
          fileStatuses.push({
            type: "X",
            file: path.basename(normalizedPath),
            path: fullPath,
          });
          fileStatusesByPath.set(fullPath, fileStatuses[fileStatuses.length - 1]);
        }
      }

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
    return handleJJCommand(
      this.spawnJJRead(["file", "show", "--revision", rev, filepathToFileset(filepath)], {
        timeout: TIMEOUTS.DEFAULT,
        cwd: this.repositoryRoot,
      }),
    );
  }

  readFileByFileId(filepath: string, fileId: string) {
    return handleJJCommand(
      this.spawnJJRead(["debug", "object", "file", "--", filepath, fileId], {
        timeout: TIMEOUTS.DEFAULT,
        cwd: this.repositoryRoot,
      }),
    );
  }

  showTemplate(rev: string, template: string): Promise<string> {
    return handleJJCommand(
      this.spawnJJRead(["show", "-r", rev, "-T", template, "--no-patch"], {
        timeout: TIMEOUTS.DEFAULT,
        cwd: this.repositoryRoot,
      }),
    ).then((buf) => buf.toString());
  }

  async describeRetryImmutable(rev: string, message?: string) {
    return this.retryWithImmutable(
      rev,
      () => this.describe(rev, message),
      () => this.describe(rev, message, true),
    );
  }

  async describe(rev: string, message?: string, ignoreImmutable = false) {
    return (
      await handleJJCommand(
        this.spawnJJ(
          ["describe", ...(message ? ["-m", message] : []), rev, ...(ignoreImmutable ? ["--ignore-immutable"] : [])],
          {
            timeout: message ? TIMEOUTS.DEFAULT : 0,
            cwd: this.repositoryRoot,
          },
        ),
      )
    ).toString();
  }

  async new(message?: string, revs?: string[]) {
    try {
      return await handleJJCommand(
        this.spawnJJ(["new", ...(message ? ["-m", message] : []), ...(revs ? ["-r", ...revs] : [])], {
          timeout: TIMEOUTS.DEFAULT,
          cwd: this.repositoryRoot,
        }),
      );
    } catch (error) {
      throw parseJJError(error);
    }
  }

  async commit(message?: string) {
    try {
      return await handleJJCommand(
        this.spawnJJ(["commit", ...(message ? ["-m", message] : [])], {
          timeout: message ? TIMEOUTS.DEFAULT : 0,
          cwd: this.repositoryRoot,
        }),
      );
    } catch (error) {
      throw parseJJError(error);
    }
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

  async squash({
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
      await handleJJCommand(
        this.spawnJJ(
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
          {
            timeout: message ? TIMEOUTS.DEFAULT : 0,
            cwd: this.repositoryRoot,
          },
        ),
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
  async squashContent({
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
    const squashToolSh = getSquashToolPath();
    if (!squashToolSh) {
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
        "--config",
        `merge-tools.jjx-vscode-squash.program="${squashToolSh}"`,
        "--use-destination-message",
        ...(ignoreImmutable ? ["--ignore-immutable"] : []),
      ],
      {
        timeout: TIMEOUTS.SQUASH_TOOL,
        cwd: this.repositoryRoot,
        env: { ...process.env, VSCODE_JJ_SQUASH_REQUEST_ID: requestId },
      },
    );

    const jjExit = new Promise<void>((resolve, reject) => {
      let errOutput = "";
      childProcess.stderr!.on("data", (data: Buffer) => {
        errOutput += data.toString();
      });

      childProcess.on("error", (error: Error) => {
        reject(new Error(`Spawning command failed: ${error.message}`));
      });

      childProcess.on("close", (code, signal) => {
        if (code) {
          reject(new Error(`Command failed with exit code ${code}.\nstderr: ${errOutput}`));
        } else if (signal) {
          reject(new Error(`Command failed with signal ${signal}.\nstderr: ${errOutput}`));
        } else {
          resolve();
        }
      });
    });

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

    await jjExit.catch(convertJJErrors);
  }

  async log(rev: string, limit: number = 100): Promise<LogEntry[]> {
    const output = (
      await handleJJCommand(
        this.spawnJJRead(["log", "-r", rev, "-n", limit.toString(), "-T", LOG_TEMPLATE], {
          timeout: TIMEOUTS.DEFAULT,
          cwd: this.repositoryRoot,
        }),
      )
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

  async editRetryImmutable(rev: string) {
    return this.retryWithImmutable(
      rev,
      () => this.edit(rev),
      () => this.edit(rev, true),
    );
  }

  async edit(rev: string, ignoreImmutable = false) {
    return await handleJJCommand(
      this.spawnJJ(["edit", "-r", rev, ...(ignoreImmutable ? ["--ignore-immutable"] : [])], {
        timeout: TIMEOUTS.DEFAULT,
        cwd: this.repositoryRoot,
      }),
    );
  }

  async moveBookmark(bookmark: string, targetRev: string, allowBackwards = false) {
    return await handleJJCommand(
      this.spawnJJ(["bookmark", "move", bookmark, "-t", targetRev, ...(allowBackwards ? ["--allow-backwards"] : [])], {
        timeout: TIMEOUTS.DEFAULT,
        cwd: this.repositoryRoot,
      }),
    );
  }

  async createBookmark(bookmark: string, targetRev: string) {
    return await handleJJCommand(
      this.spawnJJ(["bookmark", "create", bookmark, "-r", targetRev], {
        timeout: TIMEOUTS.DEFAULT,
        cwd: this.repositoryRoot,
      }),
    );
  }

  async createTag(tag: string, targetRev: string) {
    return await handleJJCommand(
      this.spawnJJ(["tag", "set", tag, "-r", targetRev], { timeout: TIMEOUTS.DEFAULT, cwd: this.repositoryRoot }),
    );
  }

  async deleteBookmark(bookmark: string) {
    return await handleJJCommand(
      this.spawnJJ(["bookmark", "delete", bookmark], { timeout: TIMEOUTS.DEFAULT, cwd: this.repositoryRoot }),
    );
  }

  async deleteTag(tag: string) {
    return await handleJJCommand(
      this.spawnJJ(["tag", "delete", tag], { timeout: TIMEOUTS.DEFAULT, cwd: this.repositoryRoot }),
    );
  }

  async abandonRetryImmutable(rev: string) {
    return this.retryWithImmutable(
      rev,
      () => this.abandon(rev),
      () => this.abandon(rev, true),
    );
  }

  async abandon(rev: string, ignoreImmutable = false) {
    return await handleJJCommand(
      this.spawnJJ(["abandon", "-r", rev, ...(ignoreImmutable ? ["--ignore-immutable"] : [])], {
        timeout: TIMEOUTS.DEFAULT,
        cwd: this.repositoryRoot,
      }),
    );
  }

  async rebase(
    source: string,
    destination: string,
    mode: "onto" | "after" | "before",
    withDescendants = false,
    ignoreImmutable = false,
  ) {
    const sourceFlag = withDescendants ? "-s" : "-r";
    const flag = mode === "onto" ? "-o" : mode === "after" ? "-A" : "-B";
    return await handleJJCommand(
      this.spawnJJ(
        ["rebase", sourceFlag, source, flag, destination, ...(ignoreImmutable ? ["--ignore-immutable"] : [])],
        {
          timeout: TIMEOUTS.DEFAULT,
          cwd: this.repositoryRoot,
        },
      ),
    );
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
    return await handleJJCommand(
      this.spawnJJ(["duplicate", "-r", source, flag, destination], {
        timeout: TIMEOUTS.DEFAULT,
        cwd: this.repositoryRoot,
      }),
    );
  }

  async revert(source: string, destination: string, mode: "onto" | "after" | "before") {
    const flag = mode === "onto" ? "-o" : mode === "after" ? "-A" : "-B";
    return await handleJJCommand(
      this.spawnJJ(["revert", "-r", source, flag, destination], {
        timeout: TIMEOUTS.DEFAULT,
        cwd: this.repositoryRoot,
      }),
    );
  }

  async restoreRetryImmutable(rev?: string, filepaths?: string[]) {
    return this.retryWithImmutable(
      rev ?? "@",
      () => this.restore(rev, filepaths),
      () => this.restore(rev, filepaths, true),
    );
  }

  async restore(rev?: string, filepaths?: string[], ignoreImmutable = false) {
    return await handleJJCommand(
      this.spawnJJ(
        [
          "restore",
          "--changes-in",
          rev ? rev : "@",
          ...(filepaths ? filepaths.map((filepath) => filepathToFileset(filepath)) : []),
          ...(ignoreImmutable ? ["--ignore-immutable"] : []),
        ],
        {
          timeout: TIMEOUTS.DEFAULT,
          cwd: this.repositoryRoot,
        },
      ),
    );
  }

  gitFetch(): Promise<void> {
    if (!this.gitFetchPromise) {
      this.gitFetchPromise = (async () => {
        try {
          await handleJJCommand(
            this.spawnJJ(["git", "fetch"], {
              timeout: TIMEOUTS.GIT_FETCH,
              cwd: this.repositoryRoot,
            }),
          );
        } finally {
          this.gitFetchPromise = undefined;
        }
      })();
    }
    return this.gitFetchPromise;
  }

  async updateStale(): Promise<void> {
    await handleJJCommand(
      this.spawnJJ(["workspace", "update-stale"], {
        timeout: TIMEOUTS.UPDATE_STALE,
        cwd: this.repositoryRoot,
      }),
    );
  }

  async annotate(filepath: string, rev: string): Promise<string[]> {
    const output = (
      await handleJJCommand(
        this.spawnJJRead(
          [
            "file",
            "annotate",
            "-r",
            rev,
            filepath, // `jj file annotate` takes a path, not a fileset
          ],
          {
            timeout: TIMEOUTS.ANNOTATE,
            cwd: this.repositoryRoot,
          },
        ),
      )
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
      await handleJJCommand(
        this.spawnJJRead(
          ["operation", "log", "--limit", "10", "--no-graph", "--at-operation=@", "-T", OPERATION_TEMPLATE],
          {
            timeout: TIMEOUTS.DEFAULT,
            cwd: this.repositoryRoot,
          },
        ),
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

  async operationUndo(id: string) {
    return (
      await handleJJCommand(
        this.spawnJJ(["operation", "undo", id], {
          timeout: TIMEOUTS.DEFAULT,
          cwd: this.repositoryRoot,
        }),
      )
    ).toString();
  }

  async operationRestore(id: string) {
    return (
      await handleJJCommand(
        this.spawnJJ(["operation", "restore", id], {
          timeout: TIMEOUTS.DEFAULT,
          cwd: this.repositoryRoot,
        }),
      )
    ).toString();
  }

  async undo() {
    return await handleJJCommand(
      this.spawnJJ(["undo"], {
        timeout: TIMEOUTS.DEFAULT,
        cwd: this.repositoryRoot,
      }),
    );
  }

  async redo() {
    return await handleJJCommand(
      this.spawnJJ(["redo"], {
        timeout: TIMEOUTS.DEFAULT,
        cwd: this.repositoryRoot,
      }),
    );
  }

  /**
   * @returns undefined if the file was not modified in `rev`
   */
  async getDiffOriginal(rev: string, filepath: string): Promise<Buffer | undefined> {
    const diffToolSh = getDiffToolPath();
    if (!diffToolSh) {
      throw new Error("Diff tool not initialized.");
    }

    const requestId = crypto.randomUUID();
    const pathPromise = expectDiffToolRequest(requestId);

    const summaryOutput = await new Promise<string>((resolve, reject) => {
      const childProcess = this.spawnJJRead(
        // We don't pass the filepath to diff because we need the left folder to have all files,
        // in case the file was renamed or copied. If we knew the status of the file, we could
        // pass the previous filename in addition to the current filename upon seeing a rename or copy.
        // We don't have the status though, which is why we're using `--summary` here.
        [
          "diff",
          "--summary",
          "--tool=jjx-vscode-diff",
          "--config",
          `merge-tools.jjx-vscode-diff.program="${diffToolSh}"`,
          "-r",
          rev,
        ],
        {
          timeout: 10_000,
          cwd: this.repositoryRoot,
          env: { ...process.env, VSCODE_JJ_DIFF_REQUEST_ID: requestId },
        },
      );

      const output: Buffer[] = [];
      const errOutput: Buffer[] = [];

      childProcess.stdout!.on("data", (data: Buffer) => {
        output.push(data);
      });

      childProcess.stderr!.on("data", (data: Buffer) => {
        errOutput.push(data);
      });

      childProcess.on("error", (error: Error) => {
        reject(new Error(`Spawning command failed: ${error.message}`));
      });

      childProcess.on("close", (code, signal) => {
        if (code) {
          reject(
            new Error(
              `Command failed with exit code ${code}.\nstdout: ${Buffer.concat(output).toString()}\nstderr: ${Buffer.concat(errOutput).toString()}`,
            ),
          );
        } else if (signal) {
          reject(
            new Error(
              `Command failed with signal ${signal}.\nstdout: ${Buffer.concat(output).toString()}\nstderr: ${Buffer.concat(errOutput).toString()}`,
            ),
          );
        } else {
          resolve(Buffer.concat(output).toString());
        }
      });
    }).catch(convertJJErrors);

    const { leftFiles } = await pathPromise;

    const summaryLines = summaryOutput.trim().split("\n");

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
