import path from "path";
import fs from "fs";
import * as vscode from "vscode";
import { resolveRev, toJJUri } from "./uri";
import type { JJDecorationProvider } from "./decorationProvider";
import { logger } from "./logger";
import { anyEvent, filterEvent, isDescendant } from "./utils";
import { JJFileSystemProvider } from "./fileSystemProvider";
import { getConfigArgs, getJJPath } from "./config";
import { collectProcessOutput, spawnJJ } from "./process";
import { extensionDir } from "./config";
import { JJRepository } from "./repository";
import type { FileStatus, RepositoryStatus, Show, Change } from "./types";
import { getRevFromChange } from "./types";
import { TIMEOUTS } from "./constants";

export class WorkspaceSourceControlManager {
  repoInfos:
    | Map<
        string,
        {
          jjPath: Awaited<ReturnType<typeof getJJPath>>;
          jjConfigArgs: string[];
          repoRoot: string;
        }
      >
    | undefined;
  repoSCMs: RepositorySourceControlManager[] = [];
  subscriptions: {
    dispose(): unknown;
  }[] = [];
  fileSystemProvider: JJFileSystemProvider;

  private _onDidRepoUpdate = new vscode.EventEmitter<{
    repoSCM: RepositorySourceControlManager;
  }>();
  readonly onDidRepoUpdate: vscode.Event<{
    repoSCM: RepositorySourceControlManager;
  }> = this._onDidRepoUpdate.event;

  constructor(private decorationProvider: JJDecorationProvider) {
    this.fileSystemProvider = new JJFileSystemProvider(this);
    this.subscriptions.push(this.fileSystemProvider);
    this.subscriptions.push(
      vscode.workspace.registerFileSystemProvider("jj", this.fileSystemProvider, {
        isReadonly: true,
        isCaseSensitive: true,
      }),
    );
  }

  async refresh() {
    const newRepoInfos = new Map<
      string,
      {
        jjPath: Awaited<ReturnType<typeof getJJPath>>;
        jjConfigArgs: string[];
        repoRoot: string;
      }
    >();
    for (const workspaceFolder of vscode.workspace.workspaceFolders || []) {
      try {
        const jjPath = await getJJPath(workspaceFolder.uri.fsPath);
        const jjConfigArgs = getConfigArgs(extensionDir);

        const repoRoot = (
          await collectProcessOutput(
            spawnJJ(jjPath.filepath, ["--ignore-working-copy", "root"], {
              timeout: TIMEOUTS.DEFAULT,
              cwd: workspaceFolder.uri.fsPath,
            }),
          )
        ).stdout
          .toString()
          .trim();

        const repoUri = vscode.Uri.file(repoRoot.replace(/^\\\\\?\\UNC\\/, "\\\\")).toString();

        if (!newRepoInfos.has(repoUri)) {
          newRepoInfos.set(repoUri, {
            jjPath,
            jjConfigArgs,
            repoRoot,
          });
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("no jj repo in")) {
          logger.debug(`No jj repo in ${workspaceFolder.uri.fsPath}`);
        } else {
          logger.error(`Error while initializing jjx in workspace ${workspaceFolder.uri.fsPath}: ${String(e)}`);
        }
        continue;
      }
    }

    let isAnyRepoChanged = false;
    for (const [key, value] of newRepoInfos) {
      const oldValue = this.repoInfos?.get(key);
      if (!oldValue) {
        isAnyRepoChanged = true;
        logger.info(`Detected new jj repo in workspace: ${key}`);
      } else if (
        oldValue.jjPath.filepath !== value.jjPath.filepath ||
        oldValue.jjConfigArgs.join(" ") !== value.jjConfigArgs.join(" ") ||
        oldValue.repoRoot !== value.repoRoot
      ) {
        isAnyRepoChanged = true;
        logger.info(`Detected change that requires reinitialization in workspace: ${key}`);
      }
    }
    for (const key of this.repoInfos?.keys() || []) {
      if (!newRepoInfos.has(key)) {
        isAnyRepoChanged = true;
        logger.info(`Detected jj repo removal in workspace: ${key}`);
      }
    }
    this.repoInfos = newRepoInfos;
    this.decorationProvider.removeStaleRepositories([...newRepoInfos.values()].map(({ repoRoot }) => repoRoot));

    if (isAnyRepoChanged) {
      const repoSCMs: RepositorySourceControlManager[] = [];
      for (const [workspaceFolder, { repoRoot, jjPath, jjConfigArgs }] of newRepoInfos.entries()) {
        logger.info(
          `Initializing jjx in workspace ${workspaceFolder}. Using jj at ${jjPath.filepath} (${jjPath.source}).`,
        );
        const repoSCM = new RepositorySourceControlManager(
          repoRoot,
          this.decorationProvider,
          this.fileSystemProvider,
          jjPath.filepath,
          jjConfigArgs,
        );
        repoSCM.onDidUpdate(
          () => {
            this._onDidRepoUpdate.fire({ repoSCM });
          },
          undefined,
          repoSCM.subscriptions,
        );
        repoSCMs.push(repoSCM);
      }

      for (const repoSCM of this.repoSCMs) {
        repoSCM.dispose();
      }
      this.repoSCMs = repoSCMs;
    }
    return isAnyRepoChanged;
  }

