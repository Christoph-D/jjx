import * as vscode from "vscode";
import type { JJRepository } from "./repository";
import { WorkspaceSourceControlManager, type ForceRefresh } from "./source-control";
import type { JJGraphWebview } from "./graph-webview";
import type { OperationLogManager } from "./operation-log-tree-view";

export interface ExtensionState {
  context: vscode.ExtensionContext;
  workspaceSCM: WorkspaceSourceControlManager;
  graphWebview: JJGraphWebview | undefined;
  operationLogManager: OperationLogManager | undefined;
  throttledPoll: ((forceRefresh: ForceRefresh) => Promise<void>) | undefined;
  getSelectedRepo(): JJRepository | undefined;
  setSelectedRepo(repository: JJRepository): void;
  onDidSetSelectedRepository: vscode.Event<void>;
  onInit(callback: () => void): void;
  initialize(graphWebview: JJGraphWebview, operationLogManager: OperationLogManager): void;
}

export function createExtensionState(
  context: vscode.ExtensionContext,
  workspaceSCM: WorkspaceSourceControlManager,
): ExtensionState {
  const _onDidSetSelectedRepository = new vscode.EventEmitter<void>();
  const onDidSetSelectedRepository = _onDidSetSelectedRepository.event;
  context.subscriptions.push(_onDidSetSelectedRepository);

  let _graphWebview: JJGraphWebview | undefined;
  let _operationLogManager: OperationLogManager | undefined;
  const initCallbacks: (() => void)[] = [];

  function setSelectedRepo(repository: JJRepository): void {
    context.workspaceState.update("selectedRepository", repository.repositoryRoot);
    _onDidSetSelectedRepository.fire();
  }

  function getSelectedRepo(): JJRepository | undefined {
    const selectedRepo = context.workspaceState.get<string>("selectedRepository");
    if (selectedRepo) {
      return workspaceSCM.getByRoot(selectedRepo)?.repository || workspaceSCM.repoSCMs[0]?.repository;
    }
    return workspaceSCM.repoSCMs[0]?.repository;
  }

  return {
    context,
    workspaceSCM,
    throttledPoll: undefined,
    get graphWebview() {
      return _graphWebview;
    },
    get operationLogManager() {
      return _operationLogManager;
    },
    getSelectedRepo,
    setSelectedRepo,
    onDidSetSelectedRepository,
    onInit(callback: () => void) {
      initCallbacks.push(callback);
    },
    initialize(graphWebview: JJGraphWebview, operationLogManager: OperationLogManager) {
      _graphWebview = graphWebview;
      _operationLogManager = operationLogManager;
      for (const cb of initCallbacks) {
        cb();
      }
      initCallbacks.length = 0;
    },
  };
}
