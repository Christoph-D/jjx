import * as vscode from "vscode";
import path from "path";
import "./repository";
import { initExtensionDir } from "./config";
import { provideOriginalResource, WorkspaceSourceControlManager } from "./sourceControl";
import type { JJRepository } from "./repository";
import type { ChangeWithDetails, FileStatus } from "./types";
import { JJDecorationProvider } from "./decorationProvider";
import { OperationLogManager, OperationLogTreeDataProvider, OperationTreeItem } from "./operationLogTreeView";
import { JJGraphWebview } from "./graphWebview";
import { getParams, resolveRev, toJJUri } from "./uri";
import { initLogger, logger } from "./logger";
import { linesDiffComputers } from "./vendor/vscode/editor/common/diff/linesDiffComputers";
import { ILinesDiffComputer } from "./vendor/vscode/editor/common/diff/linesDiffComputer";
import { toLineChanges, toLineRanges, intersectDiffWithRange, applyLineChanges, type LineChange } from "./diffUtils";
import { match } from "arktype";
import { createThrottledAsyncFn, getActiveTextEditorDiff, pathEquals, showErrorMessage } from "./utils";
import { createIPCServer } from "./ipc/ipcServer";
import { JJEditor, JJMergeEditor, JJDiffTool, JJSquashTool, getMergeEditorPath } from "./jjEditor";
import { handleJJCommand, killAllProcesses } from "./process";

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("Jujutsu X", {
    log: true,
  });
  initLogger(outputChannel);
  context.subscriptions.push(outputChannel);

  logger.info("Extension activated");

  initExtensionDir(context.extensionUri);

  try {
    const ipcServer = await createIPCServer();
    context.subscriptions.push(ipcServer);
    const distDir = vscode.Uri.joinPath(context.extensionUri, "dist").fsPath;
    const jjEditor = new JJEditor(ipcServer, distDir);
    context.subscriptions.push(jjEditor);
    const jjMergeEditor = new JJMergeEditor(ipcServer, distDir);
    context.subscriptions.push(jjMergeEditor);
    const jjDiffTool = new JJDiffTool(ipcServer, distDir);
    context.subscriptions.push(jjDiffTool);
    const jjSquashTool = new JJSquashTool(ipcServer, distDir);
    context.subscriptions.push(jjSquashTool);
    logger.info("JJEditor IPC server initialized");
  } catch (error) {
    logger.error(`Failed to initialize JJEditor: ${error instanceof Error ? error.message : String(error)}`);
  }

  const decorationProvider = new JJDecorationProvider((decorationProvider) => {
    context.subscriptions.push(vscode.window.registerFileDecorationProvider(decorationProvider));
  });

  const workspaceSCM = new WorkspaceSourceControlManager(decorationProvider);
  await workspaceSCM.refresh();
  context.subscriptions.push(workspaceSCM);

  let checkReposFunction: (specificFolders?: string[]) => Promise<void>;

  // Check for colocated repositories and warn about Git extension
  await checkColocatedRepositories(workspaceSCM, context);

  const _onDidSetSelectedRepository = new vscode.EventEmitter<void>();
  const onDidSetSelectedRepository = _onDidSetSelectedRepository.event;

  function setSelectedRepo(repository: JJRepository): void {
    context.workspaceState.update("selectedRepository", repository.repositoryRoot);
    _onDidSetSelectedRepository.fire();
  }

  function getSelectedRepo(): JJRepository {
    const selectedRepo = context.workspaceState.get<string>("selectedRepository");
    let repository: JJRepository;

    if (selectedRepo) {
      repository =
        workspaceSCM.repoSCMs.find((repo) => repo.repositoryRoot === selectedRepo)?.repository ||
        workspaceSCM.repoSCMs[0].repository;
    } else {
      repository = workspaceSCM.repoSCMs[0].repository;
    }

    return repository;
  }

  vscode.workspace.onDidChangeWorkspaceFolders(
    async () => {
      logger.info("Workspace folders changed");
      const didUpdate = await workspaceSCM.refresh();
      if (didUpdate) {
        setSelectedRepo(getSelectedRepo());
      }
      await checkReposFunction();
    },
    undefined,
    context.subscriptions,
  );

  vscode.workspace.onDidChangeConfiguration(
    async (e) => {
      if (e.affectsConfiguration("git")) {
        logger.info("Git configuration changed");
        const workspaceFolders = vscode.workspace.workspaceFolders || [];

        const affectedFolders = workspaceFolders
          .filter((folder) => e.affectsConfiguration("git", folder.uri))
          .map((folder) => folder.uri.fsPath);

        if (affectedFolders.length > 0) {
          await checkReposFunction(affectedFolders);
        }
      }
      if (e.affectsConfiguration("jjx.commitAction")) {
        const config = vscode.workspace.getConfiguration("jjx");
        const commitAction = config.get<string>("commitAction") || "commit";
        for (const repoSCM of workspaceSCM.repoSCMs) {
          repoSCM.updatePlaceholderText(commitAction);
        }
      }
      if (e.affectsConfiguration("jjx.fileClickAction")) {
        for (const repoSCM of workspaceSCM.repoSCMs) {
          repoSCM.render();
        }
      }
      if (
        e.affectsConfiguration("jjx.graphStyle") ||
        e.affectsConfiguration("jjx.logLimit") ||
        e.affectsConfiguration("jjx.elideImmutableCommits") ||
        e.affectsConfiguration("jjx.elidedVisibleImmutableParents") ||
        e.affectsConfiguration("jjx.showTooltips")
      ) {
        if (graphWebview) {
          if (e.affectsConfiguration("jjx.elideImmutableCommits")) {
            await graphWebview.resetElideOverride();
          }
          await graphWebview.refresh();
        }
      }
    },
    undefined,
    context.subscriptions,
  );

  let isInitialized = false;
  let graphWebview: JJGraphWebview | undefined;
  function init() {
    const initialSelectedRepo = getSelectedRepo();
    graphWebview = new JJGraphWebview(context.extensionUri, initialSelectedRepo, context);
    context.subscriptions.push(graphWebview);
    onDidSetSelectedRepository(
      async () => {
        await graphWebview!.setSelectedRepository(getSelectedRepo());
      },
      undefined,
      context.subscriptions,
    );

    context.subscriptions.push(
      graphWebview.onDidChangeSelection(async (selectedNodes) => {
        const repoSCM = workspaceSCM.repoSCMs.find((r) => r.repositoryRoot === graphWebview!.repository.repositoryRoot);
        if (repoSCM) {
          const changeId = selectedNodes.length === 1 ? selectedNodes[0] : undefined;
          await repoSCM.setSelectedCommit(changeId);
        }
      }),
    );

    const operationLogTreeDataProvider = new OperationLogTreeDataProvider(initialSelectedRepo);
    const operationLogManager = new OperationLogManager(operationLogTreeDataProvider);
    context.subscriptions.push(operationLogManager);
    onDidSetSelectedRepository(
      async () => {
        await operationLogManager.setSelectedRepo(getSelectedRepo());
      },
      undefined,
      context.subscriptions,
    );

    context.subscriptions.push(
      workspaceSCM.onDidRepoUpdate(({ repoSCM }) => {
        if (
          operationLogManager.operationLogTreeDataProvider.getSelectedRepo().repositoryRoot === repoSCM.repositoryRoot
        ) {
          void operationLogManager.refresh();
        }
        if (graphWebview!.repository.repositoryRoot === repoSCM.repositoryRoot) {
          void graphWebview!.refresh();
        }
      }),
    );

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    context.subscriptions.push(statusBarItem);
    statusBarItem.command = "jj.gitFetch";
    let lastOpenedFileUri: vscode.Uri | undefined;
    const statusBarHandleDidChangeActiveTextEditor = (editor: vscode.TextEditor | undefined) => {
      if (editor && editor.document.uri.scheme === "file") {
        lastOpenedFileUri = editor.document.uri;
        const repository = workspaceSCM.getRepositoryFromUri(lastOpenedFileUri);
        if (repository) {
          const folderName = repository.repositoryRoot.split("/").at(-1)!;
          statusBarItem.text = "$(cloud-download)";
          statusBarItem.tooltip = `${folderName} – Run \`jj git fetch\``;
          statusBarItem.show();
        }
      }
    };
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(statusBarHandleDidChangeActiveTextEditor));
    statusBarHandleDidChangeActiveTextEditor(vscode.window.activeTextEditor);

    const annotationDecoration = vscode.window.createTextEditorDecorationType({
      after: {
        margin: "0 0 0 3em",
        textDecoration: "none",
      },
      rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
    });
    let annotateInfo:
      | {
          uri: vscode.Uri;
          changeIdsByLine: string[];
        }
      | undefined;
    let activeEditorUri: vscode.Uri | undefined;
    let activeLines: number[] = [];
    let lastUniqueChangeIds: string = "";
    let cachedChanges: Map<string, ChangeWithDetails> = new Map();
    const setDecorations = async (editor: vscode.TextEditor, lines: number[]) => {
      const repository = workspaceSCM.getRepositoryFromUri(editor.document.uri);
      if (!repository) {
        return;
      }
      const config = vscode.workspace.getConfiguration("jjx", vscode.Uri.file(repository.repositoryRoot));
      if (!config.get("enableAnnotations")) {
        editor.setDecorations(annotationDecoration, []);
        return;
      }

      if (annotateInfo && annotateInfo.uri === editor.document.uri && activeEditorUri === editor.document.uri) {
        const safeLines = lines.filter((line) => line !== annotateInfo!.changeIdsByLine.length);
        const uniqueChangeIds = [
          ...new Set(safeLines.map((line) => annotateInfo!.changeIdsByLine[line]).filter(Boolean)),
        ];
        const uniqueChangeIdsKey = uniqueChangeIds.sort().join(",");
        if (uniqueChangeIdsKey !== lastUniqueChangeIds) {
          lastUniqueChangeIds = uniqueChangeIdsKey;
          const showResults = await repository.showAll(uniqueChangeIds);
          cachedChanges = new Map<string, ChangeWithDetails>(
            showResults.map((result) => [result.change.changeId.substring(0, 8), result.change]),
          );
        }
        if (annotateInfo && annotateInfo.uri === editor.document.uri && activeEditorUri === editor.document.uri) {
          const decorations: vscode.DecorationOptions[] = [];
          for (const line of safeLines) {
            const changeId = annotateInfo.changeIdsByLine[line];
            if (!changeId) {
              continue; // Could be possible if `annotateInfo` is stale due to the await
            }
            const change = cachedChanges.get(changeId);
            if (!change) {
              continue; // Could be possible if `annotateInfo` is mismatched with `changes` due to a race
            }
            decorations.push({
              renderOptions: {
                after: {
                  backgroundColor: "#00000000",
                  color: "#99999959",
                  contentText: ` ${change.author.name} at ${change.authoredDate} • ${change.description || "(no description)"} • ${change.changeId.substring(
                    0,
                    8,
                  )} `,
                  textDecoration: "none;",
                },
              },
              range: editor.document.validateRange(new vscode.Range(line, 2 ** 30 - 1, line, 2 ** 30 - 1)),
            });
          }
          editor.setDecorations(annotationDecoration, decorations);
        }
      }
    };
    const updateAnnotateInfo = async (uri: vscode.Uri) => {
      if (!["file", "jj"].includes(uri.scheme)) {
        annotateInfo = undefined;
        return;
      }
      const rev = resolveRev(uri, { diffOriginalRevBehavior: "suffix" });
      if (!rev) {
        annotateInfo = undefined;
        return;
      }

      const repository = workspaceSCM.getRepositoryFromUri(uri);
      if (!repository) {
        return;
      }
      const config = vscode.workspace.getConfiguration("jjx", vscode.Uri.file(repository.repositoryRoot));
      if (!config.get("enableAnnotations")) {
        annotateInfo = undefined;
        return;
      }

      try {
        const changeIdsByLine = await repository.annotate(uri.fsPath, rev);
        if (activeEditorUri === uri && changeIdsByLine.length > 0) {
          annotateInfo = { changeIdsByLine, uri };
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("more than one revision")) {
          annotateInfo = undefined;
        } else {
          throw error;
        }
      }
    };
    const handleDidChangeActiveTextEditor = async (editor: vscode.TextEditor | undefined) => {
      if (editor) {
        const uri = editor.document.uri;
        activeEditorUri = uri;
        lastUniqueChangeIds = "";
        cachedChanges.clear();
        await updateAnnotateInfo(uri);
        activeLines = editor.selections.map((selection) => selection.active.line);
        await setDecorations(editor, activeLines);
      }
    };
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(handleDidChangeActiveTextEditor));
    context.subscriptions.push(
      vscode.window.onDidChangeTextEditorSelection(async (e) => {
        activeLines = e.selections.map((selection) => selection.active.line);
        await setDecorations(e.textEditor, activeLines);
      }),
    );
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(async (e) => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.toString() === e.document.uri.toString()) {
          await setDecorations(editor, activeLines);
        }
      }),
    );
    if (vscode.window.activeTextEditor) {
      void handleDidChangeActiveTextEditor(vscode.window.activeTextEditor);
    }

    registerCommand(
      context,
      "jj.new",
      async (sourceControl?: vscode.SourceControl) => {
        if (!sourceControl) {
          sourceControl = workspaceSCM.repoSCMs[0]?.sourceControl;
        }
        if (!sourceControl) {
          throw new Error("Repository not found");
        }
        const repository = workspaceSCM.getRepositoryFromSourceControl(sourceControl);
        if (!repository) {
          throw new Error("Repository not found");
        }
        const config = vscode.workspace.getConfiguration("jjx");
        const commitAction = config.get<string>("commitAction") || "commit";
        const message = sourceControl.inputBox.value.trim() || undefined;
        if (commitAction === "commit") {
          await repository.commit(message);
        } else {
          await repository.new(message);
        }
        sourceControl.inputBox.value = "";
      },
      { errorPrefix: "Failed to create change" },
    );

    registerCommand(
      context,
      "jj.openFileResourceState",
      async (resourceState: vscode.SourceControlResourceState) => {
        const opts: vscode.TextDocumentShowOptions = {
          preserveFocus: false,
          preview: false,
          viewColumn: vscode.ViewColumn.Active,
        };
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(resourceState.resourceUri.fsPath), {
          ...opts,
        });
      },
      { errorPrefix: "Failed to open file" },
    );

    registerCommand(
      context,
      "jj.openFileAtRevision",
      async (resourceState: vscode.SourceControlResourceState) => {
        const uri = resourceState.resourceUri;
        const rev = resolveRev(uri) ?? "@";
        const titleSuffix = rev === "@" ? "(Working Copy)" : `(${rev.substring(0, 8)})`;
        await vscode.commands.executeCommand("vscode.open", uri, {}, `${path.basename(uri.fsPath)} ${titleSuffix}`);
      },
      { errorPrefix: "Failed to open file" },
    );

    registerCommand(
      context,
      "jj.openFileEditor",
      async (uri: vscode.Uri) => {
        if (!["file", "jj"].includes(uri.scheme)) {
          return;
        }

        const rev = resolveRev(uri) ?? "@";

        await vscode.commands.executeCommand(
          "vscode.open",
          uri,
          {},
          `${path.basename(uri.fsPath)} (${rev.substring(0, 8)})`,
        );
      },
      { errorPrefix: "Failed to open file" },
    );

    registerCommand(
      context,
      "jj.openDiffEditor",
      async (uri: vscode.Uri) => {
        const originalUri = provideOriginalResource(uri);
        if (!originalUri) {
          throw new Error("Original resource not found");
        }
        const params = getParams(originalUri);
        if (!("diffOriginalRev" in params)) {
          throw new Error("Original resource does not have a diffOriginalRev. This is a bug.");
        }

        const rev = params.diffOriginalRev;

        const scm = workspaceSCM.getRepositorySourceControlManagerFromUri(originalUri);

        if (!scm) {
          throw new Error("Source Control Manager not found with given URI.");
        }

        const repo = workspaceSCM.getRepositoryFromUri(originalUri);
        if (!repo) {
          throw new Error("Repository could not be found with given URI.");
        }

        const { fileStatuses } = await repo.show(rev);
        const fileStatus = fileStatuses.find((file) => pathEquals(file.path, originalUri.path));

        const diffTitleSuffix = rev === "@" ? "(Working Copy)" : `(${rev.substring(0, 8)})`;
        await vscode.commands.executeCommand(
          "vscode.diff",
          originalUri,
          uri,
          (fileStatus?.renamedFrom ? `${fileStatus.renamedFrom} => ` : "") +
            `${path.basename(originalUri.path)} ${diffTitleSuffix}`,
        );
      },
      { errorPrefix: "Failed to open diff" },
    );

    function getSharedResourceGroup(resourceStates: vscode.SourceControlResourceState[]) {
      if (resourceStates.length === 0) {
        throw new Error("No resources found");
      }

      const [first, ...rest] = resourceStates;
      const resourceGroup = workspaceSCM.getResourceGroupFromResourceState(first);

      for (const resourceState of rest) {
        const stateGroup = workspaceSCM.getResourceGroupFromResourceState(resourceState);
        if (stateGroup !== resourceGroup) {
          throw new Error("All selected resources must belong to the same resource group");
        }
      }

      return resourceGroup;
    }

    registerCommandWithLoading(
      context,
      "jj.restoreResourceState",
      async (...resourceStates: vscode.SourceControlResourceState[]) => {
        const resourceGroup = getSharedResourceGroup(resourceStates);
        const repository = workspaceSCM.getRepositoryFromResourceGroup(resourceGroup);
        if (!repository) {
          throw new Error("Repository not found");
        }

        const scm = workspaceSCM.getRepositorySourceControlManagerFromResourceGroup(resourceGroup);
        if (!scm) {
          throw new Error("SCM not found for resource group");
        }

        let statuses: FileStatus[];
        if (scm.workingCopyResourceGroup === resourceGroup) {
          if (!scm.status) {
            throw new Error("No current working copy change found");
          }
          const repositoryStatus = scm.status;

          statuses = resourceStates.map((resourceState) => {
            const foundStatus = repositoryStatus.fileStatuses.find((status) =>
              pathEquals(status.path, resourceState.resourceUri.fsPath),
            );
            if (!foundStatus) {
              throw new Error("No file status found for the resource in the working copy change");
            }
            return foundStatus;
          });
        } else if (scm.parentResourceGroups.includes(resourceGroup)) {
          const show = scm.parentShowResults.get(resourceGroup.id);
          if (!show) {
            throw new Error("No current parent change show result found for the resource group");
          }

          statuses = resourceStates.map((resourceState) => {
            const foundStatus = show.fileStatuses.find((status) =>
              pathEquals(status.path, resourceState.resourceUri.fsPath),
            );
            if (!foundStatus) {
              throw new Error("No file status found for the resource in the parent change");
            }
            return foundStatus;
          });
        } else if (scm.selectedCommitResourceGroup && scm.selectedCommitResourceGroup === resourceGroup) {
          return;
        } else {
          throw new Error("Resource group was not found in the SCM");
        }

        const paths = statuses.flatMap((status) => [
          status.path,
          ...(status.renamedFrom !== undefined ? [status.renamedFrom] : []),
        ]);

        const fileCount = resourceStates.length;
        const confirmMessage =
          fileCount === 1
            ? `Are you sure you want to discard changes in '${path.relative(repository.repositoryRoot, statuses[0].path)}'?`
            : `Are you sure you want to discard changes in ${fileCount} files?`;
        const confirm = await vscode.window.showWarningMessage(confirmMessage, { modal: true }, "Discard");
        if (confirm !== "Discard") {
          return;
        }

        await repository.restoreRetryImmutable(resourceGroup.id, paths);
      },
      { errorPrefix: "Failed to restore" },
    );

    registerCommandWithLoading(
      context,
      "jj.squashToParentResourceState",
      async (...resourceStates: vscode.SourceControlResourceState[]) => {
        const resourceGroup = getSharedResourceGroup(resourceStates);
        const repository = workspaceSCM.getRepositoryFromResourceGroup(resourceGroup);
        if (!repository) {
          throw new Error("Repository not found");
        }

        const status = await repository.getStatus(true);

        let destinationParentChange = status.parentChanges[0];
        if (status.parentChanges.length > 1) {
          const parentOptions = status.parentChanges.map((parent) => ({
            label: parent.changeId,
            description: parent.description || "(no description)",
            parent,
          }));
          const selection = await vscode.window.showQuickPick(parentOptions, {
            placeHolder: "Select Parent to Squash Into",
          });
          if (!selection) {
            return;
          }
          destinationParentChange = selection.parent;
        } else if (status.parentChanges.length === 0) {
          throw new Error("No parent changes found");
        }

        await repository.squashRetryImmutable({
          fromRev: "@",
          toRev: destinationParentChange.changeId,
          filepaths: resourceStates.map((state) => state.resourceUri.fsPath),
        });
      },
      { errorPrefix: "Failed to squash" },
    );

    registerCommandWithLoading(
      context,
      "jj.squashToWorkingCopyResourceState",
      async (...resourceStates: vscode.SourceControlResourceState[]) => {
        const resourceGroup = getSharedResourceGroup(resourceStates);
        const scm = workspaceSCM.getRepositorySourceControlManagerFromResourceGroup(resourceGroup);
        if (scm?.selectedCommitResourceGroup && scm.selectedCommitResourceGroup === resourceGroup) {
          return;
        }
        const repository = workspaceSCM.getRepositoryFromResourceGroup(resourceGroup);
        if (!repository) {
          throw new Error("Repository not found");
        }
        const status = await repository.getStatus(true);

        const parentChange = status.parentChanges.find((change) => change.changeId === resourceGroup.id);
        if (parentChange === undefined) {
          throw new Error("Parent change we're squashing from was not found in status");
        }

        await repository.squashRetryImmutable({
          fromRev: resourceGroup.id,
          toRev: "@",
          filepaths: resourceStates.map((state) => state.resourceUri.fsPath),
        });
      },
      { errorPrefix: "Failed to squash" },
    );

    registerCommand(
      context,
      "jj.describe",
      async (resourceGroup: vscode.SourceControlResourceGroup) => {
        const scm = workspaceSCM.getRepositorySourceControlManagerFromResourceGroup(resourceGroup);
        const repository = scm?.repository;
        if (!repository) {
          throw new Error("Repository not found");
        }

        const selectedCommitChangeId = workspaceSCM.getSelectedCommitChangeId(resourceGroup);
        await repository.describeRetryImmutable(selectedCommitChangeId ?? resourceGroup.id);
        if (selectedCommitChangeId && scm) {
          await scm.setSelectedCommit(selectedCommitChangeId);
        }
      },
      { errorPrefix: "Failed to update description" },
    );

    registerCommandWithLoading(
      context,
      "jj.squashToParentResourceGroup",
      async (resourceGroup: vscode.SourceControlResourceGroup) => {
        const repository = workspaceSCM.getRepositoryFromResourceGroup(resourceGroup);
        if (!repository) {
          throw new Error("Repository not found");
        }
        const status = await repository.getStatus(true);

        let destinationParentChange = status.parentChanges[0];
        if (status.parentChanges.length > 1) {
          const parentOptions = status.parentChanges.map((parent) => ({
            label: parent.changeId,
            description: parent.description || "(no description)",
            parent,
          }));
          const selection = await vscode.window.showQuickPick(parentOptions, {
            placeHolder: "Select Parent to Squash Into",
          });
          if (!selection) {
            return;
          }
          destinationParentChange = selection.parent;
        } else if (status.parentChanges.length === 0) {
          throw new Error("No parent changes found");
        }

        await repository.squashRetryImmutable({
          fromRev: "@",
          toRev: destinationParentChange.changeId,
        });
      },
      { errorPrefix: "Failed to squash" },
    );

    registerCommandWithLoading(
      context,
      "jj.squashToWorkingCopyResourceGroup",
      async (resourceGroup: vscode.SourceControlResourceGroup) => {
        const scm = workspaceSCM.getRepositorySourceControlManagerFromResourceGroup(resourceGroup);
        if (scm?.selectedCommitResourceGroup && scm.selectedCommitResourceGroup === resourceGroup) {
          return;
        }
        const repository = workspaceSCM.getRepositoryFromResourceGroup(resourceGroup);
        if (!repository) {
          throw new Error("Repository not found");
        }
        const status = await repository.getStatus(true);

        const parentChange = status.parentChanges.find((change) => change.changeId === resourceGroup.id);
        if (parentChange === undefined) {
          throw new Error("Parent change we're squashing from was not found in status");
        }

        await repository.squashRetryImmutable({
          fromRev: resourceGroup.id,
          toRev: "@",
        });
      },
      { errorPrefix: "Failed to squash" },
    );

    registerCommandWithLoading(
      context,
      "jj.restoreResourceGroup",
      async (resourceGroup: vscode.SourceControlResourceGroup) => {
        const scm = workspaceSCM.getRepositorySourceControlManagerFromResourceGroup(resourceGroup);
        if (scm?.selectedCommitResourceGroup && scm.selectedCommitResourceGroup === resourceGroup) {
          return;
        }
        const repository = workspaceSCM.getRepositoryFromResourceGroup(resourceGroup);
        if (!repository) {
          throw new Error("Repository not found");
        }
        const confirm = await vscode.window.showWarningMessage(
          "Are you sure you want to discard changes in this change?",
          { modal: true },
          "Discard",
        );
        if (confirm !== "Discard") {
          return;
        }
        await repository.restoreRetryImmutable(resourceGroup.id);
      },
      { errorPrefix: "Failed to restore" },
    );

    registerCommand(
      context,
      "jj.editResourceGroup",
      async (resourceGroup: vscode.SourceControlResourceGroup) => {
        const repository = workspaceSCM.getRepositoryFromResourceGroup(resourceGroup);
        if (!repository) {
          throw new Error("Repository not found");
        }
        await repository.editRetryImmutable(resourceGroup.id);
      },
      { errorPrefix: "Failed to switch to change" },
    );

    registerCommand(
      context,
      "jj.refreshGraphWebview",
      async () => {
        await graphWebview!.refresh();
      },
      { errorPrefix: "Failed to refresh graph" },
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("jj.toggleElideImmutableCommits.show", async () => {
        await graphWebview!.disableElideImmutableCommits();
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("jj.toggleElideImmutableCommits.elide", async () => {
        await graphWebview!.enableElideImmutableCommits();
      }),
    );

    registerCommand(
      context,
      "jj.newGraphWebview",
      async () => {
        const selectedNodes = Array.from(graphWebview!.selectedNodes);
        if (selectedNodes.length < 1) {
          return;
        }
        const revs = selectedNodes;
        await graphWebview!.repository.new(undefined, revs);
      },
      { errorPrefix: "Failed to create change" },
    );

    registerCommand(
      context,
      "jj.selectGraphWebviewRepo",
      async () => {
        const repoNames = workspaceSCM.repoSCMs.map((repo) => repo.repositoryRoot);
        const selectedRepoName = await vscode.window.showQuickPick(repoNames, {
          placeHolder: "Select a Repository",
        });

        const selectedRepo = workspaceSCM.repoSCMs.find((repo) => repo.repositoryRoot === selectedRepoName);

        if (selectedRepo) {
          setSelectedRepo(selectedRepo.repository);
        }
      },
      { errorPrefix: "Failed to select repository" },
    );

    registerCommand(context, "jj.refreshOperationLog", async () => {
      await operationLogManager.refresh();
    });

    registerCommand(context, "jj.undo", async () => {
      const repository = getSelectedRepo();
      await repository.undo();
      await operationLogManager.refresh();
      await graphWebview?.refresh();
    });

    registerCommand(context, "jj.redo", async () => {
      const repository = getSelectedRepo();
      await repository.redo();
      await operationLogManager.refresh();
      await graphWebview?.refresh();
    });

    registerCommand(
      context,
      "jj.selectOperationLogRepo",
      async () => {
        const repoNames = workspaceSCM.repoSCMs.map((repo) => repo.repositoryRoot);
        const selectedRepoName = await vscode.window.showQuickPick(repoNames, {
          placeHolder: "Select a Repository",
        });

        const selectedRepo = workspaceSCM.repoSCMs.find((repo) => repo.repositoryRoot === selectedRepoName);

        if (selectedRepo) {
          setSelectedRepo(selectedRepo.repository);
        }
      },
      { errorPrefix: "Failed to select repository" },
    );

    registerCommand(
      context,
      "jj.operationUndo",
      async (item: unknown) => {
        if (!(item instanceof OperationTreeItem)) {
          throw new Error("OperationTreeItem expected");
        }
        const repository = workspaceSCM.getRepositoryFromUri(vscode.Uri.file(item.repositoryRoot));
        if (!repository) {
          throw new Error("Repository not found");
        }
        await repository.operationUndo(item.operation.id);
        await operationLogManager.refresh();
        await graphWebview?.refresh();
      },
      { errorPrefix: "Failed to undo operation" },
    );

    registerCommand(
      context,
      "jj.operationRestore",
      async (item: unknown) => {
        if (!(item instanceof OperationTreeItem)) {
          throw new Error("OperationTreeItem expected");
        }
        const repository = workspaceSCM.getRepositoryFromUri(vscode.Uri.file(item.repositoryRoot));
        if (!repository) {
          throw new Error("Repository not found");
        }
        await repository.operationRestore(item.operation.id);
        await operationLogManager.refresh();
        await graphWebview?.refresh();
      },
      { errorPrefix: "Failed to restore operation" },
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("jj.gitFetch", async () => {
        if (lastOpenedFileUri) {
          statusBarItem.text = "$(sync~spin)";
          statusBarItem.tooltip = "Fetching...";
          try {
            await workspaceSCM.getRepositoryFromUri(lastOpenedFileUri)?.gitFetch();
          } catch (error) {
            showErrorMessage("Failed to fetch from remote", error);
          } finally {
            statusBarHandleDidChangeActiveTextEditor(vscode.window.activeTextEditor);
          }
        }
      }),
    );

    context.subscriptions.push(
      vscode.commands.registerCommand("jj.squashSelectedRanges", async () => {
        // this is based on the Git extension's git.stageSelectedRanges function
        // https://github.com/microsoft/vscode/blob/bd05fbbcb0dbc153f85dd118b5729bde34b91f2f/extensions/git/src/commands.ts#L1646
        try {
          const textEditor = vscode.window.activeTextEditor;
          if (!textEditor) {
            return;
          }

          const repository = workspaceSCM.getRepositoryFromUri(textEditor.document.uri);
          if (!repository) {
            return;
          }

          const items: ({ changeId: string } & vscode.QuickPickItem)[] = [];

          try {
            const childChanges = await repository.log("@+");

            items.push(
              ...childChanges.map((entry) => ({
                label: `$(arrow-up) Child: ${entry.change_id_short}`,
                description: entry.description || "(no description)",
                alwaysShow: true,
                changeId: entry.change_id_short,
              })),
            );
          } catch (_) {
            // No child changes or error, continue with just parents
          }

          const status = await repository.getStatus(true);
          for (const parent of status.parentChanges) {
            items.push({
              label: `$(arrow-down) Parent: ${parent.changeId.substring(0, 8)}`,
              description: parent.description || "(no description)",
              alwaysShow: true,
              changeId: parent.changeId,
            });
          }

          const selected = await vscode.window.showQuickPick(items, {
            placeHolder: "Select Destination Change for Squashing Selected Lines",
            ignoreFocusOut: true,
          });

          if (!selected) {
            return;
          }

          const destinationRev = selected.changeId;

          async function computeAndSquashSelectedDiff(
            repository: JJRepository,
            diffComputer: ILinesDiffComputer,
            originalUri: vscode.Uri,
            textEditor: vscode.TextEditor,
          ) {
            const originalDocument = await vscode.workspace.openTextDocument(originalUri);
            const originalLines = originalDocument.getText().split("\n");
            const editorLines = textEditor.document.getText().split("\n");
            const diff = diffComputer.computeDiff(originalLines, editorLines, {
              ignoreTrimWhitespace: false,
              maxComputationTimeMs: 5000,
              computeMoves: false,
            });

            const lineChanges = toLineChanges(diff);
            const selectedLines = toLineRanges(textEditor.selections, textEditor.document);
            const selectedChanges = lineChanges
              .map((change) =>
                selectedLines.reduce<LineChange | null>(
                  (result, range) => result || intersectDiffWithRange(textEditor.document, change, range),
                  null,
                ),
              )
              .filter((d) => !!d);

            if (!selectedChanges.length) {
              vscode.window.showErrorMessage("The selection range does not contain any changes.");
              return;
            }

            const result = applyLineChanges(originalDocument, textEditor.document, selectedChanges);

            await repository.squashContentRetryImmutable({
              fromRev: "@",
              toRev: destinationRev,
              content: result,
              filepath: originalUri.fsPath,
            });
          }

          const diffInput = getActiveTextEditorDiff();

          if (
            diffInput &&
            diffInput.modified.scheme === "file" &&
            diffInput.original.scheme === "jj" &&
            match({})
              .case({ diffOriginalRev: "string" }, ({ diffOriginalRev }) =>
                ["@", status.workingCopy.changeId, status.workingCopy.commitId].includes(diffOriginalRev),
              )
              .default(() => false)(getParams(diffInput.original))
          ) {
            await computeAndSquashSelectedDiff(
              repository,
              linesDiffComputers.getDefault(),
              diffInput.original,
              textEditor,
            );
          } else if (textEditor.document.uri.scheme === "file") {
            await computeAndSquashSelectedDiff(
              repository,
              linesDiffComputers.getLegacy(),
              toJJUri(textEditor.document.uri, {
                diffOriginalRev: status.workingCopy.commitId,
              }),
              textEditor,
            );
          }
        } catch (error) {
          showErrorMessage("Failed to squash selection", error);
        }
      }),
    );

    registerCommand(context, "jj.openParentChange", async (uri: vscode.Uri) => {
      if (!["file", "jj"].includes(uri.scheme)) {
        return;
      }

      const currentRev = resolveRev(uri) ?? "@";

      const repository = workspaceSCM.getRepositoryFromUri(uri);
      if (!repository) {
        throw new Error("Repository not found");
      }

      const parentChanges = await repository.log(`${currentRev}-`);

      if (parentChanges.length === 0) {
        throw new Error("No parent changes found");
      }

      let selectedParentChange: string;
      if (parentChanges.length === 1) {
        selectedParentChange = parentChanges[0].change_id;
      } else {
        const items = parentChanges.map((entry) => ({
          label: `$(arrow-down) Parent: ${entry.change_id_short}`,
          description: entry.description || "(no description)",
          alwaysShow: true,
          changeId: entry.change_id,
        })) satisfies vscode.QuickPickItem[];

        const selection = await vscode.window.showQuickPick(items, {
          placeHolder: "Select Parent Change to Open",
        });
        if (!selection) {
          return;
        }

        selectedParentChange = selection.changeId;
      }

      if (getActiveTextEditorDiff()) {
        await vscode.commands.executeCommand(
          "vscode.diff",
          toJJUri(uri, {
            diffOriginalRev: selectedParentChange,
          }),
          toJJUri(uri, {
            rev: selectedParentChange,
          }),
          `${path.basename(uri.fsPath)} (${selectedParentChange.substring(0, 8)})`,
        );
      } else {
        await vscode.commands.executeCommand(
          "vscode.open",
          toJJUri(uri, {
            rev: selectedParentChange,
          }),
          {},
          `${path.basename(uri.fsPath)} (${selectedParentChange.substring(0, 8)})`,
        );
      }
    });

    registerCommand(context, "jj.openChildChange", async (uri: vscode.Uri) => {
      if (!["file", "jj"].includes(uri.scheme)) {
        return;
      }

      const currentRev = resolveRev(uri) ?? "@";

      const repository = workspaceSCM.getRepositoryFromUri(uri);
      if (!repository) {
        throw new Error("Repository not found");
      }

      const childChanges = await repository.log(`${currentRev}+`);

      if (childChanges.length === 0) {
        throw new Error("No child changes found");
      }

      let selectedChildChange: string;
      if (childChanges.length === 1) {
        selectedChildChange = childChanges[0].change_id;
      } else {
        const items = childChanges.map((entry) => ({
          label: `$(arrow-up) Child: ${entry.change_id_short}`,
          description: entry.description || "(no description)",
          alwaysShow: true,
          changeId: entry.change_id,
        })) satisfies vscode.QuickPickItem[];

        const selection = await vscode.window.showQuickPick(items, {
          placeHolder: "Select Child Change to Open",
        });
        if (!selection) {
          return;
        }

        selectedChildChange = selection.changeId;
      }

      if (getActiveTextEditorDiff()) {
        await vscode.commands.executeCommand(
          "vscode.diff",
          toJJUri(uri, {
            diffOriginalRev: selectedChildChange,
          }),
          toJJUri(uri, {
            rev: selectedChildChange,
          }),
          `${path.basename(uri.fsPath)} (${selectedChildChange.substring(0, 8)})`,
        );
      } else {
        await vscode.commands.executeCommand(
          "vscode.open",
          toJJUri(uri, {
            rev: selectedChildChange,
          }),
          {},
          `${path.basename(uri.fsPath)} (${selectedChildChange.substring(0, 8)})`,
        );
      }
    });

    isInitialized = true;
  }

  async function poll() {
    const didUpdate = await workspaceSCM.refresh();
    if (didUpdate) {
      setSelectedRepo(getSelectedRepo());
    }
    if (workspaceSCM.repoSCMs.length > 0) {
      vscode.commands.executeCommand("setContext", "jj.reposExist", true);
      if (!isInitialized) {
        init();
      }
    } else {
      vscode.commands.executeCommand("setContext", "jj.reposExist", false);
    }

    // Snapshot changes
    await Promise.all(workspaceSCM.repoSCMs.map((repoSCM) => repoSCM.checkForUpdates()));
  }

  const throttledPoll = createThrottledAsyncFn(poll);

  registerCommandWithLoading(context, "jj.refresh", () => throttledPoll());

  context.subscriptions.push(
    vscode.commands.registerCommand("jj.openFolderGitSettings", async (repoPath: string) => {
      if (!repoPath) {
        return;
      }
      await vscode.commands.executeCommand("workbench.action.openSettings", {
        query: "git.enabled",
      });
      await vscode.commands.executeCommand("_workbench.action.openFolderSettings", vscode.Uri.file(repoPath));
    }),
  );

  /**
   * Checks if any repositories are colocated (have both .jj and .git directories)
   * and warns the user about potential conflicts with the Git extension
   */
  async function checkColocatedRepositories(
    workspaceSCM: WorkspaceSourceControlManager,
    context: vscode.ExtensionContext,
  ) {
    // Create a single persistent status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    context.subscriptions.push(statusBarItem);

    // Keep track of which repos have warnings
    const reposWithWarnings = new Set<string>();

    const checkRepos = async (specificFolders?: string[]) => {
      const colocatedRepos = [];

      for (const repoSCM of workspaceSCM.repoSCMs) {
        const repoRoot = repoSCM.repositoryRoot;

        // Skip if we're checking specific folders and this isn't one of them
        if (specificFolders && !specificFolders.includes(repoRoot)) {
          continue;
        }

        const jjDirExists = await fileExists(vscode.Uri.joinPath(vscode.Uri.file(repoRoot), ".jj"));
        const gitDirExists = await fileExists(vscode.Uri.joinPath(vscode.Uri.file(repoRoot), ".git"));

        if (jjDirExists && gitDirExists) {
          const isGitEnabled = vscode.workspace.getConfiguration("git", vscode.Uri.file(repoRoot)).get("enabled");

          if (isGitEnabled) {
            colocatedRepos.push(repoRoot);
            reposWithWarnings.add(repoRoot);
          } else {
            reposWithWarnings.delete(repoRoot);
          }
        }
      }

      if (reposWithWarnings.size > 0) {
        const count = reposWithWarnings.size;
        statusBarItem.text = `$(warning) jjx issues (${count})`;
        statusBarItem.tooltip = "Click to View Colocated Repository Warnings";
        statusBarItem.command = "jj.showColocatedWarnings";
        statusBarItem.show();
      } else {
        statusBarItem.hide();
      }

      for (const repoRoot of colocatedRepos) {
        const folderName = repoRoot.split("/").at(-1) || repoRoot;
        const message = `Colocated Jujutsu and Git repository detected in "${folderName}". Consider disabling the Git extension to avoid conflicts.`;
        const openSettings = "Open Folder Settings";

        vscode.window.showWarningMessage(message, openSettings).then((selection) => {
          if (selection === openSettings) {
            vscode.commands.executeCommand("jj.openFolderGitSettings", repoRoot);
          }
        });
      }
    };

    context.subscriptions.push(
      vscode.commands.registerCommand("jj.showColocatedWarnings", () => {
        for (const repoRoot of reposWithWarnings) {
          const folderName = repoRoot.split("/").at(-1) || repoRoot;
          const message = `Colocated Jujutsu and Git repository detected in "${folderName}". Consider disabling the Git extension to avoid conflicts.`;
          const openSettings = "Open Folder Settings";

          vscode.window.showWarningMessage(message, openSettings).then((selection) => {
            if (selection === openSettings) {
              vscode.commands.executeCommand("jj.openFolderGitSettings", repoRoot);
            }
          });
        }
      }),
    );

    checkReposFunction = checkRepos;

    await checkRepos();
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("jj.checkColocatedRepos", async () => {
      if (checkReposFunction) {
        await checkReposFunction();
      }
    }),
  );

  let isPollingCanceled = false;
  let pollTimeoutId: NodeJS.Timeout | undefined;
  const scheduleNextPoll = async () => {
    if (isPollingCanceled) {
      return;
    }
    try {
      await throttledPoll();
    } catch (err) {
      logger.error(`Error during background poll: ${String(err)}`);
    } finally {
      const pollInterval = vscode.workspace.getConfiguration("jjx").get<number>("pollInterval");
      if (pollInterval !== undefined && pollInterval > 0) {
        pollTimeoutId = setTimeout(() => void scheduleNextPoll(), pollInterval);
      }
    }
  };

  void scheduleNextPoll(); // Start the first poll.

  context.subscriptions.push(
    new vscode.Disposable(() => {
      isPollingCanceled = true;
      clearTimeout(pollTimeoutId);
    }),
  );

  registerCommand(
    context,
    "jj.openFileInWorkingCopyResourceState",
    async (resourceState: vscode.SourceControlResourceState) => {
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(resourceState.resourceUri.fsPath), {});
    },
    { errorPrefix: "Failed to open file" },
  );

  registerCommand(
    context,
    "jj.openDiffResourceState",
    async (resourceState: vscode.SourceControlResourceState) => {
      const resourceGroup = workspaceSCM.getResourceGroupFromResourceState(resourceState);
      if (!resourceGroup) {
        throw new Error("Resource group not found");
      }

      const filePath = resourceState.resourceUri.fsPath;
      const selectedCommitChangeId = workspaceSCM.getSelectedCommitChangeId(resourceGroup);
      const changeId = selectedCommitChangeId ?? resourceGroup.id;

      const repo = workspaceSCM.getRepositoryFromUri(resourceState.resourceUri);
      if (!repo) {
        throw new Error("Repository not found");
      }

      const { fileStatuses } = await repo.show(changeId);
      const fileStatus = fileStatuses.find((file) => pathEquals(file.path, filePath));

      const beforeUri =
        fileStatus?.type === "A"
          ? toJJUri(vscode.Uri.file(filePath), { deleted: true })
          : toJJUri(vscode.Uri.file(filePath), { diffOriginalRev: changeId });
      const afterUri =
        fileStatus?.type === "D"
          ? toJJUri(vscode.Uri.file(filePath), { deleted: true })
          : changeId === "@"
            ? vscode.Uri.file(filePath)
            : toJJUri(vscode.Uri.file(filePath), { rev: changeId });

      const diffTitleSuffix = changeId === "@" ? "(Working Copy)" : `(${changeId.substring(0, 8)})`;

      await vscode.commands.executeCommand(
        "vscode.diff",
        beforeUri,
        afterUri,
        (fileStatus?.renamedFrom ? `${fileStatus.renamedFrom} => ` : "") +
          `${path.basename(filePath)} ${diffTitleSuffix}`,
      );
    },
    { errorPrefix: "Failed to open diff" },
  );

  registerCommand(context, "jj.copyPath", async (resourceState: vscode.SourceControlResourceState) => {
    await vscode.env.clipboard.writeText(resourceState.resourceUri.fsPath);
  });

  registerCommand(context, "jj.copyRelativePath", async (resourceState: vscode.SourceControlResourceState) => {
    const repo = workspaceSCM.getRepositoryFromUri(resourceState.resourceUri);
    if (!repo) {
      throw new Error("Repository not found");
    }
    const relativePath = path.relative(repo.repositoryRoot, resourceState.resourceUri.fsPath);
    await vscode.env.clipboard.writeText(relativePath);
  });

  registerCommand(
    context,
    "jj.openFileInWorkingCopyEditor",
    async (uri: vscode.Uri) => {
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(uri.fsPath), {});
    },
    { errorPrefix: "Failed to open file" },
  );

  registerCommand(context, "jj.openMergeEditor", async (uri: vscode.Uri, changeId?: string) => {
    const repo = workspaceSCM.getRepositoryFromUri(uri);
    if (!repo) {
      throw new Error("Repository not found");
    }
    const mergeEditorScriptPath = getMergeEditorPath();
    if (!mergeEditorScriptPath) {
      throw new Error("Merge editor not initialized");
    }
    const relativePath = path.relative(repo.repositoryRoot, uri.fsPath);
    const mergeToolConfig = `merge-tools.jjx-vscode-merge.program="${mergeEditorScriptPath}"`;
    const args = ["resolve", "--tool=jjx-vscode-merge", "--config", mergeToolConfig];
    if (changeId) {
      args.push("-r", changeId);
    }
    args.push("--", relativePath);
    await handleJJCommand(
      repo.spawnJJ(args, {
        cwd: repo.repositoryRoot,
      }),
    );
  });
}

