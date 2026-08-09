import path from "path";
import os from "os";
import fs from "fs";
import * as vscode from "vscode";
import { resolveRev, toJJUri } from "./uri";
import { diffKey, interdiffKey, type JJDecorationProvider } from "./decoration-provider";
import { logger } from "./logger";
import { anyEvent, filterEvent } from "./vscode-utils";
import { formatChangeIdShort, formatComparisonRev, formatDiffTitle, formatRevSuffix, normalizePath } from "./utils";
import { JJFileSystemProvider } from "./file-system-provider";
import { getConfigArgs, getJJPath } from "./config";
import { collectProcessOutput, spawnJJ, CancelledError } from "./process";
import { extensionDir } from "./config";
import { JJRepository } from "./repository";
import { StaleWorkingCopyError } from "./errors";
import type { FileStatus, RepositoryStatus, Show, Change } from "./types";
import { TIMEOUTS, MINIMUM_JJ_VERSION, type JJVersion } from "./constants";

const checkedJjVersions = new Map<string, JJVersion | undefined>();

async function checkJJVersion(jjFilepath: string): Promise<JJVersion | undefined> {
  if (checkedJjVersions.has(jjFilepath)) {
    return checkedJjVersions.get(jjFilepath);
  }

  let version: JJVersion | undefined;
  try {
    const output = await collectProcessOutput(
      spawnJJ(jjFilepath, ["version", "--ignore-working-copy"], {
        timeout: TIMEOUTS.DEFAULT,
        cwd: os.homedir(),
      }),
    );
    const match = output.stdout
      .toString()
      .trim()
      .match(/^jj (\d+)\.(\d+)\.(\d+)/);
    if (match) {
      version = {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
      };
      if (
        version.major < MINIMUM_JJ_VERSION.major ||
        (version.major === MINIMUM_JJ_VERSION.major && version.minor < MINIMUM_JJ_VERSION.minor)
      ) {
        void vscode.window.showErrorMessage(
          `Jujutsu X requires jj version ${MINIMUM_JJ_VERSION.major}.${MINIMUM_JJ_VERSION.minor}.${MINIMUM_JJ_VERSION.patch} or later. It may work incorrectly with the currently installed version: ${version.major}.${version.minor}.${version.patch}.`,
        );
      }
    }
  } catch (error) {
    logger.error(`Failed to check jj version: ${String(error)}`);
  }

  checkedJjVersions.set(jjFilepath, version);
  return version;
}

export class WorkspaceSourceControlManager {
  private repoInfos: Map<
    string,
    {
      jjPath: Awaited<ReturnType<typeof getJJPath>>;
      jjConfigArgs: string[];
      repoRoot: string;
      jjVersion: JJVersion | undefined;
    }
  > = new Map();
  repoSCMs: RepositorySourceControlManager[] = [];
  subscriptions: {
    dispose(): unknown;
  }[] = [];
  fileSystemProvider: JJFileSystemProvider;
  private cancellationTokenSource = new vscode.CancellationTokenSource();
  jjBinaryNotFound = false;
  noRepoFound = false;
  private errorSourceControl: vscode.SourceControl | undefined;
  private errorResourceGroup: vscode.SourceControlResourceGroup | undefined;

  private _onDidRepoUpdate = new vscode.EventEmitter<{
    repoSCM: RepositorySourceControlManager;
    operationId?: string;
  }>();
  readonly onDidRepoUpdate: vscode.Event<{
    repoSCM: RepositorySourceControlManager;
    operationId?: string;
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

  private showErrorState(placeholder: string, label: string) {
    if (this.errorSourceControl) {
      return;
    }
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return;
    }
    const rootUri = workspaceFolders[0].uri;
    this.errorSourceControl = vscode.scm.createSourceControl("jj", "Jujutsu", rootUri);
    this.errorSourceControl.inputBox.placeholder = placeholder;
    this.errorResourceGroup = this.errorSourceControl.createResourceGroup("error", label);
  }

  private clearErrorState() {
    if (!this.errorSourceControl) {
      return;
    }
    this.errorSourceControl.dispose();
    this.errorSourceControl = undefined;
    this.errorResourceGroup = undefined;
  }

