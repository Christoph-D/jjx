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
 * One open Details webview panel: the VS Code panel plus the state needed to keep its webview
 * in sync. `pinnedCommitId` pins the panel to one change (see {@link DetailsWebview.showChange});
 * without it the panel follows the graph selection.
 */
interface DetailsPanel {
  panel: vscode.WebviewPanel;
  pinnedCommitId: string | undefined;
  postedKey: string | undefined;
  fetchSeq: number;
  disposed: boolean;
}

/**
 * Hosts the Details webview panels, which show detailed information about a change. The main
 * panel is driven by the graph selection (see {@link JJGraphWebview.onDidChangeSelection}):
 * with no selection it prompts to select a change, otherwise it shows the details of the last
 * selected change. Panels opened via {@link showChange} are pinned to one change and keep
 * showing it regardless of the selection. Details are fetched by commit ID, so the shown
 * content stays pinned while the change is being rewritten.
 */
export class DetailsWebview implements vscode.Disposable {
  private selectionPanel: DetailsPanel | undefined;
  private pinnedPanels: DetailsPanel[] = [];
  private selection: GraphSelection[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly graphWebview: JJGraphWebview,
  ) {
    this.disposables.push(
      graphWebview.onDidChangeSelection((selection) => {
        this.selection = selection;
        if (this.selectionPanel) {
          void this.syncPanel(this.selectionPanel, false);
        }
      }),
    );
  }

  /** Opens (or reveals) the Details panel that follows the graph selection. */
  public open(): void {
    if (this.selectionPanel) {
      this.selectionPanel.panel.reveal();
      return;
    }
    this.selectionPanel = this.createPanel("JJ Commit Details", undefined, (detailsPanel) => {
      if (this.selectionPanel === detailsPanel) {
        this.selectionPanel = undefined;
      }
    });
  }

  /**
   * Opens a Details panel showing the commit with the given commit ID, titled with the given
   * short change ID. Unlike {@link open}, the panel does not follow the graph selection: it
   * keeps showing this change until it is closed. Reveals the existing panel if this commit
   * is already shown.
   */
  public showChange(commitId: string, shortChangeId: string): void {
    const existing = this.pinnedPanels.find((detailsPanel) => detailsPanel.pinnedCommitId === commitId);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    const detailsPanel = this.createPanel(`JJ Commit Details (${shortChangeId})`, commitId, (open) => {
      this.pinnedPanels = this.pinnedPanels.filter((other) => other !== open);
    });
    this.pinnedPanels.push(detailsPanel);
  }

  /**
   * Re-fetches the details shown by every open panel. Called after the repository changed,
   * because metadata shown in the view (bookmarks, tags) can move between commits even
   * though the selected commit IDs are immutable.
   */
  public refresh(): void {
    if (this.selectionPanel) {
      void this.syncPanel(this.selectionPanel, true);
    }
    for (const detailsPanel of this.pinnedPanels) {
      void this.syncPanel(detailsPanel, true);
    }
  }

  dispose() {
    this.disposables.forEach((d) => {
      d.dispose();
    });
  }

  private createPanel(
    title: string,
    pinnedCommitId: string | undefined,
    onDispose: (detailsPanel: DetailsPanel) => void,
  ): DetailsPanel {
    const panel = vscode.window.createWebviewPanel("jjDetailsView", title, vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
      retainContextWhenHidden: true,
    });
    const detailsPanel: DetailsPanel = {
      panel,
      pinnedCommitId,
      postedKey: undefined,
      fetchSeq: 0,
      disposed: false,
    };
    panel.webview.html = this.getWebviewContent(panel.webview);
    const panelDisposables: vscode.Disposable[] = [
      panel.webview.onDidReceiveMessage((message: DetailsWebviewToExtensionMessage) => {
        void this.handleMessage(message, detailsPanel);
      }),
    ];
    panel.onDidDispose(() => {
      panelDisposables.forEach((d) => {
        d.dispose();
      });
      detailsPanel.disposed = true;
      onDispose(detailsPanel);
    });
    return detailsPanel;
  }

  /**
   * Brings a panel's webview in sync with the commit it should show: the commit the panel is
   * pinned to, or the last selected change for selection-following panels. `forced` re-posts
   * the state even when that commit did not change. Responses to superseded fetches are
   * dropped so the view never flips back to a stale change.
   */
  private async syncPanel(detailsPanel: DetailsPanel, forced: boolean): Promise<void> {
    const { panel } = detailsPanel;
    const repo = this.graphWebview.repository;
    const commitId = detailsPanel.pinnedCommitId ?? this.selection[this.selection.length - 1]?.commitId;
    const key = `${repo?.repositoryRoot ?? "<no-repo>"}\0${commitId ?? ""}`;
    if (!forced && key === detailsPanel.postedKey) {
      return;
    }
    detailsPanel.postedKey = key;
    const seq = ++detailsPanel.fetchSeq;

    if (!repo || !commitId) {
      void panel.webview.postMessage({ command: "showNoSelection" });
      return;
    }
    try {
      const details = await repo.getChangeDetails(commitId);
      if (seq !== detailsPanel.fetchSeq || detailsPanel.disposed) {
        return;
      }
      const msg: DetailsExtensionToWebviewMessage = { command: "updateDetails", change: details };
      void panel.webview.postMessage(msg);
    } catch (error: unknown) {
      if (seq !== detailsPanel.fetchSeq || detailsPanel.disposed) {
        return;
      }
      logger.warn(`Failed to fetch change details: ${error instanceof Error ? error.message : String(error)}`);
      void panel.webview.postMessage({ command: "showErrorState" });
    }
  }

  private async handleMessage(message: DetailsWebviewToExtensionMessage, detailsPanel: DetailsPanel): Promise<void> {
    const repo = this.graphWebview.repository;
    switch (message.command) {
      case "webviewReady":
        await this.syncPanel(detailsPanel, true);
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