function registerCommand<T extends unknown[]>(
  context: vscode.ExtensionContext,
  command: string,
  callback: (...args: T) => Promise<void>,
  options?: { errorPrefix?: string; showLoading?: boolean },
): void {
  const wrappedCallback = async (...args: T) => {
    try {
      await callback(...args);
    } catch (error) {
      const prefix = options?.errorPrefix ?? inferErrorPrefix(command);
      vscode.window.showErrorMessage(`${prefix}${error instanceof Error ? `: ${error.message}` : ""}`);
    }
  };

  const finalCallback = options?.showLoading
    ? (...args: T) =>
        vscode.window.withProgress({ location: vscode.ProgressLocation.SourceControl }, () => wrappedCallback(...args))
    : wrappedCallback;

  context.subscriptions.push(vscode.commands.registerCommand(command, finalCallback));
}

function registerCommandWithLoading<T extends unknown[]>(
  context: vscode.ExtensionContext,
  command: string,
  callback: (...args: T) => Promise<void>,
  options?: { errorPrefix?: string },
): void {
  registerCommand(context, command, callback, { ...options, showLoading: true });
}

function inferErrorPrefix(command: string): string {
  const name = command.replace(/^jj\./, "");
  const spaced = name.replace(/([A-Z])/g, " $1").toLowerCase();
  return `Failed to ${spaced}`;
}

export function deactivate() {
  killAllProcesses();
}

/**
 * Checks if a file or directory exists at the given URI
 */
async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