  async refresh(token?: vscode.CancellationToken) {
    const effectiveToken = token ?? this.cancellationTokenSource.token;

    const newRepoInfos = new Map<
      string,
      {
        jjPath: Awaited<ReturnType<typeof getJJPath>>;
        jjConfigArgs: string[];
        repoRoot: string;
        jjVersion: JJVersion | undefined;
      }
    >();
    let anyBinaryNotFound = false;
    for (const workspaceFolder of vscode.workspace.workspaceFolders || []) {
      if (effectiveToken.isCancellationRequested) {
        return false;
      }
      try {
        const jjPath = await getJJPath(workspaceFolder.uri.fsPath);
        if (effectiveToken.isCancellationRequested) {
          return false;
        }
        const jjVersion = await checkJJVersion(jjPath.filepath);
        if (effectiveToken.isCancellationRequested) {
          return false;
        }
        const jjConfigArgs = getConfigArgs(extensionDir);

        let repoRoot = (
          await collectProcessOutput(
            spawnJJ(jjPath.filepath, ["--ignore-working-copy", "root"], {
              timeout: TIMEOUTS.DEFAULT,
              cwd: workspaceFolder.uri.fsPath,
            }),
            effectiveToken,
          )
        ).stdout
          .toString()
          .trim();
        try {
          repoRoot = fs.realpathSync.native(repoRoot);
        } catch {
          // Fall back to original path if realpath fails
        }
        if (effectiveToken.isCancellationRequested) {
          return false;
        }

        const repoUri = vscode.Uri.file(repoRoot.replace(/^\\\\\?\\UNC\\/, "\\\\")).toString();

        if (!newRepoInfos.has(repoUri)) {
          newRepoInfos.set(repoUri, {
            jjPath,
            jjConfigArgs,
            repoRoot,
            jjVersion,
          });
        }
      } catch (e) {
        if (e instanceof CancelledError) {
          return false;
        }
        if (e instanceof Error && e.message.includes("no jj repo in")) {
          logger.debug(`No jj repo in ${workspaceFolder.uri.fsPath}`);
        } else {
          if (
            e instanceof Error &&
            (e.message.includes("jj CLI not found") || e.message.includes("jjx.jjPath is not an executable"))
          ) {
            anyBinaryNotFound = true;
          }
          logger.error(`Error while initializing jjx in workspace ${workspaceFolder.uri.fsPath}: ${String(e)}`);
        }
        continue;
      }
    }

    const oldRepoInfos = this.repoInfos;

    const oldRepoSCMsByKey = new Map<string, RepositorySourceControlManager>();
    for (const repoSCM of this.repoSCMs) {
      const key = vscode.Uri.file(repoSCM.repositoryRoot.replace(/^\\\\\?\\UNC\\/, "\\\\")).toString();
      oldRepoSCMsByKey.set(key, repoSCM);
    }

    const keysToRecreate = new Set<string>();
    const keysToRemove = new Set<string>();
    let isAnyRepoChanged = false;

    for (const [key, value] of newRepoInfos) {
      const oldValue = oldRepoInfos.get(key);
      if (!oldValue) {
        isAnyRepoChanged = true;
        keysToRecreate.add(key);
        logger.info(`Detected new jj repo in workspace: ${key}`);
      } else if (
        oldValue.jjPath.filepath !== value.jjPath.filepath ||
        oldValue.jjConfigArgs.join(" ") !== value.jjConfigArgs.join(" ") ||
        oldValue.repoRoot !== value.repoRoot
      ) {
        isAnyRepoChanged = true;
        keysToRecreate.add(key);
        logger.info(`Detected change that requires reinitialization in workspace: ${key}`);
      }
    }
    for (const key of oldRepoInfos.keys()) {
      if (!newRepoInfos.has(key)) {
        isAnyRepoChanged = true;
        keysToRemove.add(key);
        logger.info(`Detected jj repo removal in workspace: ${key}`);
      }
    }

    this.repoInfos = newRepoInfos;
    this.decorationProvider.removeStaleRepositories([...newRepoInfos.values()].map(({ repoRoot }) => repoRoot));

    for (const key of keysToRemove) {
      oldRepoSCMsByKey.get(key)?.dispose();
      oldRepoSCMsByKey.delete(key);
    }
    for (const key of keysToRecreate) {
      oldRepoSCMsByKey.get(key)?.dispose();
      oldRepoSCMsByKey.delete(key);
    }

    const updatedRepoSCMs = [...oldRepoSCMsByKey.values()];
    for (const key of keysToRecreate) {
      if (effectiveToken.isCancellationRequested) {
        break;
      }
      const { repoRoot, jjPath, jjConfigArgs, jjVersion } = newRepoInfos.get(key)!;
      logger.info(`Initializing jjx in workspace ${key}. Using jj at ${jjPath.filepath} (${jjPath.source}).`);
      const repoSCM = new RepositorySourceControlManager(
        repoRoot,
        this.decorationProvider,
        this.fileSystemProvider,
        jjPath.filepath,
        jjConfigArgs,
        jjVersion,
      );
      repoSCM.onDidUpdate(
        (e) => {
          this._onDidRepoUpdate.fire({ repoSCM, operationId: e?.operationId });
        },
        undefined,
        repoSCM.subscriptions,
      );
      updatedRepoSCMs.push(repoSCM);
    }
    this.repoSCMs = updatedRepoSCMs;
    void vscode.commands.executeCommand("setContext", "jj.hasMultipleRepos", updatedRepoSCMs.length > 1);

    if (updatedRepoSCMs.length > 0) {
      this.clearErrorState();
      this.jjBinaryNotFound = false;
      this.noRepoFound = false;
      void vscode.commands.executeCommand("setContext", "jj.jjBinaryFound", true);
    } else if (anyBinaryNotFound) {
      this.jjBinaryNotFound = true;
      this.noRepoFound = false;
      this.showErrorState("Waiting for jj binary...", "Error: jj binary not found");
      void vscode.commands.executeCommand("setContext", "jj.jjBinaryFound", false);
    } else {
      this.jjBinaryNotFound = false;
      this.noRepoFound = true;
      this.showErrorState("No Repository Found", "No jj repository found");
      void vscode.commands.executeCommand("setContext", "jj.jjBinaryFound", true);
    }

    return isAnyRepoChanged;
  }