  getRepositoryFromUri(uri: vscode.Uri) {
    return this.repoSCMs.find((repo) => {
      return !path.relative(repo.repositoryRoot, uri.fsPath).startsWith("..");
    })?.repository;
  }

  getRepositoryFromResourceGroup(resourceGroup: vscode.SourceControlResourceGroup) {
    return this.repoSCMs.find((repo) => {
      return resourceGroup === repo.workingCopyResourceGroup || repo.parentResourceGroups.includes(resourceGroup);
    })?.repository;
  }

  getRepositoryFromSourceControl(sourceControl: vscode.SourceControl) {
    return this.repoSCMs.find((repo) => repo.sourceControl === sourceControl)?.repository;
  }

  getRepositorySourceControlManagerFromUri(uri: vscode.Uri) {
    return this.repoSCMs.find((repo) => {
      return !path.relative(repo.repositoryRoot, uri.fsPath).startsWith("..");
    });
  }

  getRepositorySourceControlManagerFromResourceGroup(resourceGroup: vscode.SourceControlResourceGroup) {
    return this.repoSCMs.find(
      (repo) =>
        repo.workingCopyResourceGroup === resourceGroup ||
        repo.parentResourceGroups.includes(resourceGroup) ||
        repo.selectedCommitResourceGroup === resourceGroup,
    );
  }

  getSelectedCommitChangeId(resourceGroup: vscode.SourceControlResourceGroup): string | undefined {
    const repo = this.getRepositorySourceControlManagerFromResourceGroup(resourceGroup);
    if (repo?.selectedCommitResourceGroup === resourceGroup) {
      return repo.selectedCommitChangeId;
    }
    return undefined;
  }

  getResourceGroupFromResourceState(resourceState: vscode.SourceControlResourceState) {
    const resourceUri = resourceState.resourceUri;

    for (const repo of this.repoSCMs) {
      const groups = [
        repo.workingCopyResourceGroup,
        ...repo.parentResourceGroups,
        ...(repo.selectedCommitResourceGroup ? [repo.selectedCommitResourceGroup] : []),
      ];

      for (const group of groups) {
        if (group.resourceStates.some((state) => state.resourceUri.toString() === resourceUri.toString())) {
          return group;
        }
      }
    }

    throw new Error("Resource state not found in any resource group");
  }

  dispose() {
    for (const subscription of this.repoSCMs) {
      subscription.dispose();
    }
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }
}

export function provideOriginalResource(uri: vscode.Uri) {
  if (!["file", "jj"].includes(uri.scheme)) {
    return undefined;
  }

  const rev = resolveRev(uri, { diffOriginalRevBehavior: "exclude", excludeSpecial: true });
  if (!rev) {
    return undefined;
  }
  const filePath = uri.fsPath;
  const originalUri = toJJUri(vscode.Uri.file(filePath), {
    diffOriginalRev: rev,
  });

  return originalUri;
}

