import path from "path";
import * as vscode from "vscode";
import fs from "fs/promises";
import spawn from "cross-spawn";
import { generateTemplate, LOG_ENTRY_FIELDS, SHOW_ENTRY_FIELDS, STATUS_ENTRY_FIELDS } from "./templateBuilder";
import { logger } from "./logger";
import { ImmutableError, convertJJErrors, parseJJError } from "./errors";
import { fakeEditorPath, getIgnoreWorkingCopyArgs } from "./config";
import { spawnJJ, handleJJCommand } from "./process";
import { prepareFakeeditor, filepathToFileset, parseRenamePaths } from "./fakeeditor";
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
    return this.spawnJJ([...getIgnoreWorkingCopyArgs(this.repositoryRoot), ...args], options);
  }

  /**
   * Note: this command may itself snapshot the working copy and add an operation to the log, in which case it will
   * return the new operation id.
   */
  async getLatestOperationId() {
    return (
      await handleJJCommand(
        this.spawnJJRead(["operation", "log", "--limit", "1", "-T", "self.id()", "--no-graph"], {
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

    const template = generateTemplate(STATUS_ENTRY_FIELDS);
    const output = (
      await handleJJCommand(
        this.spawnJJRead(["log", "-r", "@", "-T", template, "--no-graph"], {
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
    const template = generateTemplate(SHOW_ENTRY_FIELDS);

    const output = (
      await handleJJCommand(
        this.spawnJJRead(["log", "-T", template, "--no-graph", ...revsets.flatMap((revset) => ["-r", revset])], {
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

  debugObject(objectType: string, objectId: string): Promise<string> {
    return handleJJCommand(
      this.spawnJJRead(["debug", "object", objectType, objectId], {
        timeout: TIMEOUTS.DEFAULT,
        cwd: this.repositoryRoot,
      }),
    ).then((buf) => buf.toString());
  }

  debugTree(treeId: string, filepath: string): Promise<string> {
    return handleJJCommand(
      this.spawnJJRead(["debug", "tree", "--id", treeId, "--", filepath], {
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
            ...(message ? { timeout: TIMEOUTS.DEFAULT } : {}),
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
          ...(message ? { timeout: TIMEOUTS.DEFAULT } : {}),
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
            timeout: TIMEOUTS.DEFAULT,
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
    const { succeedFakeeditor, cleanup, envVars } = await prepareFakeeditor();
    return new Promise<void>((resolve, reject) => {
      const childProcess = this.spawnJJ(
        [
          "squash",
          "--from",
          fromRev,
          "--into",
          toRev,
          "--interactive",
          "--tool",
          `${fakeEditorPath}`,
          "--use-destination-message",
          ...(ignoreImmutable ? ["--ignore-immutable"] : []),
        ],
        {
          timeout: TIMEOUTS.FAKE_EDITOR,
          cwd: this.repositoryRoot,
          env: { ...process.env, ...envVars },
        },
      );

      let fakeEditorOutputBuffer = "";
      const FAKEEDITOR_SENTINEL = "FAKEEDITOR_OUTPUT_END\n";

      childProcess.stdout!.on("data", (data: Buffer) => {
        fakeEditorOutputBuffer += data.toString();

        if (!fakeEditorOutputBuffer.includes(FAKEEDITOR_SENTINEL)) {
          return;
        }

        const output = fakeEditorOutputBuffer.substring(0, fakeEditorOutputBuffer.indexOf(FAKEEDITOR_SENTINEL));

        const lines = output.trim().split("\n");
        const fakeEditorPID = lines[0];
        const fakeEditorCWD = lines[1];
        const leftFolderPath = lines[3];
        const rightFolderPath = lines[4];

        if (lines.length !== 5) {
          if (fakeEditorPID) {
            try {
              process.kill(parseInt(fakeEditorPID), "SIGTERM");
            } catch (killError) {
              logger.error(
                `Failed to kill fakeeditor (PID: ${fakeEditorPID}) after validation error: ${killError instanceof Error ? killError : ""}`,
              );
            }
          }
          void cleanup();
          reject(new Error(`Unexpected output from fakeeditor: ${output}`));
          return;
        }

        if (
          !fakeEditorPID ||
          !fakeEditorCWD ||
          !leftFolderPath ||
          !leftFolderPath.endsWith("left") ||
          !rightFolderPath ||
          !rightFolderPath.endsWith("right")
        ) {
          if (fakeEditorPID) {
            try {
              process.kill(parseInt(fakeEditorPID), "SIGTERM");
            } catch (killError) {
              logger.error(
                `Failed to kill fakeeditor (PID: ${fakeEditorPID}) after validation error: ${killError instanceof Error ? killError : ""}`,
              );
            }
          }
          void cleanup();
          reject(new Error(`Unexpected output from fakeeditor: ${output}`));
          return;
        }

        const leftFolderAbsolutePath = path.isAbsolute(leftFolderPath)
          ? leftFolderPath
          : path.join(fakeEditorCWD, leftFolderPath);
        const rightFolderAbsolutePath = path.isAbsolute(rightFolderPath)
          ? rightFolderPath
          : path.join(fakeEditorCWD, rightFolderPath);

        const relativeFilePath = path.relative(this.repositoryRoot, filepath);
        const fileToEdit = path.join(rightFolderAbsolutePath, relativeFilePath);

        void fs
          .rm(rightFolderAbsolutePath, { recursive: true, force: true })
          .then(() => fs.mkdir(rightFolderAbsolutePath, { recursive: true }))
          .then(() =>
            fs.cp(leftFolderAbsolutePath, rightFolderAbsolutePath, {
              recursive: true,
            }),
          )
          .then(() => fs.rm(fileToEdit, { force: true }))
          .then(() => fs.writeFile(fileToEdit, content))
          .then(succeedFakeeditor)
          .catch((error) => {
            if (fakeEditorPID) {
              try {
                process.kill(parseInt(fakeEditorPID), "SIGTERM");
              } catch (killError) {
                logger.error(
                  `Failed to send SIGTERM to fakeeditor (PID: ${fakeEditorPID}) during error handling: ${killError instanceof Error ? killError : ""}`,
                );
              }
            }
            void cleanup();
            reject(error); // eslint-disable-line @typescript-eslint/prefer-promise-reject-errors
          });
      });

      let errOutput = "";
      childProcess.stderr!.on("data", (data: Buffer) => {
        errOutput += data.toString();
      });

      childProcess.on("close", (code, signal) => {
        void cleanup();
        if (code) {
          reject(
            new Error(
              `Command failed with exit code ${code}.\nstdout: ${fakeEditorOutputBuffer}\nstderr: ${errOutput}`,
            ),
          );
        } else if (signal) {
          reject(
            new Error(`Command failed with signal ${signal}.\nstdout: ${fakeEditorOutputBuffer}\nstderr: ${errOutput}`),
          );
        } else {
          resolve();
        }
      });
    }).catch(convertJJErrors);
  }

  async log(
    rev: string = "connected(present(@) | ancestors(immutable_heads().., 2) | trunk())",
    limit: number = 100,
  ): Promise<LogEntry[]> {
    const template = generateTemplate(LOG_ENTRY_FIELDS);

    const output = (
      await handleJJCommand(
        this.spawnJJRead(["log", "-r", rev, "-n", limit.toString(), "-T", template], {
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
      this.spawnJJ(["tag", "remove", tag], { timeout: TIMEOUTS.DEFAULT, cwd: this.repositoryRoot }),
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
    const OPERATION_ENTRY_FIELDS: import("./templateBuilder").TemplateFields = {
      id: { type: "string", expr: "self.id()" },
      description: { type: "string", expr: "self.description()" },
      tags: { type: "string", expr: "self.tags()" },
      start: { type: "string", expr: "self.time().start()" },
      user: { type: "string", expr: "self.user()" },
      snapshot: { type: "boolean", expr: "self.snapshot()" },
    };

    const template = generateTemplate(OPERATION_ENTRY_FIELDS);

    const output = (
      await handleJJCommand(
        this.spawnJJRead(["operation", "log", "--limit", "10", "--no-graph", "--at-operation=@", "-T", template], {
          timeout: TIMEOUTS.DEFAULT,
          cwd: this.repositoryRoot,
        }),
      )
    ).toString();

    const ret: Operation[] = [];
    for (const line of output.trim().split("\n")) {
      if (!line.trim()) {
        continue;
      }
      const entry = JSON.parse(line) as {
        id: string;
        description: string;
        tags: string;
        start: string;
        user: string;
        snapshot: boolean;
      };
      ret.push({
        id: entry.id,
        description: entry.description,
        tags: entry.tags,
        start: entry.start,
        user: entry.user,
        snapshot: entry.snapshot,
      });
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

  /**
   * @returns undefined if the file was not modified in `rev`
   */
  async getDiffOriginal(rev: string, filepath: string): Promise<Buffer | undefined> {
    const { cleanup, envVars } = await prepareFakeeditor();

    const output = await new Promise<string>((resolve, reject) => {
      const childProcess = this.spawnJJRead(
        // We don't pass the filepath to diff because we need the left folder to have all files,
        // in case the file was renamed or copied. If we knew the status of the file, we could
        // pass the previous filename in addition to the current filename upon seeing a rename or copy.
        // We don't have the status though, which is why we're using `--summary` here.
        ["diff", "--summary", "--tool", `${fakeEditorPath}`, "-r", rev],
        {
          timeout: 10_000, // Ensure this is longer than fakeeditor's internal timeout
          cwd: this.repositoryRoot,
          env: { ...process.env, ...envVars },
        },
      );

      let fakeEditorOutputBuffer = "";
      const FAKEEDITOR_SENTINEL = "FAKEEDITOR_OUTPUT_END\n";

      childProcess.stdout!.on("data", (data: Buffer) => {
        fakeEditorOutputBuffer += data.toString();

        if (!fakeEditorOutputBuffer.includes(FAKEEDITOR_SENTINEL)) {
          // Wait for more data if sentinel not yet received
          return;
        }

        const completeOutput = fakeEditorOutputBuffer.substring(0, fakeEditorOutputBuffer.indexOf(FAKEEDITOR_SENTINEL));
        resolve(completeOutput);
      });

      const errOutput: Buffer[] = [];
      childProcess.stderr!.on("data", (data: Buffer) => {
        errOutput.push(data);
      });

      childProcess.on("error", (error: Error) => {
        void cleanup();
        reject(new Error(`Spawning command failed: ${error.message}`));
      });

      childProcess.on("close", (code, signal) => {
        void cleanup();
        if (code) {
          reject(
            new Error(
              `Command failed with exit code ${code}.\nstdout: ${fakeEditorOutputBuffer}\nstderr: ${Buffer.concat(errOutput).toString()}`,
            ),
          );
        } else if (signal) {
          reject(
            new Error(
              `Command failed with signal ${signal}.\nstdout: ${fakeEditorOutputBuffer}\nstderr: ${Buffer.concat(errOutput).toString()}`,
            ),
          );
        } else {
          // This reject will only matter if the promise wasn't resolved already;
          // that means we'll only see this if the command exited without sending the sentinel.
          reject(
            new Error(
              `Command exited unexpectedly.\nstdout:${fakeEditorOutputBuffer}\nstderr: ${Buffer.concat(errOutput).toString()}`,
            ),
          );
        }
      });
    }).catch(convertJJErrors);

    const lines = output.trim().split("\n");
    const pidLineIdx =
      lines.findIndex((line) => {
        return line.includes(fakeEditorPath);
      }) - 2;
    if (pidLineIdx < 0) {
      throw new Error("PID line not found.");
    }
    if (pidLineIdx + 3 >= lines.length) {
      throw new Error(`Unexpected output from fakeeditor: ${output}`);
    }

    const summaryLines = lines.slice(0, pidLineIdx);
    const fakeEditorPID = lines[pidLineIdx];
    const fakeEditorCWD = lines[pidLineIdx + 1];
    // lines[pidLineIdx + 2] is the fakeeditor executable path
    const leftFolderPath = lines[pidLineIdx + 3];

    const leftFolderAbsolutePath = path.isAbsolute(leftFolderPath)
      ? leftFolderPath
      : path.join(fakeEditorCWD, leftFolderPath);

    try {
      let pathInLeftFolder: string | undefined;

      for (const summaryLineRaw of summaryLines) {
        const summaryLine = summaryLineRaw.trim();

        const type = summaryLine.charAt(0);
        const file = summaryLine.slice(2).trim();

        if (type === "M" || type === "D") {
          const normalizedSummaryPath = path.join(this.repositoryRoot, file).replace(/\\/g, "/");
          const normalizedTargetPath = path.normalize(filepath).replace(/\\/g, "/");
          if (pathEquals(normalizedSummaryPath, normalizedTargetPath)) {
            pathInLeftFolder = file;
            break;
          }
        } else if (type === "R" || type === "C") {
          const parseResult = parseRenamePaths(file);
          if (!parseResult) {
            throw new Error(`Unexpected rename line: ${summaryLineRaw}`);
          }

          const normalizedSummaryPath = path.join(this.repositoryRoot, parseResult.toPath).replace(/\\/g, "/");
          const normalizedTargetPath = path.normalize(filepath).replace(/\\/g, "/");
          if (pathEquals(normalizedSummaryPath, normalizedTargetPath)) {
            // The file was renamed TO our target filepath, so we need its OLD path from the left folder
            pathInLeftFolder = parseResult.fromPath;
            break;
          }
        }
      }

      if (pathInLeftFolder) {
        const fullPath = path.join(leftFolderAbsolutePath, pathInLeftFolder);
        try {
          return await fs.readFile(fullPath);
        } catch (e) {
          logger.error(`Failed to read original file content from left folder at ${fullPath}: ${String(e)}`);
          throw e;
        }
      }

      // File was either added or unchanged in this revision.
      return undefined;
    } finally {
      try {
        process.kill(parseInt(fakeEditorPID), "SIGTERM");
      } catch (killError) {
        logger.error(
          `Failed to kill fakeeditor (PID: ${fakeEditorPID}) in getDiffOriginal: ${killError instanceof Error ? killError : ""}`,
        );
      }
    }
  }
}