  getRepositorySourceControlManagerFromSourceControl(sourceControl: vscode.SourceControl) {
    return this.repoSCMs.find((repo) => repo.sourceControl === sourceControl);
  }

  getRepositoryFromSourceControl(sourceControl: vscode.SourceControl) {
    return this.getRepositorySourceControlManagerFromSourceControl(sourceControl)?.repository;
  }

  getByRoot(root: string) {
    return this.repoSCMs.find((repo) => repo.repositoryRoot === root);
  }

  getRepositorySourceControlManagerFromUri(uri: vscode.Uri) {
    let fsPath = uri.fsPath;
    try {
      fsPath = fs.realpathSync.native(fsPath);
    } catch {
      // File may not exist on disk (e.g., jj:// URI)
    }
    const realFsPath = fsPath;
    return this.repoSCMs.find((repo) => {
      return !path.relative(repo.repositoryRoot, realFsPath).startsWith("..");
    });
  }

  getRepositoryFromUri(uri: vscode.Uri) {
    return this.getRepositorySourceControlManagerFromUri(uri)?.repository;
  }

  getRepositorySourceControlManagerFromResourceGroup(resourceGroup: vscode.SourceControlResourceGroup) {
    return this.repoSCMs.find(
      (repo) =>
        repo.workingCopyResourceGroup === resourceGroup ||
        repo.untrackedResourceGroup === resourceGroup ||
        repo.parentResourceGroups.includes(resourceGroup) ||
        repo.selectedCommitResourceGroup === resourceGroup ||
        repo.diffResourceGroup === resourceGroup,
    );
  }