export class RepositorySourceControlManager {
  subscriptions: {
    dispose(): unknown;
  }[] = [];
  sourceControl: vscode.SourceControl;
  workingCopyResourceGroup: vscode.SourceControlResourceGroup;
  parentResourceGroups: vscode.SourceControlResourceGroup[] = [];
  selectedCommitResourceGroup: vscode.SourceControlResourceGroup | undefined;
  selectedCommitShowResult: Show | undefined;
  selectedCommitChangeId: string | undefined;
  repository: JJRepository;
  checkForUpdatesPromise: Promise<void> | undefined;

  private _onDidUpdate = new vscode.EventEmitter<void>();
  readonly onDidUpdate: vscode.Event<void> = this._onDidUpdate.event;

  operationId: string | undefined;
  fileStatusesByChange: Map<string, FileStatus[]> = new Map();
  conflictedFilesByChange: Map<string, Set<string>> = new Map();
  trackedFiles: Set<string> = new Set();
  status: RepositoryStatus | undefined;
  parentShowResults: Map<string, Show> = new Map();
  private repoWatcherTimer: NodeJS.Timeout | undefined;

  constructor(
    public repositoryRoot: string,
    private decorationProvider: JJDecorationProvider,
    private fileSystemProvider: JJFileSystemProvider,
    jjPath: string,
    jjConfigArgs: string[],
  ) {
    this.repository = new JJRepository(repositoryRoot, jjPath, jjConfigArgs);

    this.sourceControl = vscode.scm.createSourceControl("jj", "Jujutsu", vscode.Uri.file(repositoryRoot));
    this.subscriptions.push(this.sourceControl);

    this.workingCopyResourceGroup = this.sourceControl.createResourceGroup("@", "Working Copy");
    this.subscriptions.push(this.workingCopyResourceGroup);

    const config = vscode.workspace.getConfiguration("jjx");
    const commitAction = config.get<string>("commitAction") || "commit";
    this.updatePlaceholderText(commitAction);

    this.sourceControl.acceptInputCommand = {
      command: "jj.new",
      title: "Create New Change",
      arguments: [this.sourceControl],
    };

    this.sourceControl.quickDiffProvider = {
      provideOriginalResource,
    };

    const jjRepoPath = path.join(this.repositoryRoot, ".jj/repo");
    let jjRootRepoPath: string;
    // In jj workspaces, .jj/repo is a regular file pointing to the real repo.
    try {
      const stats = fs.statSync(jjRepoPath);
      if (stats.isFile()) {
        jjRootRepoPath = fs.readFileSync(jjRepoPath, "utf-8").trim();
      } else {
        jjRootRepoPath = jjRepoPath;
      }
    } catch {
      jjRootRepoPath = jjRepoPath;
    }

    const opstoreWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(path.join(jjRootRepoPath, "op_store/operations"), "*"),
    );
    this.subscriptions.push(opstoreWatcher);

    const repoWatcher = vscode.workspace.createFileSystemWatcher("**/*");
    this.subscriptions.push(repoWatcher);

    const opstoreChangedWatchEvent = anyEvent(
      opstoreWatcher.onDidCreate,
      opstoreWatcher.onDidChange,
      opstoreWatcher.onDidDelete,
    );
    opstoreChangedWatchEvent(
      async () => {
        this.fileSystemProvider.onDidChangeRepository({
          repositoryRoot: this.repositoryRoot,
        });
        await this.checkForUpdates();
      },
      undefined,
      this.subscriptions,
    );

