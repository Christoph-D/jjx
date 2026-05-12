import * as vscode from "vscode";
import path from "path";
import fs from "fs";
import { provideOriginalResource } from "./sourceControl";
import type { JJRepository } from "./repository";
import type { ExtensionState } from "./extensionState";
import type { FileStatus } from "./types";
import { OperationTreeItem } from "./operationLogTreeView";
import { getParams, resolveRev, toJJUri } from "./uri";
import {
  computeLineChanges,
  toLineRanges,
  intersectDiffWithRange,
  applyLineChanges,
  type LineChange,
} from "./diffUtils";
import { match } from "arktype";
import { getActiveTextEditorDiff, pathEquals, showErrorMessage } from "./utils";
import { getMergeEditorConfigs } from "./jjEditor";
import { handleJJCommand } from "./process";

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

function getSharedResourceGroup(resourceStates: vscode.SourceControlResourceState[], state: ExtensionState) {
  if (resourceStates.length === 0) {
    throw new Error("No resources found");
  }

  const [first, ...rest] = resourceStates;
  const resourceGroup = state.workspaceSCM.getResourceGroupFromResourceState(first);

  for (const resourceState of rest) {
    const stateGroup = state.workspaceSCM.getResourceGroupFromResourceState(resourceState);
    if (stateGroup !== resourceGroup) {
      throw new Error("All selected resources must belong to the same resource group");
    }
  }

  return resourceGroup;
}

function getRequiredRepoFromGroup(state: ExtensionState, resourceGroup: vscode.SourceControlResourceGroup) {
  const repository = state.workspaceSCM.getRepositoryFromResourceGroup(resourceGroup);
  if (!repository) {
    throw new Error("Repository not found");
  }
  return repository;
}

async function selectParentChange(repository: JJRepository): Promise<{ changeId: string } | undefined> {
  const status = await repository.getStatus(true);

  if (status.parentChanges.length === 0) {
    throw new Error("No parent changes found");
  }

  if (status.parentChanges.length === 1) {
    return status.parentChanges[0];
  }

  const parentOptions = status.parentChanges.map((parent) => ({
    label: parent.changeId,
    description: parent.description || "(no description)",
    parent,
  }));
  const selection = await vscode.window.showQuickPick(parentOptions, {
    placeHolder: "Select Parent to Squash Into",
  });
  return selection ? selection.parent : undefined;
}

async function selectRepositoryQuickPick(state: ExtensionState): Promise<void> {
  const repoNames = state.workspaceSCM.repoSCMs.map((repo) => repo.repositoryRoot);
  const selectedRepoName = await vscode.window.showQuickPick(repoNames, {
    placeHolder: "Select a Repository",
  });

  const selectedRepo = selectedRepoName ? state.workspaceSCM.getByRoot(selectedRepoName) : undefined;

  if (selectedRepo) {
    state.setSelectedRepo(selectedRepo.repository);
  }
}

async function navigateToRelativeChange(uri: vscode.Uri, revExpression: string, state: ExtensionState) {
  if (!["file", "jj"].includes(uri.scheme)) {
    return;
  }

  const currentRev = resolveRev(uri) ?? "@";

  const repository = state.workspaceSCM.getRepositoryFromUri(uri);
  if (!repository) {
    throw new Error("Repository not found");
  }

  const changes = await repository.log(revExpression.replace("{}", currentRev));

  const isParent = revExpression.includes("-");
  const direction = isParent ? "Parent" : "Child";
  const arrow = isParent ? "arrow-down" : "arrow-up";

  if (changes.length === 0) {
    throw new Error(`No ${direction.toLowerCase()} changes found`);
  }

  let selectedChange: string;
  if (changes.length === 1) {
    selectedChange = changes[0].change_id;
  } else {
    const items = changes.map((entry) => ({
      label: `$(${arrow}) ${direction}: ${entry.change_id_short}`,
      description: entry.description || "(no description)",
      alwaysShow: true,
      changeId: entry.change_id,
    })) satisfies vscode.QuickPickItem[];

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: `Select ${direction} Change to Open`,
    });
    if (!selection) {
      return;
    }

    selectedChange = selection.changeId;
  }

  if (getActiveTextEditorDiff()) {
    await vscode.commands.executeCommand(
      "vscode.diff",
      toJJUri(uri, {
        diffOriginalRev: selectedChange,
      }),
      toJJUri(uri, {
        rev: selectedChange,
      }),
      `${path.basename(uri.fsPath)} (${selectedChange.substring(0, 8)})`,
    );
  } else {
    await vscode.commands.executeCommand(
      "vscode.open",
      toJJUri(uri, {
        rev: selectedChange,
      }),
      {},
      `${path.basename(uri.fsPath)} (${selectedChange.substring(0, 8)})`,
    );
  }
}