  getRepositoryFromResourceGroup(resourceGroup: vscode.SourceControlResourceGroup) {
    return this.getRepositorySourceControlManagerFromResourceGroup(resourceGroup)?.repository;
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
        repo.untrackedResourceGroup,
        ...repo.parentResourceGroups,
        ...(repo.selectedCommitResourceGroup ? [repo.selectedCommitResourceGroup] : []),
        ...(repo.diffResourceGroup ? [repo.diffResourceGroup] : []),
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
    this.cancellationTokenSource.cancel();
    this.cancellationTokenSource.dispose();
    for (const subscription of this.repoSCMs) {
      subscription.dispose();
    }
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    this.repoInfos.clear();
    this.repoSCMs = [];
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

export type ForceRefresh = "force" | "if-changed";

// A from/to comparison selection in the SCM view.
interface DiffSelection {
  from: string;
  to: string;
  fromIsWorkingCopy: boolean;
  toIsWorkingCopy: boolean;
  fromChangeOffset: string | null;
  toChangeOffset: string | null;
}

class RepositorySourceControlManager {
  subscriptions: {
    dispose(): unknown;
  }[] = [];
  sourceControl: vscode.SourceControl;
  workingCopyResourceGroup: vscode.SourceControlResourceGroup;
  untrackedResourceGroup: vscode.SourceControlResourceGroup;
  parentResourceGroups: vscode.SourceControlResourceGroup[] = [];
  selectedCommitResourceGroup: vscode.SourceControlResourceGroup | undefined;
  selectedCommitShowResult: Show | undefined;
  selectedCommitChangeId: string | undefined;
  diffResourceGroup: vscode.SourceControlResourceGroup | undefined;
  diffSelection: DiffSelection | undefined;
  diffFileStatuses: FileStatus[] | undefined;
  diffMode: "diff" | "interdiff" = "diff";
  repository: JJRepository;
  checkForUpdatesPromise: Promise<void> | undefined;
  // True when a "force" refresh was requested while another refresh was already in flight. The
  // next refresh honors it so the force intent is not dropped by coalescing.
  forceRefreshPending = false;
  private cancellationTokenSource = new vscode.CancellationTokenSource();

  private _onDidUpdate = new vscode.EventEmitter<{ operationId?: string }>();
  readonly onDidUpdate: vscode.Event<{ operationId?: string }> = this._onDidUpdate.event;

  operationId: string | undefined;
  fileStatusesByChange: Map<string, FileStatus[]> = new Map();
  conflictedFilesByChange: Map<string, Set<string>> = new Map();
  trackedFiles: Set<string> = new Set();
  status: RepositoryStatus | undefined;
  parentShowResults: Map<string, Show> = new Map();
  private watcherDebounceTimer: NodeJS.Timeout | undefined;

  constructor(
    public repositoryRoot: string,
    private decorationProvider: JJDecorationProvider,
    private fileSystemProvider: JJFileSystemProvider,
    jjPath: string,
    jjConfigArgs: string[],
    jjVersion: JJVersion | undefined,
  ) {
    this.repository = new JJRepository(repositoryRoot, jjPath, jjConfigArgs, jjVersion);

    this.sourceControl = vscode.scm.createSourceControl("jj", "Jujutsu", vscode.Uri.file(repositoryRoot));
    this.subscriptions.push(this.sourceControl);

    this.workingCopyResourceGroup = this.sourceControl.createResourceGroup("@", "Working Copy");
    this.subscriptions.push(this.workingCopyResourceGroup);

    // Created immediately after the working copy group so that VS Code (which
    // renders SCM resource groups in creation order) places "Untracked Files"
    // directly below "Working Copy". Hidden when empty so it only appears when
    // there are untracked files.
    this.untrackedResourceGroup = this.sourceControl.createResourceGroup("untracked", "Untracked Files");
    this.untrackedResourceGroup.hideWhenEmpty = true;
    this.subscriptions.push(this.untrackedResourceGroup);

    this.updatePlaceholderText();

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
    opstoreChangedWatchEvent(() => this.handleWatcherEvent(), undefined, this.subscriptions);

    const repoChangedWatchEvent = filterEvent(
      anyEvent(repoWatcher.onDidCreate, repoWatcher.onDidChange, repoWatcher.onDidDelete),
      (uri) => {
        let realFsPath = uri.fsPath;
        try {
          realFsPath = fs.realpathSync.native(realFsPath);
        } catch {
          // File may have been deleted
        }
        const relativePath = path.relative(this.repositoryRoot, realFsPath);
        const segments = relativePath.split(path.sep);
        return !segments.includes(".jj") && !segments.includes(".git");
      },
    );
    repoChangedWatchEvent(() => this.handleWatcherEvent(), undefined, this.subscriptions);
  }

  private handleWatcherEvent() {
    if (this.watcherDebounceTimer) {
      clearTimeout(this.watcherDebounceTimer);
    }
    this.watcherDebounceTimer = setTimeout(() => {
      this.watcherDebounceTimer = undefined;
      this.fileSystemProvider.onDidChangeRepository({
        repositoryRoot: this.repositoryRoot,
      });
      void this.checkForUpdates(undefined, "if-changed");
    }, TIMEOUTS.REPO_WATCHER_DEBOUNCE);
  }

  updatePlaceholderText() {
    this.sourceControl.inputBox.placeholder = "Commit Message... (Ctrl+Enter or Shift+Ctrl+Enter)";
  }

  async checkForUpdates(token: vscode.CancellationToken | undefined, forceRefresh: ForceRefresh) {
    const effectiveToken = token ?? this.cancellationTokenSource.token;
    if (forceRefresh === "force") {
      // Register the intent up front so it is not dropped when this call is coalesced onto an
      // in-flight refresh below.
      this.forceRefreshPending = true;
    }

    // Loop instead of just awaiting an in-flight refresh so that a "force" request is never lost
    // and so a "force" caller does not resolve until a force refresh has actually completed.
    // The single-threaded async runtime means only one caller executes between awaits, so
    // checkForUpdatesPromise doubles as a coalescing lock.
    let observedRefresh = false;
    for (;;) {
      if (this.checkForUpdatesPromise) {
        await this.checkForUpdatesPromise;
        observedRefresh = true;
        continue;
      }
      const pendingForce = this.forceRefreshPending;
      // An if-changed caller that already joined a refresh is done unless a force is pending.
      if (!pendingForce && observedRefresh) {
        return;
      }
      this.forceRefreshPending = false;
      const refreshForce: ForceRefresh = pendingForce ? "force" : "if-changed";
      this.checkForUpdatesPromise = this.checkForUpdatesUnsafe(effectiveToken, refreshForce).catch((e) => {
        if (e instanceof CancelledError) {
          return;
        }
        throw e;
      });
      try {
        await this.checkForUpdatesPromise;
      } finally {
        this.checkForUpdatesPromise = undefined;
      }
      observedRefresh = true;
    }
  }

  /**
   * This should never be called concurrently.
   */
  async checkForUpdatesUnsafe(token: vscode.CancellationToken, forceRefresh: ForceRefresh) {
    let latestOperationId: string;
    try {
      latestOperationId = await this.repository.getLatestOperationId(false, token);
      if (token.isCancellationRequested) {
        return;
      }
      this.repository.resetAutoUpdateStaleAttempted();
    } catch (error) {
      if (error instanceof CancelledError) {
        return;
      }
      if (error instanceof StaleWorkingCopyError) {
        const didAutoUpdate = await this.repository.tryAutoUpdateStale(token);
        if (token.isCancellationRequested) {
          return;
        }
        if (didAutoUpdate) {
          await this.checkForUpdatesUnsafe(token, forceRefresh);
          return;
        }
        // Need to update the graph view to show the stale state.
        this._onDidUpdate.fire({});
      }
      throw error;
    }
    if (token.isCancellationRequested) {
      return;
    }
    if (this.operationId !== latestOperationId || forceRefresh === "force") {
      this.operationId = latestOperationId;
      const status = await this.repository.getStatus(false, token, latestOperationId);

      if (token.isCancellationRequested) {
        return;
      }
      await this.updateState(status, token, latestOperationId);
      if (token.isCancellationRequested) {
        return;
      }
      this.render();

      this._onDidUpdate.fire({ operationId: latestOperationId });
    }
  }

  async updateState(status: RepositoryStatus, token: vscode.CancellationToken, operationId?: string) {
    const newTrackedFiles = new Set<string>();
    const newParentShowResults = new Map<string, Show>();
    const newFileStatusesByChange = new Map<string, FileStatus[]>([["@", status.fileStatuses]]);
    const newConflictedFilesByChange = new Map<string, Set<string>>([["@", status.conflictedFiles]]);

    const trackedFilesList = await this.repository.fileList(token, operationId);
    if (token.isCancellationRequested) {
      return;
    }
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
      const rev = parentChange.changeId.changeId;
      const showResult = await this.repository.show(rev, token, operationId);
      return { changeId: parentChange.changeId.changeId, showResult };
    });

    const parentShowResultsArray = await Promise.all(parentShowPromises);
    if (token.isCancellationRequested) {
      return;
    }

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
      parts.push(` [${formatChangeIdShort(change.changeId.changeId, change.changeId.changeOffset)}]`);
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
    this.workingCopyResourceGroup.resourceStates = buildResourceStates(this.status.fileStatuses, {
      diffTitleSuffix: "(Working Copy)",
      fileClickAction,
      conflictedFiles: this.status.conflictedFiles,
    });
    this.sourceControl.count = this.status.fileStatuses.length;

    this.untrackedResourceGroup.resourceStates = buildUntrackedResourceStates(this.status.untrackedFiles);

    const showParentChangeId = this.status.parentChanges.length > 1;
    const desiredParentIds = this.status.parentChanges.map((change) => change.changeId.changeId);
    const currentParentIds = this.parentResourceGroups.map((group) => group.id);
    const parentOrderMatches =
      currentParentIds.length === desiredParentIds.length &&
      currentParentIds.every((id, index) => id === desiredParentIds[index]);
    if (!parentOrderMatches) {
      // VS Code displays source control resource groups in creation order, and there is no
      // API to reorder them. Recreate the parent groups whenever jj's reported parent order
      // (or set of parents) changes so the change view matches jj's native ordering.
      for (const group of this.parentResourceGroups) {
        group.dispose();
      }
      this.parentResourceGroups = [];
    }

    let newParentCreated = false;
    for (const parentChange of this.status.parentChanges) {
      let parentChangeResourceGroup = this.parentResourceGroups.find(
        (group) => group.id === parentChange.changeId.changeId,
      );
      if (!parentChangeResourceGroup) {
        parentChangeResourceGroup = this.sourceControl.createResourceGroup(
          parentChange.changeId.changeId,
          RepositorySourceControlManager.getLabel("Parent Commit", parentChange, showParentChangeId),
        );
        this.parentResourceGroups.push(parentChangeResourceGroup);
        newParentCreated = true;
      } else {
        parentChangeResourceGroup.label = RepositorySourceControlManager.getLabel(
          "Parent Commit",
          parentChange,
          showParentChangeId,
        );
      }

      const showResult = this.parentShowResults.get(parentChange.changeId.changeId);
      if (showResult) {
        parentChangeResourceGroup.resourceStates = buildResourceStates(showResult.fileStatuses, {
          changeId: parentChange.changeId.changeId,
          diffTitleSuffix: formatRevSuffix(parentChange.changeId.changeId),
          fileClickAction,
          conflictedFiles: this.conflictedFilesByChange.get(parentChange.changeId.changeId),
        });
      }
    }

    // VS Code renders SCM groups in creation order with no reorder API. Always
    // dispose the tail group here and let it be recreated below the parents.
    if (newParentCreated) {
      this.selectedCommitResourceGroup?.dispose();
      this.selectedCommitResourceGroup = undefined;
      this.diffResourceGroup?.dispose();
      this.diffResourceGroup = undefined;
    }

    if (this.selectedCommitShowResult) {
      const changeId = this.selectedCommitShowResult.change.changeId.changeId;
      this.selectedCommitChangeId = changeId;
      const isParent = this.status.parentChanges.some((p) => p.changeId.changeId === changeId);
      const isWorkingCopy = this.status.workingCopy.changeId.changeId === changeId;
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
        this.selectedCommitResourceGroup.resourceStates = buildResourceStates(
          this.selectedCommitShowResult.fileStatuses,
          {
            changeId,
            diffTitleSuffix: formatRevSuffix(changeId),
            fileClickAction,
            conflictedFiles: this.conflictedFilesByChange.get(changeId),
          },
        );
      }
    } else {
      this.selectedCommitResourceGroup?.dispose();
      this.selectedCommitResourceGroup = undefined;
      this.selectedCommitChangeId = undefined;
    }