    const repoChangedWatchEvent = filterEvent(
      anyEvent(repoWatcher.onDidCreate, repoWatcher.onDidChange, repoWatcher.onDidDelete),
      (uri) => !isDescendant(path.join(this.repositoryRoot, ".jj"), uri.fsPath),
    );
    repoChangedWatchEvent(() => this.handleRepoWatcherEvent(), undefined, this.subscriptions);
  }

  private handleRepoWatcherEvent() {
    if (this.repoWatcherTimer) {
      clearTimeout(this.repoWatcherTimer);
    }
    this.repoWatcherTimer = setTimeout(() => {
      this.repoWatcherTimer = undefined;
      this.fileSystemProvider.onDidChangeRepository({
        repositoryRoot: this.repositoryRoot,
      });
      void this.checkForUpdates();
    }, TIMEOUTS.REPO_WATCHER_DEBOUNCE);
  }

  updatePlaceholderText(commitAction: string) {
    this.sourceControl.inputBox.placeholder =
      commitAction === "commit" ? "Describe Current Change (Ctrl+Enter)" : "Describe New Change (Ctrl+Enter)";
  }

  async checkForUpdates() {
    if (!this.checkForUpdatesPromise) {
      this.checkForUpdatesPromise = this.checkForUpdatesUnsafe();
      try {
        await this.checkForUpdatesPromise;
      } finally {
        this.checkForUpdatesPromise = undefined;
      }
    } else {
      await this.checkForUpdatesPromise;
    }
  }

  /**
   * This should never be called concurrently.
   */
  async checkForUpdatesUnsafe() {
    const latestOperationId = await this.repository.getLatestOperationId(false);
    if (this.operationId !== latestOperationId) {
      this.operationId = latestOperationId;
      const status = await this.repository.getStatus();

      await this.updateState(status);
      this.render();

      this._onDidUpdate.fire(undefined);
    }
  }

  async updateState(status: RepositoryStatus) {
    const newTrackedFiles = new Set<string>();
    const newParentShowResults = new Map<string, Show>();
    const newFileStatusesByChange = new Map<string, FileStatus[]>([["@", status.fileStatuses]]);
    const newConflictedFilesByChange = new Map<string, Set<string>>([["@", status.conflictedFiles]]);

    const trackedFilesList = await this.repository.fileList();
    for (const t of trackedFilesList) {
      const pathParts = t.split(path.sep);
      let currentPath = this.repositoryRoot + path.sep;
      for (const p of pathParts) {
        currentPath += p;
        newTrackedFiles.add(currentPath);
        currentPath += path.sep;
      }
    }

    const parentShowPromises = status.parentChanges.map(async (parentChange) => {
      const rev = getRevFromChange(parentChange);
      const showResult = await this.repository.show(rev);
      return { changeId: parentChange.changeId, showResult };
    });

    const parentShowResultsArray = await Promise.all(parentShowPromises);

    for (const { changeId, showResult } of parentShowResultsArray) {
      newParentShowResults.set(changeId, showResult);
      newFileStatusesByChange.set(changeId, showResult.fileStatuses);
      newConflictedFilesByChange.set(changeId, showResult.conflictedFiles);
    }

    this.status = status;
    this.fileStatusesByChange = newFileStatusesByChange;
    this.conflictedFilesByChange = newConflictedFilesByChange;
    this.parentShowResults = newParentShowResults;
    this.trackedFiles = newTrackedFiles;
  }

  static getLabel(prefix: string, change: Change, showChangeId: boolean = true) {
    const parts: string[] = [prefix];
    if (showChangeId) {
      const changeIdDisplay =
        change.divergent && change.changeOffset
          ? `${change.changeId.substring(0, 8)}/${change.changeOffset}`
          : change.changeId.substring(0, 8);
      parts.push(` [${changeIdDisplay}]`);
    }
    if (change.description) {
      parts.push(` • ${change.description}`);
    }
    if (change.isConflict) {
      parts.push(" (conflict)");
    }
    return parts.join("");
  }

  render() {
    if (!this.status?.workingCopy) {
      throw new Error("Cannot render source control without a current working copy change.");
    }

    const config = vscode.workspace.getConfiguration("jjx", vscode.Uri.file(this.repositoryRoot));
    const fileClickAction = config.get<"diff" | "at-revision" | "working-copy">("fileClickAction") || "diff";

    this.workingCopyResourceGroup.label = RepositorySourceControlManager.getLabel(
      "Working Copy",
      this.status.workingCopy,
      false,
    );
    this.workingCopyResourceGroup.resourceStates = this.status.fileStatuses.map((fileStatus) => {
      const workingCopyUri = vscode.Uri.file(fileStatus.path);
      const isConflicted = this.status?.conflictedFiles?.has(fileStatus.path) ?? false;
      const beforeUri =
        fileStatus.type === "A"
          ? toJJUri(vscode.Uri.file(fileStatus.path), { deleted: true })
          : toJJUri(vscode.Uri.file(fileStatus.path), { diffOriginalRev: "@" });
      return {
        resourceUri: workingCopyUri,
        decorations: {
          strikeThrough: fileStatus.type === "D",
          tooltip: path.basename(fileStatus.file),
        },
        command: getResourceStateCommand(
          fileStatus,
          beforeUri,
          workingCopyUri,
          "(Working Copy)",
          fileClickAction,
          workingCopyUri,
          isConflicted,
        ),
      };
    });
    this.sourceControl.count = this.status.fileStatuses.length;

    const showParentChangeId = this.status.parentChanges.length > 1;
    const updatedGroups: vscode.SourceControlResourceGroup[] = [];
    for (const group of this.parentResourceGroups) {
      const parentChange = this.status.parentChanges.find((change) => change.changeId === group.id);
      if (!parentChange) {
        group.dispose();
      } else {
        group.label = RepositorySourceControlManager.getLabel("Parent Commit", parentChange, showParentChangeId);
        updatedGroups.push(group);
      }
    }
    this.parentResourceGroups = updatedGroups;

    let newParentCreated = false;
    for (const parentChange of this.status.parentChanges) {
      let parentChangeResourceGroup!: vscode.SourceControlResourceGroup;

      const parentGroup = this.parentResourceGroups.find((group) => group.id === parentChange.changeId);
      if (!parentGroup) {
        parentChangeResourceGroup = this.sourceControl.createResourceGroup(
          parentChange.changeId,
          RepositorySourceControlManager.getLabel("Parent Commit", parentChange, showParentChangeId),
        );
        this.parentResourceGroups.push(parentChangeResourceGroup);
        newParentCreated = true;
      } else {
        parentChangeResourceGroup = parentGroup;
      }

      const showResult = this.parentShowResults.get(parentChange.changeId);
      if (showResult) {
        parentChangeResourceGroup.resourceStates = showResult.fileStatuses.map((parentStatus) => {
          const workingCopyUri = vscode.Uri.file(parentStatus.path);
          const beforeUri =
            parentStatus.type === "A"
              ? toJJUri(vscode.Uri.file(parentStatus.path), { deleted: true })
              : toJJUri(vscode.Uri.file(parentStatus.path), { diffOriginalRev: parentChange.changeId });
          return {
            resourceUri: toJJUri(workingCopyUri, {
              rev: parentChange.changeId,
            }),
            decorations: {
              strikeThrough: parentStatus.type === "D",
              tooltip: path.basename(parentStatus.file),
            },
            command: getResourceStateCommand(
              parentStatus,
              beforeUri,
              toJJUri(vscode.Uri.file(parentStatus.path), {
                rev: parentChange.changeId,
              }),
              `(${parentChange.changeId.substring(0, 8)})`,
              fileClickAction,
              workingCopyUri,
              this.conflictedFilesByChange.get(parentChange.changeId)?.has(parentStatus.path) ?? false,
              parentChange.changeId,
            ),
          };
        });
      }
    }

    if (newParentCreated && this.selectedCommitResourceGroup) {
      this.selectedCommitResourceGroup.dispose();
      this.selectedCommitResourceGroup = undefined;
    }

    if (this.selectedCommitShowResult) {
      const changeId = getRevFromChange(this.selectedCommitShowResult.change);
      this.selectedCommitChangeId = changeId;
      const isParent = this.status.parentChanges.some((p) => p.changeId === changeId);
      const isWorkingCopy = this.status.workingCopy.changeId === changeId;
      if (isParent || isWorkingCopy) {
        this.selectedCommitResourceGroup?.dispose();
        this.selectedCommitResourceGroup = undefined;
        this.selectedCommitChangeId = undefined;
      } else {
        if (!this.selectedCommitResourceGroup) {
          this.selectedCommitResourceGroup = this.sourceControl.createResourceGroup("selected", "Selected Commit");
        }
        this.selectedCommitResourceGroup.label = RepositorySourceControlManager.getLabel(
          "Selected Commit",
          this.selectedCommitShowResult.change,
        );
        this.selectedCommitResourceGroup.resourceStates = this.selectedCommitShowResult.fileStatuses.map(
          (fileStatus) => {
            const workingCopyUri = vscode.Uri.file(fileStatus.path);
            const beforeUri =
              fileStatus.type === "A"
                ? toJJUri(vscode.Uri.file(fileStatus.path), { deleted: true })
                : toJJUri(vscode.Uri.file(fileStatus.path), { diffOriginalRev: changeId });
            return {
              resourceUri: toJJUri(workingCopyUri, { rev: changeId }),
              decorations: {
                strikeThrough: fileStatus.type === "D",
                tooltip: path.basename(fileStatus.file),
              },
              command: getResourceStateCommand(
                fileStatus,
                beforeUri,
                toJJUri(vscode.Uri.file(fileStatus.path), { rev: changeId }),
                `(${changeId.substring(0, 8)})`,
                fileClickAction,
                workingCopyUri,
                this.conflictedFilesByChange.get(changeId)?.has(fileStatus.path) ?? false,
                changeId,
              ),
            };
          },
        );
      }
    } else {
      this.selectedCommitResourceGroup?.dispose();
      this.selectedCommitResourceGroup = undefined;
      this.selectedCommitChangeId = undefined;
    }

    const combinedFileStatusesByChange = new Map(this.fileStatusesByChange);
    if (this.selectedCommitShowResult && this.selectedCommitChangeId) {
      combinedFileStatusesByChange.set(
        this.selectedCommitShowResult.change.changeId,
        this.selectedCommitShowResult.fileStatuses,
      );
    }
    this.decorationProvider.onRefresh(
      this.repositoryRoot,
      combinedFileStatusesByChange,
      this.trackedFiles,
      this.conflictedFilesByChange,
    );
  }

  async setSelectedCommit(changeId: string | undefined) {
    if (
      !changeId ||
      (this.status &&
        (this.status.workingCopy.changeId === changeId ||
          this.status.parentChanges.some((p) => p.changeId === changeId)))
    ) {
      this.selectedCommitShowResult = undefined;
    } else {
      this.selectedCommitShowResult = await this.repository.show(changeId);
    }
    this.render();
  }

  dispose() {
    if (this.repoWatcherTimer) {
      clearTimeout(this.repoWatcherTimer);
      this.repoWatcherTimer = undefined;
    }
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    for (const group of this.parentResourceGroups) {
      group.dispose();
    }
    this.selectedCommitResourceGroup?.dispose();
  }
}