async function createChange(
  state: ExtensionState,
  sourceControl: vscode.SourceControl | undefined,
  useEditor: boolean,
) {
  if (!sourceControl) {
    sourceControl = state.workspaceSCM.repoSCMs[0]?.sourceControl;
  }
  if (!sourceControl) {
    throw new Error("Repository not found");
  }
  const repository = state.workspaceSCM.getRepositoryFromSourceControl(sourceControl);
  if (!repository) {
    throw new Error("Repository not found");
  }
  const config = vscode.workspace.getConfiguration("jjx");
  const commitAction = config.get<string>("commitAction") || "commit";
  const message = sourceControl.inputBox.value.trim();
  if (commitAction === "commit") {
    await repository.commit(message, useEditor);
  } else {
    await repository.new(message);
    if (useEditor) {
      await repository.describeOpenEditor();
    }
  }
  sourceControl.inputBox.value = "";
}

export function registerPreInitCommands(state: ExtensionState): void {
  const context = state.context;

  registerCommandWithLoading(context, "jj.refresh", () => state.throttledPoll?.() ?? Promise.resolve());

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
      const resourceGroup = state.workspaceSCM.getResourceGroupFromResourceState(resourceState);
      if (!resourceGroup) {
        throw new Error("Resource group not found");
      }

      const filePath = resourceState.resourceUri.fsPath;
      const selectedCommitChangeId = state.workspaceSCM.getSelectedCommitChangeId(resourceGroup);
      const changeId = selectedCommitChangeId ?? resourceGroup.id;

      const repo = state.workspaceSCM.getRepositoryFromUri(resourceState.resourceUri);
      if (!repo) {
        throw new Error("Repository not found");
      }

      const { fileStatuses } = await repo.show(changeId);
      const fileStatus = fileStatuses.find((file) => pathEquals(file.path, filePath));

      const beforeUri =
        fileStatus?.type === "A"
          ? toJJUri(vscode.Uri.file(filePath), { deleted: true })
          : toJJUri(vscode.Uri.file(filePath), {
              diffOriginalRev: changeId,
              ...(fileStatus?.renamedFrom ? { renamedFrom: fileStatus.renamedFrom } : {}),
            });
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
    const repo = state.workspaceSCM.getRepositoryFromUri(resourceState.resourceUri);
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
    const repo = state.workspaceSCM.getRepositoryFromUri(uri);
    if (!repo) {
      throw new Error("Repository not found");
    }
    const configs = getMergeEditorConfigs();
    if (!configs.length) {
      throw new Error("Merge editor not initialized");
    }
    let fsPath = uri.fsPath;
    try {
      fsPath = fs.realpathSync.native(fsPath);
    } catch {
      // Fall back to original path if realpath fails
    }
    const relativePath = path.relative(repo.repositoryRoot, fsPath);
    const args = ["resolve", "--tool=jjx-vscode-merge", ...configs.flatMap((c) => ["--config", c])];
    if (changeId) {
      args.push("-r", changeId);
    }
    args.push("--", relativePath);
    try {
      await handleJJCommand(
        repo.spawnJJ(args, {
          cwd: repo.repositoryRoot,
          env: { JJX_MERGE_REAL_PATH: fsPath },
        }),
      );
    } catch (e) {
      const stderr = e instanceof Error ? ((e as { stderr?: string }).stderr ?? e.message) : String(e);
      if (typeof stderr === "string" && stderr.includes("unchanged")) {
        // This error is expected behavior due to the way we implement the merge editor.
        // The merge tool only copies out the files and exits immediately.
        // jj is expected to always return an error like this:
        //   Error: Failed to resolve conflicts
        //   Caused by: The output file is either unchanged or empty after the editor quit (run with --debug to see the exact invocation).
        return;
      }
      throw e;
    }
  });
}