    if (this.diffSelection && this.diffFileStatuses) {
      const { from, to, fromIsWorkingCopy, toIsWorkingCopy, fromChangeOffset, toChangeOffset } = this.diffSelection;
      // The resource group id encodes the current mode ("diff" vs "interdiff") so the
      // per-group inline quick actions (View Interdiff / View Regular Diff) and resource-state
      // context menus can target the right section. Recreate the group when the mode changes.
      if (this.diffResourceGroup && this.diffResourceGroup.id !== this.diffMode) {
        this.diffResourceGroup.dispose();
        this.diffResourceGroup = undefined;
      }
      if (!this.diffResourceGroup) {
        this.diffResourceGroup = this.sourceControl.createResourceGroup(this.diffMode, "");
      }
      const fromShort = formatComparisonRev(from, fromChangeOffset, fromIsWorkingCopy, "Working Copy");
      const toShort = formatComparisonRev(to, toChangeOffset, toIsWorkingCopy, "Working Copy");
      this.diffResourceGroup.label =
        this.diffMode === "interdiff" ? `Interdiff ${fromShort} → ${toShort}` : `Diff ${fromShort} → ${toShort}`;
      this.diffResourceGroup.resourceStates = buildComparisonDiffResourceStates(this.diffFileStatuses, {
        from,
        to,
        mode: this.diffMode,
        fromIsWorkingCopy,
        toIsWorkingCopy,
        fromChangeOffset,
        toChangeOffset,
      });
    } else {
      this.diffResourceGroup?.dispose();
      this.diffResourceGroup = undefined;
    }