function getResourceStateCommand(
  fileStatus: FileStatus,
  beforeUri: vscode.Uri,
  afterUri: vscode.Uri,
  diffTitleSuffix: string,
  fileClickAction: "diff" | "at-revision" | "working-copy",
  workingCopyUri: vscode.Uri,
  isConflicted: boolean,
  changeId?: string,
): vscode.Command {
  if (isConflicted) {
    return {
      title: "Resolve Conflict",
      command: "jj.openMergeEditor",
      arguments: [workingCopyUri, changeId],
    };
  }
  if (fileStatus.type === "D") {
    if (fileClickAction === "diff") {
      return {
        title: "Open",
        command: "vscode.diff",
        arguments: [
          beforeUri,
          toJJUri(vscode.Uri.file(fileStatus.path), { deleted: true }),
          `${fileStatus.file} ${diffTitleSuffix}`,
        ],
      };
    }
    return {
      title: "Open",
      command: "vscode.open",
      arguments: [beforeUri, {} satisfies vscode.TextDocumentShowOptions, `${fileStatus.file} (Deleted)`],
    };
  }
  if (fileClickAction === "at-revision") {
    return {
      title: "Open",
      command: "vscode.open",
      arguments: [afterUri, {}],
    };
  }
  if (fileClickAction === "working-copy") {
    return {
      title: "Open",
      command: "vscode.open",
      arguments: [workingCopyUri, {}],
    };
  }
  return {
    title: "Open",
    command: "vscode.diff",
    arguments: [
      beforeUri,
      afterUri,
      (fileStatus.renamedFrom ? `${fileStatus.renamedFrom} => ` : "") + `${fileStatus.file} ${diffTitleSuffix}`,
    ],
  };
}
