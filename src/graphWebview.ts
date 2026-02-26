import * as vscode from "vscode";
import * as fs from "fs";
import type { JJRepository, LogEntry } from "./repository";
import path from "path";

type Message = {
  command: string;
  changeId: string;
  selectedNodes: string[];
};

export class ChangeNode {
  changeId: string;
  // Shortest change ID prefix
  changeIdPrefix: string;
  // Suffix of the short change ID (after the prefix)
  changeIdSuffix: string;
  label: string;
  description: string;
  tooltip: string;
  contextValue: string;
  parentChangeIds?: string[];
  branchType?: string;
  constructor(
    changeId: string,
    changeIdPrefix: string,
    changeIdSuffix: string,
    label: string,
    description: string,
    tooltip: string,
    contextValue: string,
    parentChangeIds?: string[],
    branchType?: string,
  ) {
    this.changeId = changeId;
    this.changeIdPrefix = changeIdPrefix;
    this.changeIdSuffix = changeIdSuffix;
    this.label = label;
    this.description = description;
    this.tooltip = tooltip;
    this.contextValue = contextValue;
    this.parentChangeIds = parentChangeIds;
    this.branchType = branchType;
  }
}

export class JJGraphWebview implements vscode.WebviewViewProvider {
  subscriptions: {
    dispose(): unknown;
  }[] = [];

  public panel?: vscode.WebviewView;
  public repository: JJRepository;
  public selectedNodes: Set<string> = new Set();

  constructor(
    private readonly extensionUri: vscode.Uri,
    repo: JJRepository,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.repository = repo;

    // Register the webview provider
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider("jjGraphWebview", this, {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
      }),
    );
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
  ): Promise<void> {
    this.panel = webviewView;
    this.panel.title = `Source Control Graph (${path.basename(this.repository.repositoryRoot)})`;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getWebviewContent(webviewView.webview);

    await new Promise<void>((resolve) => {
      const messageListener = webviewView.webview.onDidReceiveMessage(
        (message: Message) => {
          if (message.command === "webviewReady") {
            messageListener.dispose();
            resolve();
          }
        },
      );
    });

    webviewView.webview.onDidReceiveMessage(async (message: Message) => {
      switch (message.command) {
        case "editChange":
          try {
            const config = vscode.workspace.getConfiguration("jjk");
            const changeEditAction =
              config.get<string>("changeEditAction") || "edit";
            if (changeEditAction === "new") {
              await this.repository.new(undefined, [message.changeId]);
            } else {
              if (message.changeId === "zzzzzzzz") {
                return;
              }
              await this.repository.editRetryImmutable(message.changeId);
            }
          } catch (error: unknown) {
            vscode.window.showErrorMessage(
              `Failed to switch to change: ${error as string}`,
            );
          }
          break;
        case "editChangeDirect":
          try {
            if (message.changeId === "zzzzzzzz") {
              return;
            }
            const status = await this.repository.getStatus(true);
            if (message.changeId === status.workingCopy.changeId) {
              return;
            }
            await this.repository.editRetryImmutable(message.changeId);
          } catch (error: unknown) {
            vscode.window.showErrorMessage(
              `Failed to switch to change: ${error as string}`,
            );
          }
          break;
        case "selectChange":
          this.selectedNodes = new Set(message.selectedNodes);
          vscode.commands.executeCommand(
            "setContext",
            "jjGraphView.nodesSelected",
            message.selectedNodes.length,
          );
          break;
      }
    });

    await this.refresh();
  }

  public async setSelectedRepository(repo: JJRepository) {
    const prevRepo = this.repository;
    this.repository = repo;
    if (this.panel) {
      this.panel.title = `Source Control Graph (${path.basename(this.repository.repositoryRoot)})`;
    }
    if (prevRepo.repositoryRoot !== repo.repositoryRoot) {
      await this.refresh();
    }
  }

  public async refresh() {
    if (!this.panel) {
      return;
    }

    const config = vscode.workspace.getConfiguration("jjk");
    const graphStyle = config.get<string>("graphStyle") || "full";

    const entries = await this.repository.log();
    const changes = parseJJLogJson(entries, graphStyle);

    const status = await this.repository.getStatus(true);
    const workingCopyId = status.workingCopy.changeId;

    this.selectedNodes.clear();
    const changeEditAction = config.get<string>("changeEditAction");

    this.panel.webview.postMessage({
      command: "updateGraph",
      changes: changes,
      workingCopyId,
      changeEditAction,
      graphStyle,
      preserveScroll: true,
    });
  }

  private getWebviewContent(webview: vscode.Webview) {
    // In development, files are in src/webview
    // In production (bundled extension), files are in dist/webview
    const webviewPath = this.extensionUri.fsPath.includes("extensions")
      ? "dist"
      : "src";

    const cssPath = vscode.Uri.joinPath(
      this.extensionUri,
      webviewPath,
      "webview",
      "graph.css",
    );
    const cssUri = webview.asWebviewUri(cssPath);

    const codiconPath = vscode.Uri.joinPath(
      this.extensionUri,
      webviewPath === "dist"
        ? "dist/codicons"
        : "node_modules/@vscode/codicons/dist",
      "codicon.css",
    );
    const codiconUri = webview.asWebviewUri(codiconPath);

    const htmlPath = vscode.Uri.joinPath(
      this.extensionUri,
      webviewPath,
      "webview",
      "graph.html",
    );
    let html = fs.readFileSync(htmlPath.fsPath, "utf8");

    // Replace placeholders in the HTML
    html = html.replace("${cssUri}", cssUri.toString());
    html = html.replace("${codiconUri}", codiconUri.toString());

    return html;
  }

  areChangeNodesEqual(a: ChangeNode[], b: ChangeNode[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    return a.every((nodeA, index) => nodeA.changeId === b[index].changeId);
  }

  dispose() {
    this.subscriptions.forEach((s) => s.dispose());
  }
}

function description(entry: LogEntry) {
  if (entry.root) {
    return "root()";
  }
  const prefix = entry.empty ? "(empty) " : "";
  const desc = entry.description.split("\n")[0] || "(no description set)";
  return prefix + desc;
}

export function parseJJLogJson(
  entries: LogEntry[],
  style: string = "full",
): ChangeNode[] {
  return entries.map((entry) => {
    const changeIdShort = entry.change_id_short;
    const changeIdShortest = entry.change_id_shortest;
    const changeIdSuffix = changeIdShort.slice(changeIdShortest.length);
    const email = entry.author.email;
    const timestamp = entry.author.timestamp;
    const commitId = entry.commit_id_short;

    let branchType: string | undefined;
    if (entry.current_working_copy) {
      branchType = "@";
    } else if (entry.immutable) {
      branchType = "◆";
    } else {
      branchType = "○";
    }

    let formattedLine: string;

    const desc = description(entry);
    if (style === "compact") {
      formattedLine = `${changeIdShort} ${desc}`;
    } else {
      formattedLine = `${changeIdShort} ${desc} • ${commitId}`;
    }
    const formattedDescription = (entry.mine || entry.root) ? timestamp : `${email} ${timestamp}`;

    return new ChangeNode(
      entry.change_id,
      changeIdShortest,
      changeIdSuffix,
      formattedLine,
      formattedDescription,
      entry.change_id,
      changeIdShort,
      entry.parents,
      branchType,
    );
  });
}