    const combinedFileStatusesByChange = new Map(this.fileStatusesByChange);
    if (this.selectedCommitShowResult && this.selectedCommitChangeId) {
      combinedFileStatusesByChange.set(
        this.selectedCommitShowResult.change.changeId.changeId,
        this.selectedCommitShowResult.fileStatuses,
      );
    }
    if (this.diffSelection && this.diffFileStatuses) {
      combinedFileStatusesByChange.set(
        this.diffMode === "interdiff"
          ? interdiffKey(this.diffSelection.from, this.diffSelection.to)
          : diffKey(this.diffSelection.from, this.diffSelection.to),
        this.diffFileStatuses,
      );
    }
    this.decorationProvider.onRefresh(
      this.repositoryRoot,
      combinedFileStatusesByChange,
      this.trackedFiles,
      this.conflictedFilesByChange,
      this.status.untrackedFiles,
    );
  }

  async setSelectedCommit(changeId: string | undefined) {
    if (
      !changeId ||
      (this.status &&
        (this.status.workingCopy.changeId.changeId === changeId ||
          this.status.parentChanges.some((p) => p.changeId.changeId === changeId)))
    ) {
      this.selectedCommitShowResult = undefined;
    } else {
      this.selectedCommitShowResult = await this.repository.show(changeId);
    }
    this.render();
  }

  /**
   * Called when the graph selection changes. Selecting two changes shows a from/to diff
   * by default and resets any prior interdiff toggle.
   */
  async setDiffSelection(
    from?: string,
    to?: string,
    options?: {
      fromIsWorkingCopy?: boolean;
      toIsWorkingCopy?: boolean;
      fromChangeOffset?: string | null;
      toChangeOffset?: string | null;
    },
  ) {
    this.diffMode = "diff";
    if (from && to) {
      this.diffSelection = {
        from,
        to,
        fromIsWorkingCopy: options?.fromIsWorkingCopy ?? false,
        toIsWorkingCopy: options?.toIsWorkingCopy ?? false,
        fromChangeOffset: options?.fromChangeOffset ?? null,
        toChangeOffset: options?.toChangeOffset ?? null,
      };
      this.diffFileStatuses = await this.repository.comparisonSummary("diff", from, to);
    } else {
      this.diffSelection = undefined;
      this.diffFileStatuses = undefined;
    }
    this.render();
  }

  /**
   * Switches the two-selection section between a regular from/to diff and an interdiff. The
   * chosen mode persists across refreshes, commits, etc. until the graph selection changes
   * (which resets it via {@link setDiffSelection}).
   */
  async setDiffMode(mode: "diff" | "interdiff") {
    if (!this.diffSelection) {
      return;
    }
    this.diffMode = mode;
    const { from, to } = this.diffSelection;
    this.diffFileStatuses = await this.repository.comparisonSummary(mode, from, to);
    this.render();
  }

  dispose() {
    this.cancellationTokenSource.cancel();
    this.cancellationTokenSource.dispose();
    if (this.watcherDebounceTimer) {
      clearTimeout(this.watcherDebounceTimer);
      this.watcherDebounceTimer = undefined;
    }
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
    for (const group of this.parentResourceGroups) {
      group.dispose();
    }
    this.selectedCommitResourceGroup?.dispose();
    this.diffResourceGroup?.dispose();
  }
}