export function registerInitCommands(state: ExtensionState): void {
  const context = state.context;

  registerCommand(
    context,
    "jj.new",
    async (sourceControl?: vscode.SourceControl) => {
      await createChange(state, sourceControl, false);
    },
    { errorPrefix: "Failed to create change" },
  );

  registerCommand(
    context,
    "jj.newWithEditor",
    async (sourceControl?: vscode.SourceControl) => {
      await createChange(state, sourceControl, true);
    },
    { errorPrefix: "Failed to create change" },
  );

  registerCommand(
    context,
    "jj.openFileResourceState",
    async (resourceState: vscode.SourceControlResourceState) => {
      await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(resourceState.resourceUri.fsPath), {
        preserveFocus: false,
        preview: false,
        viewColumn: vscode.ViewColumn.Active,
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

      const repo = state.workspaceSCM.getRepositoryFromUri(originalUri);
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

  registerCommandWithLoading(
    context,
    "jj.restoreResourceState",
    async (...resourceStates: vscode.SourceControlResourceState[]) => {
      const resourceGroup = getSharedResourceGroup(resourceStates, state);
      const repository = getRequiredRepoFromGroup(state, resourceGroup);

      const scm = state.workspaceSCM.getRepositorySourceControlManagerFromResourceGroup(resourceGroup);
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
      const resourceGroup = getSharedResourceGroup(resourceStates, state);
      const repository = getRequiredRepoFromGroup(state, resourceGroup);

      const destinationParentChange = await selectParentChange(repository);
      if (!destinationParentChange) {
        return;
      }

      await repository.squashRetryImmutable({
        fromRev: "@",
        toRev: destinationParentChange.changeId,
        filepaths: resourceStates.map((rs) => {
          try {
            return fs.realpathSync.native(rs.resourceUri.fsPath);
          } catch {
            return rs.resourceUri.fsPath;
          }
        }),
      });
    },
    { errorPrefix: "Failed to squash" },
  );

  registerCommandWithLoading(
    context,
    "jj.squashToWorkingCopyResourceState",
    async (...resourceStates: vscode.SourceControlResourceState[]) => {
      const resourceGroup = getSharedResourceGroup(resourceStates, state);
      const scm = state.workspaceSCM.getRepositorySourceControlManagerFromResourceGroup(resourceGroup);
      if (scm?.selectedCommitResourceGroup === resourceGroup) {
        return;
      }
      const repository = getRequiredRepoFromGroup(state, resourceGroup);
      const status = await repository.getStatus(true);

      const parentChange = status.parentChanges.find((change) => change.changeId === resourceGroup.id);
      if (parentChange === undefined) {
        throw new Error("Parent change we're squashing from was not found in status");
      }

      await repository.squashRetryImmutable({
        fromRev: resourceGroup.id,
        toRev: "@",
        filepaths: resourceStates.map((rs) => {
          try {
            return fs.realpathSync.native(rs.resourceUri.fsPath);
          } catch {
            return rs.resourceUri.fsPath;
          }
        }),
      });
    },
    { errorPrefix: "Failed to squash" },
  );

  registerCommand(
    context,
    "jj.describe",
    async (resourceGroup: vscode.SourceControlResourceGroup) => {
      const scm = state.workspaceSCM.getRepositorySourceControlManagerFromResourceGroup(resourceGroup);
      const repository = getRequiredRepoFromGroup(state, resourceGroup);

      const selectedCommitChangeId = state.workspaceSCM.getSelectedCommitChangeId(resourceGroup);
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
      const repository = getRequiredRepoFromGroup(state, resourceGroup);

      const destinationParentChange = await selectParentChange(repository);
      if (!destinationParentChange) {
        return;
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
      const scm = state.workspaceSCM.getRepositorySourceControlManagerFromResourceGroup(resourceGroup);
      if (scm?.selectedCommitResourceGroup === resourceGroup) {
        return;
      }
      const repository = getRequiredRepoFromGroup(state, resourceGroup);
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
      const scm = state.workspaceSCM.getRepositorySourceControlManagerFromResourceGroup(resourceGroup);
      if (scm?.selectedCommitResourceGroup === resourceGroup) {
        return;
      }
      const repository = getRequiredRepoFromGroup(state, resourceGroup);
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
      const repository = getRequiredRepoFromGroup(state, resourceGroup);
      await repository.editRetryImmutable(resourceGroup.id);
    },
    { errorPrefix: "Failed to switch to change" },
  );

  registerCommand(
    context,
    "jj.refreshGraphWebview",
    async () => {
      await state.graphWebview!.refresh();
    },
    { errorPrefix: "Failed to refresh graph" },
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("jj.toggleElideImmutableCommits.show", async () => {
      await state.graphWebview!.disableElideImmutableCommits();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("jj.toggleElideImmutableCommits.elide", async () => {
      await state.graphWebview!.enableElideImmutableCommits();
    }),
  );

  registerCommand(
    context,
    "jj.newGraphWebview",
    async () => {
      const selectedNodes = Array.from(state.graphWebview!.selectedNodes);
      if (selectedNodes.length < 1) {
        return;
      }
      await state.graphWebview!.repository!.new(undefined, selectedNodes);
    },
    { errorPrefix: "Failed to create change" },
  );

  for (const command of ["jj.selectGraphWebviewRepo", "jj.selectOperationLogRepo"]) {
    registerCommand(
      context,
      command,
      async () => {
        await selectRepositoryQuickPick(state);
      },
      { errorPrefix: "Failed to select repository" },
    );
  }

  registerCommand(context, "jj.refreshOperationLog", async () => {
    await state.operationLogManager!.refresh();
  });

  context.subscriptions.push(vscode.commands.registerCommand("jj.gitFetch.syncing", () => {}));

  registerCommand(
    context,
    "jj.gitFetch",
    async () => {
      const repository = state.getSelectedRepo();
      if (!repository) {
        return;
      }
      await vscode.commands.executeCommand("setContext", "jj.fetching", true);
      try {
        const result = await repository.gitFetch();
        const output = result.stderr.toString();
        if (output.includes("Nothing changed.")) {
          vscode.window.showInformationMessage("Fetch: Nothing changed.");
        }
      } finally {
        await vscode.commands.executeCommand("setContext", "jj.fetching", false);
      }
    },
    { errorPrefix: "Failed to fetch from remote" },
  );

  registerCommand(
    context,
    "jj.gitFetchAllRemotes",
    async () => {
      const repository = state.getSelectedRepo();
      if (!repository) {
        return;
      }
      const result = await repository.gitFetchAllRemotes();
      const output = result.stderr.toString();
      if (output.includes("Nothing changed.")) {
        vscode.window.showInformationMessage("Fetch: Nothing changed.");
      }
    },
    { errorPrefix: "Failed to fetch from all remotes" },
  );

  registerCommand(
    context,
    "jj.gitFetchFromRemote",
    async () => {
      const repository = state.getSelectedRepo();
      if (!repository) {
        return;
      }
      const remotes = await repository.getRemotes();
      if (remotes.length === 0) {
        vscode.window.showWarningMessage("No remotes configured.");
        return;
      }
      const remote = await vscode.window.showQuickPick(remotes, {
        placeHolder: "Select a Remote to Fetch From",
      });
      if (!remote) {
        return;
      }
      const result = await repository.gitFetchFromRemote(remote);
      const output = result.stderr.toString();
      if (output.includes("Nothing changed.")) {
        vscode.window.showInformationMessage("Fetch: Nothing changed.");
      }
    },
    { errorPrefix: "Failed to fetch from remote" },
  );

  for (const [command, method] of [
    ["jj.undo", "undo"],
    ["jj.redo", "redo"],
  ] as const) {
    registerCommand(context, command, async () => {
      const repository = state.getSelectedRepo();
      if (!repository) {
        return;
      }
      await repository[method]();
      await state.operationLogManager!.refresh();
      await state.graphWebview?.refresh();
    });
  }

  for (const [command, action, errorPrefix] of [
    ["jj.operationRevert", "operationRevert", "Failed to revert operation"],
    ["jj.operationRestore", "operationRestore", "Failed to restore operation"],
  ] as const) {
    registerCommand(
      context,
      command,
      async (item: unknown) => {
        if (!(item instanceof OperationTreeItem)) {
          throw new Error("OperationTreeItem expected");
        }
        const repository = state.workspaceSCM.getRepositoryFromUri(vscode.Uri.file(item.repositoryRoot));
        if (!repository) {
          throw new Error("Repository not found");
        }
        await repository[action](item.operation.id);
        await state.operationLogManager!.refresh();
        await state.graphWebview?.refresh();
      },
      { errorPrefix },
    );
  }

  registerCommand(context, "jj.openParentChange", async (uri: vscode.Uri) => {
    await navigateToRelativeChange(uri, "{}-", state);
  });

  registerCommand(context, "jj.openChildChange", async (uri: vscode.Uri) => {
    await navigateToRelativeChange(uri, "{}+", state);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("jj.squashSelectedRanges", async () => {
      // this is based on the Git extension's git.stageSelectedRanges function
      // https://github.com/microsoft/vscode/blob/bd05fbbcb0dbc153f85dd118b5729bde34b91f2f/extensions/git/src/commands.ts#L1646
      try {
        const textEditor = vscode.window.activeTextEditor;
        if (!textEditor) {
          return;
        }

        const repository = state.workspaceSCM.getRepositoryFromUri(textEditor.document.uri);
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
              changeId: entry.change_id,
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
          originalUri: vscode.Uri,
          textEditor: vscode.TextEditor,
        ) {
          const originalDocument = await vscode.workspace.openTextDocument(originalUri);
          const originalLines = originalDocument.getText().split("\n");
          const editorLines = textEditor.document.getText().split("\n");
          const lineChanges = computeLineChanges(originalLines, editorLines);
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
          await computeAndSquashSelectedDiff(repository, diffInput.original, textEditor);
        } else if (textEditor.document.uri.scheme === "file") {
          await computeAndSquashSelectedDiff(
            repository,
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
}
