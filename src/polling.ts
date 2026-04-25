import * as vscode from "vscode";
import { logger } from "./logger";
import { createThrottledAsyncFn } from "./utils";
import { OperationLogManager, OperationLogTreeDataProvider } from "./operationLogTreeView";
import { JJGraphWebview } from "./graphWebview";
import type { ExtensionState } from "./extensionState";

export function initInfrastructure(state: ExtensionState) {
  const context = state.context;
  const initialSelectedRepo = state.getSelectedRepo();

  const graphWebview = new JJGraphWebview(context.extensionUri, initialSelectedRepo, context);
  context.subscriptions.push(graphWebview);

  state.onDidSetSelectedRepository(
    async () => {
      const repo = state.getSelectedRepo();
      if (repo) {
        await graphWebview.setSelectedRepository(repo);
      }
    },
    undefined,
    context.subscriptions,
  );

  context.subscriptions.push(
    graphWebview.onDidChangeSelection(async (selectedNodes) => {
      const repoRoot = graphWebview.repository?.repositoryRoot;
      if (!repoRoot) {
        return;
      }
      const repoSCM = state.workspaceSCM.repoSCMs.find((r) => r.repositoryRoot === repoRoot);
      if (repoSCM) {
        const changeId = selectedNodes.length === 1 ? selectedNodes[0] : undefined;
        await repoSCM.setSelectedCommit(changeId);
      }
    }),
  );

  const operationLogTreeDataProvider = new OperationLogTreeDataProvider(initialSelectedRepo);
  const operationLogManager = new OperationLogManager(operationLogTreeDataProvider);
  context.subscriptions.push(operationLogManager);

  state.onDidSetSelectedRepository(
    async () => {
      const repo = state.getSelectedRepo();
      if (repo) {
        await operationLogManager.setSelectedRepo(repo);
      }
    },
    undefined,
    context.subscriptions,
  );

  context.subscriptions.push(
    state.workspaceSCM.onDidRepoUpdate(({ repoSCM }) => {
      const opLogRepo = operationLogManager.operationLogTreeDataProvider.getSelectedRepo();
      if (opLogRepo && opLogRepo.repositoryRoot === repoSCM.repositoryRoot) {
        void operationLogManager.refresh();
      }
      if (graphWebview.repository && graphWebview.repository.repositoryRoot === repoSCM.repositoryRoot) {
        void graphWebview.refresh();
      }
    }),
  );

  state.initialize(graphWebview, operationLogManager);
  vscode.commands.executeCommand("setContext", "jj.reposExist", true);
}

export function createPolling(
  state: ExtensionState,
  checkRepos: (specificFolders?: string[]) => Promise<void>,
): {
  throttledPoll: () => Promise<void>;
  scheduleNextPoll: () => Promise<void>;
} {
  const context = state.context;

  async function poll() {
    const didUpdate = await state.workspaceSCM.refresh();
    if (didUpdate) {
      const repo = state.getSelectedRepo();
      if (repo) {
        state.setSelectedRepo(repo);
      }
    }

    await Promise.all(state.workspaceSCM.repoSCMs.map((repoSCM) => repoSCM.checkForUpdates()));
  }

  const throttledPoll = createThrottledAsyncFn(poll);

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
      if (state.workspaceSCM.repoSCMs.length === 0) {
        pollTimeoutId = setTimeout(() => void scheduleNextPoll(), 5000);
      } else {
        const pollIntervalSeconds = vscode.workspace.getConfiguration("jjx").get<number>("pollIntervalSeconds");
        if (pollIntervalSeconds !== undefined && pollIntervalSeconds > 0) {
          pollTimeoutId = setTimeout(() => void scheduleNextPoll(), pollIntervalSeconds * 1000);
        }
      }
    }
  };

  context.subscriptions.push(
    new vscode.Disposable(() => {
      isPollingCanceled = true;
      clearTimeout(pollTimeoutId);
    }),
  );

  vscode.workspace.onDidChangeWorkspaceFolders(
    async () => {
      logger.info("Workspace folders changed");
      const didUpdate = await state.workspaceSCM.refresh();
      if (didUpdate) {
        const repo = state.getSelectedRepo();
        if (repo) {
          state.setSelectedRepo(repo);
        }
      }
      await checkRepos();
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
          await checkRepos(affectedFolders);
        }
      }
      if (e.affectsConfiguration("jjx.commitAction")) {
        for (const repoSCM of state.workspaceSCM.repoSCMs) {
          repoSCM.updatePlaceholderText();
        }
      }
      if (e.affectsConfiguration("jjx.fileClickAction")) {
        for (const repoSCM of state.workspaceSCM.repoSCMs) {
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
        if (state.graphWebview) {
          if (e.affectsConfiguration("jjx.elideImmutableCommits")) {
            await state.graphWebview.resetElideOverride();
          }
          await state.graphWebview.refresh();
        }
      }
    },
    undefined,
    context.subscriptions,
  );

  return { throttledPoll, scheduleNextPoll };
}