function buildResourceStates(
  fileStatuses: FileStatus[],
  options: {
    changeId?: string;
    diffTitleSuffix: string;
    fileClickAction: "diff" | "at-revision" | "working-copy";
    conflictedFiles: Set<string> | undefined;
  },
): vscode.SourceControlResourceState[] {
  const { changeId, diffTitleSuffix, fileClickAction, conflictedFiles } = options;
  const diffOriginalRev = changeId ?? "@";

  return fileStatuses.map((fileStatus) => {
    const workingCopyUri = vscode.Uri.file(fileStatus.path);
    const isConflicted = conflictedFiles?.has(normalizePath(fileStatus.path)) ?? false;
    const beforeUri =
      fileStatus.type === "A"
        ? toJJUri(vscode.Uri.file(fileStatus.path), { deleted: true })
        : toJJUri(vscode.Uri.file(fileStatus.path), {
            diffOriginalRev,
            ...(fileStatus.renamedFrom ? { renamedFrom: fileStatus.renamedFrom } : {}),
          });
    const afterUri = changeId ? toJJUri(vscode.Uri.file(fileStatus.path), { rev: changeId }) : workingCopyUri;
    return {
      resourceUri: afterUri,
      decorations: {
        strikeThrough: fileStatus.type === "D",
        tooltip: path.basename(fileStatus.file),
      },
      command: getResourceStateCommand(
        fileStatus,
        beforeUri,
        afterUri,
        diffTitleSuffix,
        fileClickAction,
        workingCopyUri,
        isConflicted,
        changeId,
      ),
    };
  });
}

