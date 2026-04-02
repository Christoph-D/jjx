import * as vscode from "vscode";
import "./repository";
import { initExtensionDir } from "./config";
import { WorkspaceSourceControlManager } from "./sourceControl";
import { JJDecorationProvider } from "./decorationProvider";
import { initLogger, logger } from "./logger";
import { createIPCServer } from "./ipc/ipcServer";
import { JJEditor, JJMergeEditor, JJDiffTool, JJSquashTool } from "./jjEditor";
import { killAllProcesses } from "./process";
import { createExtensionState } from "./extensionState";
import { registerPreInitCommands, registerInitCommands } from "./commands";
import { registerAnnotations, registerStatusBar } from "./annotations";
import { createPolling } from "./polling";
import { registerColocatedCheck } from "./colocatedCheck";

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

  const state = createExtensionState(context, workspaceSCM);

  registerPreInitCommands(state);

  const checkRepos = await registerColocatedCheck(state);

  const { throttledPoll, scheduleNextPoll } = createPolling(state, checkRepos);
  state.throttledPoll = throttledPoll;

  state.onInit(() => {
    registerInitCommands(state);
    registerAnnotations(state);
    registerStatusBar(state);
  });

  void scheduleNextPoll();
}

export function deactivate() {
  killAllProcesses();
}
