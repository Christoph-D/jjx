import * as path from "path";
import * as vscode from "vscode";
import type { ExtensionState } from "./extension-state";
import { toWorkspaceUri } from "./workspace-paths";

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export async function registerColocatedCheck(
  state: ExtensionState,
): Promise<(specificFolders?: string[]) => Promise<void>> {
  const context = state.context;

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  context.subscriptions.push(statusBarItem);

  const reposWithWarnings = new Set<string>();

  const checkRepos = async (specificFolders?: string[]) => {
    const colocatedRepos = [];

    for (const repoSCM of state.workspaceSCM.repoSCMs) {
      const repoRoot = repoSCM.repositoryRoot;

      if (specificFolders && !specificFolders.includes(repoRoot)) {
        continue;
      }

      const jjDirExists = await fileExists(vscode.Uri.joinPath(toWorkspaceUri(repoRoot), ".jj"));
      const gitDirExists = await fileExists(vscode.Uri.joinPath(toWorkspaceUri(repoRoot), ".git"));

      if (jjDirExists && gitDirExists) {
        const isGitEnabled = vscode.workspace.getConfiguration("git", toWorkspaceUri(repoRoot)).get("enabled");

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
      const folderName = path.basename(repoRoot);
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
        const folderName = path.basename(repoRoot);
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

  context.subscriptions.push(
    vscode.commands.registerCommand("jj.checkColocatedRepos", async () => {
      await checkRepos();
    }),
  );

  await checkRepos();

  return checkRepos;
}