function buildUntrackedResourceStates(fileStatuses: FileStatus[]): vscode.SourceControlResourceState[] {
  return fileStatuses.map((fileStatus) => {
    const fileUri = vscode.Uri.file(fileStatus.path);
    return {
      resourceUri: fileUri,
      decorations: {
        tooltip: "Untracked",
      },
      command: {
        title: "Open File",
        command: "vscode.open",
        arguments: [fileUri],
      },
    };
  });
}

function buildComparisonDiffResourceStates(
  fileStatuses: FileStatus[],
  options: {
    from: string;
    to: string;
    mode: "diff" | "interdiff";
    fromIsWorkingCopy: boolean;
    toIsWorkingCopy: boolean;
    fromChangeOffset: string | null;
    toChangeOffset: string | null;
  },
): vscode.SourceControlResourceState[] {
  const { from, to, mode, fromChangeOffset, toChangeOffset, fromIsWorkingCopy, toIsWorkingCopy } = options;
  const fromShort = formatComparisonRev(from, fromChangeOffset, fromIsWorkingCopy);
  const toShort = formatComparisonRev(to, toChangeOffset, toIsWorkingCopy);
  const label = mode === "interdiff" ? "Interdiff" : "Diff";
  return fileStatuses.map((fileStatus) => {
    const fileUri = vscode.Uri.file(fileStatus.path);
    const makeSideUri = (side: "left" | "right"): vscode.Uri =>
      mode === "interdiff"
        ? toJJUri(fileUri, { interdiffFrom: from, interdiffTo: to, side })
        : toJJUri(fileUri, { diffFrom: from, diffTo: to, side });
    const leftUri = fileStatus.type === "A" ? toJJUri(fileUri, { deleted: true }) : makeSideUri("left");
    const rightUri = fileStatus.type === "D" ? toJJUri(fileUri, { deleted: true }) : makeSideUri("right");
    return {
      resourceUri: makeSideUri("right"),
      decorations: {
        strikeThrough: fileStatus.type === "D",
        tooltip: path.basename(fileStatus.file),
      },
      command: {
        title: "Open",
        command: "vscode.diff",
        arguments: [
          leftUri,
          rightUri,
          formatDiffTitle(fileStatus.renamedFrom, fileStatus.file, `${label} ${fromShort} → ${toShort}`),
        ],
      },
    };
  });
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
  if (isConflicted && changeId !== undefined) {
    return {
      title: "Resolve Conflict",
      command: "jj.openMergeEditor",
      arguments: [workingCopyUri, changeId],
    };
  }
  const fallback = computeFallbackCommand(
    fileStatus,
    beforeUri,
    afterUri,
    diffTitleSuffix,
    fileClickAction,
    workingCopyUri,
  );
  if (changeId === undefined) {
    return {
      title: isConflicted ? "Resolve Conflict" : fallback.title,
      command: "jj.openWorkingCopyFile",
      arguments: [workingCopyUri, { command: fallback.command, args: fallback.arguments ?? [] }],
    };
  }
  return fallback;
}

function computeFallbackCommand(
  fileStatus: FileStatus,
  beforeUri: vscode.Uri,
  afterUri: vscode.Uri,
  diffTitleSuffix: string,
  fileClickAction: "diff" | "at-revision" | "working-copy",
  workingCopyUri: vscode.Uri,
): vscode.Command {
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
    arguments: [beforeUri, afterUri, formatDiffTitle(fileStatus.renamedFrom, fileStatus.file, diffTitleSuffix)],
  };
}
