import * as vscode from "vscode";
import * as fs from "fs";
import type { JJRepository } from "./repository";
import { createSplitCheckboxState, type SplitCheckboxState } from "./split/hunk-model";
import { toSplitViewEntries } from "./split-protocol";
import type { SplitExtensionToWebviewMessage, SplitWebviewToExtensionMessage } from "./split-protocol";
import { formatChangeIdShort } from "./utils";

const MAX_TITLE_DESCRIPTION_LENGTH = 60;

/**
 * Hosts the Split view webview panel: shows the diff of a commit as a hierarchical
 * checkbox tree and reports the final selection back (mirrors the message handling of
 * {@link JJGraphWebview}).
 */
export class SplitWebview {
  constructor(private readonly extensionUri: vscode.Uri) {}

  /**
   * Opens the Split view for the commit `commitId` (a full commit id, so the diff stays
   * pinned across concurrent repo updates). Resolves with the checked-state model the
   * user confirmed with Split, or `undefined` if the view was cancelled or closed. The
   * panel is closed before the promise resolves.
   */
  public async selectChanges(repo: JJRepository, commitId: string): Promise<SplitCheckboxState | undefined> {
    const show = await repo.show(commitId);
    const shortChangeId = formatChangeIdShort(show.change.changeId);
    const descriptionFirstLine = show.change.description.split("\n")[0].trim() || "(no description set)";
    const entries = await repo.getSplitFileEntries(commitId);

    const panel = vscode.window.createWebviewPanel(
      "jjSplitView",
      `Split ${shortChangeId}: ${truncateDescription(descriptionFirstLine)}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [this.extensionUri],
        retainContextWhenHidden: true,
      },
    );
    panel.webview.html = this.getWebviewContent(panel.webview);

    return await new Promise<SplitCheckboxState | undefined>((resolve) => {
      let settled = false;
      // Mirror of the webview's checkbox selection, updated on every toggle, so the latest
      // state is at hand even when the panel is closed without confirming.
      let latestState: SplitCheckboxState = createSplitCheckboxState();
      const settle = (result: SplitCheckboxState | undefined) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(result);
      };

      const messageListener = panel.webview.onDidReceiveMessage((message: SplitWebviewToExtensionMessage) => {
        switch (message.command) {
          case "webviewReady": {
            // Sent again when the webview is restored after being unloaded.
            const msg: SplitExtensionToWebviewMessage = {
              command: "updateSplitFiles",
              entries: toSplitViewEntries(entries),
              metadata: { shortChangeId, descriptionFirstLine },
            };
            void panel.webview.postMessage(msg);
            break;
          }
          case "stateChanged":
            latestState = message.state;
            break;
          case "split":
            settle(message.state);
            panel.dispose();
            break;
          case "cancel":
            settle(undefined);
            panel.dispose();
            break;
        }
      });

      // VS Code cannot veto a panel close (onDidDispose fires after the panel is gone), so
      // closing the view without confirming can only be handled after the fact: ask whether
      // the latest selection should be applied after all. When the split was already settled
      // via Split/Cancel (which dispose the panel themselves), stay silent. Closing the whole
      // window or reloading cannot wait for the answer, so the split is then discarded.
      // "Discard" is marked as the close affordance so VS Code does not add a third
      // "Cancel" button to the dialog (Escape then discards, just like "Discard").
      panel.onDidDispose(() => {
        messageListener.dispose();
        if (settled) {
          return;
        }
        void vscode.window
          .showWarningMessage(
            "Apply the split with the current selection?",
            { modal: true },
            { title: "Apply Split" },
            { title: "Discard", isCloseAffordance: true },
          )
          .then((answer) => settle(answer?.title === "Apply Split" ? latestState : undefined));
      });
    });
  }

  private getWebviewContent(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "split.css"));
    const codiconUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "codicons", "codicon.css"));
    const splitJsUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "split.js"));

    const htmlPath = vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "split.html");
    let html = fs.readFileSync(htmlPath.fsPath, "utf8");

    html = html.replace("${cssUri}", cssUri.toString());
    html = html.replace("${codiconUri}", codiconUri.toString());
    html = html.replace("${splitJsUri}", splitJsUri.toString());

    return html;
  }
}

function truncateDescription(description: string): string {
  return description.length > MAX_TITLE_DESCRIPTION_LENGTH
    ? `${description.slice(0, MAX_TITLE_DESCRIPTION_LENGTH - 1)}…`
    : description;
}
