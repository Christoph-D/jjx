import * as vscode from "vscode";
import * as fs from "fs";
import path from "path";
import type { GraphSelection, JJGraphWebview } from "./graph-webview";
import type { DetailsExtensionToWebviewMessage, DetailsWebviewToExtensionMessage } from "./details-protocol";
import { formatAtRevTitle, formatDiffTitle, formatWorkingCopyTitle, shouldOpenWorkingCopyRightSide } from "./utils";
import type { FullChangeId } from "./types";
import { toJJUri } from "./uri";
import { showErrorMessage } from "./vscode-utils";
import { logger } from "./logger";
import { joinRepositoryPath, repositoryRelativePath, toWorkspaceUri } from "./workspace-paths";

/**
 * Hosts the Details webview panel, which shows detailed information about the change(s)
 * currently selected in the graph view. The view is driven by the graph selection (see
 * {@link JJGraphWebview.onDidChangeSelection}): with no selection it prompts to select a
 * change, otherwise it shows the details of the last selected change. Details are fetched
 * by commit ID, so the shown content stays pinned while the change is being rewritten.
 */
export class DetailsWebview implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private selection: GraphSelection[] = [];
  private postedKey: string | undefined;
  private fetchSeq = 0;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly graphWebview: JJGraphWebview,
  ) {
    this.disposables.push(
      graphWebview.onDidChangeSelection((selection) => {
        this.selection = selection;
        void this.sync(false);
      }),
    );
  }

  /** Opens (or reveals) the Details panel. */
  public open(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel("jjDetailsView", "JJ Commit Details", vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
      retainContextWhenHidden: true,
    });
    this.panel = panel;
    panel.webview.html = this.getWebviewContent(panel.webview);
    const panelDisposables: vscode.Disposable[] = [
      panel.webview.onDidReceiveMessage((message: DetailsWebviewToExtensionMessage) => {
        void this.handleMessage(message);
      }),
    ];
    panel.onDidDispose(() => {
      panelDisposables.forEach((d) => {
        d.dispose();
      });
      if (this.panel === panel) {
        this.panel = undefined;
        this.postedKey = undefined;
      }
    });
  }

  /**
   * Re-fetches the details of the current selection. Called after the repository changed,
   * because metadata shown in the view (bookmarks, tags) can move between commits even
   * though the selected commit IDs are immutable.
   */
  public refresh(): void {
    void this.sync(true);
  }

  dispose() {
    this.disposables.forEach((d) => {
      d.dispose();
    });
  }

  /**
   * Brings the webview in sync with the current selection. `forced` re-posts the state even
   * when the selection did not change. Responses to superseded fetches are dropped so the
   * view never flips back to a stale change.
   */
  private async sync(forced: boolean): Promise<void> {
    const panel = this.panel;
    if (!panel) {
      return;
    }
    const repo = this.graphWebview.repository;
    const selection = this.selection;
    const key = `${repo?.repositoryRoot ?? "<no-repo>"}\0${selection.map((s) => s.commitId).join(",")}`;
    if (!forced && key === this.postedKey) {
      return;
    }
    this.postedKey = key;
    const seq = ++this.fetchSeq;

    if (!repo || selection.length === 0) {
      void panel.webview.postMessage({ command: "showNoSelection" });
      return;
    }
    try {
      const details = await repo.getChangeDetails(selection[selection.length - 1].commitId);
      if (seq !== this.fetchSeq || this.panel !== panel) {
        return;
      }
      const msg: DetailsExtensionToWebviewMessage = { command: "updateDetails", change: details };
      void panel.webview.postMessage(msg);
    } catch (error: unknown) {
      if (seq !== this.fetchSeq || this.panel !== panel) {
        return;
      }
      logger.warn(`Failed to fetch change details: ${error instanceof Error ? error.message : String(error)}`);
      void panel.webview.postMessage({ command: "showErrorState" });
    }
  }

  private async handleMessage(message: DetailsWebviewToExtensionMessage): Promise<void> {
    const repo = this.graphWebview.repository;
    switch (message.command) {
      case "webviewReady":
        await this.sync(true);
        break;
      case "openFileDiff": {
        if (!repo) {
          break;
        }
        const { commitId, shortChangeId, path: relPath, status, renamedFrom } = message;
        const absPath = joinRepositoryPath(repo.repositoryRoot, relPath);
        const fileUri = toWorkspaceUri(absPath);

        let beforeParams: Parameters<typeof toJJUri>[1];
        let afterParams: Parameters<typeof toJJUri>[1];
        if (status === "A") {
          beforeParams = { deleted: true };
          afterParams = { rev: commitId };
        } else if (status === "D") {
          beforeParams = { diffOriginalRev: commitId };
          afterParams = { deleted: true };
        } else if (status === "R" || status === "C") {
          beforeParams = renamedFrom
            ? { diffOriginalRev: commitId, renamedFrom: joinRepositoryPath(repo.repositoryRoot, renamedFrom) }
            : { diffOriginalRev: commitId };
          afterParams = { rev: commitId };
        } else {
          beforeParams = { diffOriginalRev: commitId };
          afterParams = { rev: commitId };
        }
        const beforeUri = toJJUri(fileUri, beforeParams);
        try {
          const useWorkingCopyRight = shouldOpenWorkingCopyRightSide(
            commitId as FullChangeId,
            status,
            await repo.isFileUnchangedInWorkingCopy(commitId as FullChangeId, absPath),
          );
          const afterUri = useWorkingCopyRight ? fileUri : toJJUri(fileUri, afterParams);
          const title = useWorkingCopyRight
            ? formatDiffTitle(renamedFrom, path.basename(relPath), `${shortChangeId} Parent`, formatWorkingCopyTitle())
            : formatDiffTitle(renamedFrom, path.basename(relPath), undefined, shortChangeId);
          await vscode.commands.executeCommand("vscode.diff", beforeUri, afterUri, title);
        } catch (error: unknown) {
          showErrorMessage("Failed to open diff", error);
        }
        break;
      }
      case "openFileAtRevision": {
        if (!repo) {
          break;
        }
        const absPath = joinRepositoryPath(repo.repositoryRoot, message.path);
        try {
          // The working-copy commit opens its live file from disk, mirroring the behavior
          // of the graph view's changed files.
          const uri = message.currentWorkingCopy
            ? toWorkspaceUri(absPath)
            : toJJUri(toWorkspaceUri(absPath), { rev: message.commitId });
          const revForDisplay = message.currentWorkingCopy ? formatWorkingCopyTitle() : message.shortChangeId;
          await vscode.commands.executeCommand(
            "vscode.open",
            uri,
            {},
            formatAtRevTitle(path.basename(message.path), revForDisplay),
          );
        } catch (error: unknown) {
          showErrorMessage("Failed to open file", error);
        }
        break;
      }
      case "openFileInWorkingCopy": {
        if (!repo) {
          break;
        }
        const absPath = joinRepositoryPath(repo.repositoryRoot, message.path);
        try {
          await vscode.commands.executeCommand("vscode.open", toWorkspaceUri(absPath), {});
        } catch (error: unknown) {
          showErrorMessage("Failed to open file", error);
        }
        break;
      }
      case "copyPath":
        if (repo) {
          await vscode.env.clipboard.writeText(
            toWorkspaceUri(joinRepositoryPath(repo.repositoryRoot, message.path)).fsPath,
          );
        }
        break;
      case "copyRelativePath": {
        if (!repo) {
          break;
        }
        const absPath = joinRepositoryPath(repo.repositoryRoot, message.path);
        await vscode.env.clipboard.writeText(repositoryRelativePath(repo.repositoryRoot, absPath));
        break;
      }
      case "copyId":
        await vscode.env.clipboard.writeText(message.id);
        break;
      case "reportError":
        logger.error(`Webview error: ${message.message}${message.stack ? `\n${message.stack}` : ""}`);
        break;
      case "showWarning":
        vscode.window.showWarningMessage(message.message);
        break;
    }
  }

  private getWebviewContent(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "details.css"));
    const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "codicons", "codicon.css"));
    const detailsJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "details.js"));

    const htmlPath = vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "details.html");
    let html = fs.readFileSync(htmlPath.fsPath, "utf8");

    html = html.replace("${cssUri}", cssUri.toString());
    html = html.replace("${codiconUri}", codiconUri.toString());
    html = html.replace("${detailsJsUri}", detailsJsUri.toString());

    return html;
  }
}
