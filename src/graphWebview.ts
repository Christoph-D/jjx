import * as vscode from "vscode";
import * as fs from "fs";
import type { JJRepository, LogEntry, LogEntryLocalRef, LogEntryRemoteRef, ParentRef } from "./repository";
import { BookmarkBackwardsError, StaleWorkingCopyError } from "./errors";
import path from "path";
import { assignLanes } from "./laneAssigner";
import { classifyEdges, insertSyntheticNodes, getUniqueEntryId } from "./elidedEdges";
import type { SyntheticNode } from "./elidedEdges";
import { logger } from "./logger";
import { getLogRevset, getNumberOfImmutableParentsInLog } from "./config";

export type { LaneNode, LaneEdge, ChangeIdGraph } from "./laneAssigner";

const rootChangeId = "z".repeat(32);

type Message = {
  command: string;
  changeId: string;
  selectedNodes: string[];
  bookmark: string;
  tag: string;
  targetChangeId: string;
  immutable: boolean;
  withDescendants: boolean;
};

export interface ChangeNode {
  changeId: string;
  changeIdPrefix: string;
  changeIdSuffix: string;
  changeOffset: string | null;
  label: string;
  description: string;
  tooltip: string;
  currentWorkingCopy: boolean;
  localBookmarks: LogEntryLocalRef[];
  remoteBookmarks: LogEntryRemoteRef[];
  localTags: LogEntryLocalRef[];
  remoteTags: LogEntryRemoteRef[];
  workingCopies: string[];
  parentChangeIds?: string[];
  branchType?: string;
  authorName: string;
  authorEmail: string;
  authorTimestamp: string;
  fullDescription: string;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  mine: boolean;
  conflict: boolean;
  elided?: number;
}

export { assignLanes } from "./laneAssigner";

export class JJGraphWebview implements vscode.WebviewViewProvider {
  subscriptions: {
    dispose(): unknown;
  }[] = [];

  public panel?: vscode.WebviewView;
  public repository: JJRepository;
  public selectedNodes: Set<string> = new Set();
  private elideOverride: boolean | null = null;

  private _onDidChangeSelection = new vscode.EventEmitter<string[]>();
  readonly onDidChangeSelection: vscode.Event<string[]> = this._onDidChangeSelection.event;

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

  public async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.panel = webviewView;
    this.panel.title = `JJ Graph (${path.basename(this.repository.repositoryRoot)})`;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getWebviewContent(webviewView.webview);

    await new Promise<void>((resolve) => {
      const messageListener = webviewView.webview.onDidReceiveMessage((message: Message) => {
        if (message.command === "webviewReady") {
          messageListener.dispose();
          resolve();
        }
      });
    });

    webviewView.webview.onDidReceiveMessage(async (message: Message) => {
      switch (message.command) {
        case "editChange":
          try {
            const config = vscode.workspace.getConfiguration("jjx");
            const changeEditAction = config.get<string>("changeEditAction") || "edit";
            if (changeEditAction === "new") {
              await this.repository.new(undefined, [message.changeId]);
            } else {
              if (message.changeId === rootChangeId) {
                return;
              }
              await this.repository.editRetryImmutable(message.changeId);
            }
          } catch (error: unknown) {
            vscode.window.showErrorMessage(
              `Failed to switch to change: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          break;
        case "editChangeDirect":
          try {
            if (message.changeId === rootChangeId) {
              return;
            }
            const status = await this.repository.getStatus(true);
            if (message.changeId === status.workingCopy.changeId) {
              return;
            }
            await this.repository.editRetryImmutable(message.changeId);
          } catch (error: unknown) {
            vscode.window.showErrorMessage(
              `Failed to switch to change: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          break;
        case "selectChange":
          this.selectedNodes = new Set(message.selectedNodes);
          vscode.commands.executeCommand("setContext", "jjGraphView.nodesSelected", message.selectedNodes.length);
          this._onDidChangeSelection.fire(message.selectedNodes);
          break;
        case "moveBookmark":
          try {
            await this.repository.moveBookmark(message.bookmark, message.targetChangeId);
            await this.refresh();
          } catch (error: unknown) {
            if (error instanceof BookmarkBackwardsError) {
              const choice = await vscode.window.showQuickPick(["Continue"], {
                title: "Moving bookmark backwards or sideways, are you sure?",
              });
              if (choice) {
                try {
                  await this.repository.moveBookmark(message.bookmark, message.targetChangeId, true);
                  await this.refresh();
                } catch (retryError: unknown) {
                  vscode.window.showErrorMessage(`Failed to move bookmark: ${retryError as string}`);
                }
              }
            } else {
              vscode.window.showErrorMessage(
                `Failed to move bookmark: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
          break;
        case "createBookmark":
          try {
            const bookmarkName = await vscode.window.showInputBox({
              prompt: "Enter Bookmark Name",
              placeHolder: "bookmark-name",
            });
            if (bookmarkName === undefined || bookmarkName === "") {
              return;
            }
            await this.repository.createBookmark(bookmarkName, message.targetChangeId);
            await this.refresh();
          } catch (error: unknown) {
            vscode.window.showErrorMessage(
              `Failed to create bookmark: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          break;
        case "createTag":
          try {
            const tagName = await vscode.window.showInputBox({
              prompt: "Enter Tag Name",
              placeHolder: "v1.0.0",
            });
            if (tagName === undefined || tagName === "") {
              return;
            }
            await this.repository.createTag(tagName, message.targetChangeId);
            await this.refresh();
          } catch (error: unknown) {
            vscode.window.showErrorMessage(
              `Failed to create tag: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          break;
        case "deleteBookmark":
          try {
            await this.repository.deleteBookmark(message.bookmark);
            await this.refresh();
          } catch (error: unknown) {
            vscode.window.showErrorMessage(
              `Failed to delete bookmark: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          break;
        case "deleteTag":
          try {
            await this.repository.deleteTag(message.tag);
            await this.refresh();
          } catch (error: unknown) {
            vscode.window.showErrorMessage(
              `Failed to delete tag: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          break;
        case "describeChange":
          try {
            await this.repository.describeRetryImmutable(message.changeId);
            await this.refresh();
          } catch (error: unknown) {
            vscode.window.showErrorMessage(
              `Failed to describe change: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          break;
        case "abandonChange":
          try {
            const confirm = await vscode.window.showWarningMessage(
              "Are you sure you want to abandon this change?",
              { modal: true },
              "Abandon",
            );
            if (confirm !== "Abandon") {
              return;
            }
            await this.repository.abandonRetryImmutable(message.changeId);
            await this.refresh();
          } catch (error: unknown) {
            vscode.window.showErrorMessage(
              `Failed to abandon change: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          break;
        case "rebaseOnto":
          try {
            await this.repository.rebaseRetryImmutable(
              message.changeId,
              message.targetChangeId,
              "onto",
              message.withDescendants,
            );
            await this.refresh();
          } catch (error: unknown) {
            vscode.window.showErrorMessage(
              `Failed to rebase: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          break;
        case "rebaseAfter":
          try {
            await this.repository.rebaseRetryImmutable(
              message.changeId,
              message.targetChangeId,
              "after",
              message.withDescendants,
            );
            await this.refresh();
          } catch (error: unknown) {
            vscode.window.showErrorMessage(
              `Failed to rebase: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          break;
        case "rebaseBefore":
          try {
            await this.repository.rebaseRetryImmutable(
              message.changeId,
              message.targetChangeId,
              "before",
              message.withDescendants,
            );
            await this.refresh();
          } catch (error: unknown) {
            vscode.window.showErrorMessage(
              `Failed to rebase: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          break;
        case "squashInto":
          try {
            await this.repository.squashRetryImmutable({
              fromRev: message.changeId,
              toRev: message.targetChangeId,
            });
            await this.refresh();
          } catch (error: unknown) {
            vscode.window.showErrorMessage(
              `Failed to squash: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          break;
        case "duplicateOnto":
        case "duplicateAfter":
        case "duplicateBefore":
          try {
            const mode = message.command.replace("duplicate", "").toLowerCase() as "onto" | "after" | "before";
            await this.repository.duplicate(message.changeId, message.targetChangeId, mode);
            await this.refresh();
          } catch (error: unknown) {
            vscode.window.showErrorMessage(
              `Failed to duplicate: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          break;
        case "revertOnto":
        case "revertAfter":
        case "revertBefore":
          try {
            const mode = message.command.replace("revert", "").toLowerCase() as "onto" | "after" | "before";
            await this.repository.revert(message.changeId, message.targetChangeId, mode);
            await this.refresh();
          } catch (error: unknown) {
            vscode.window.showErrorMessage(
              `Failed to revert: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          break;
        case "updateStale":
          try {
            await this.repository.updateStale();
            await this.refresh();
          } catch (error: unknown) {
            vscode.window.showErrorMessage(
              `Failed to update stale working copy: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          break;
      }
    });

    await this.updateElidingContext();
    await this.refresh();
  }

  public async setSelectedRepository(repo: JJRepository) {
    const prevRepo = this.repository;
    this.repository = repo;
    if (this.panel) {
      this.panel.title = `JJ Graph (${path.basename(this.repository.repositoryRoot)})`;
    }
    if (prevRepo.repositoryRoot !== repo.repositoryRoot) {
      await this.refresh();
    }
  }

  public async enableElideImmutableCommits(): Promise<void> {
    this.elideOverride = true;
    await this.updateElidingContext();
    await this.refresh();
  }

  public async disableElideImmutableCommits(): Promise<void> {
    this.elideOverride = false;
    await this.updateElidingContext();
    await this.refresh();
  }

  public async resetElideOverride(): Promise<void> {
    this.elideOverride = null;
    await this.updateElidingContext();
  }

  private getEffectiveEliding(): boolean {
    const configValue = vscode.workspace.getConfiguration("jjx").get<boolean>("elideImmutableCommits") ?? true;
    return this.elideOverride ?? configValue;
  }

  private async updateElidingContext(): Promise<void> {
    const effectiveEliding = this.getEffectiveEliding();
    await vscode.commands.executeCommand("setContext", "jjGraphView.elidingActive", effectiveEliding);
  }

  public async refresh() {
    if (!this.panel) {
      return;
    }

    try {
      await this.repository.getLatestOperationId(false);
      const config = vscode.workspace.getConfiguration("jjx");
      const graphStyle = config.get<string>("graphStyle") || "full";

      const rawEntries = await this.repository.log(getLogRevset(this.repository.repositoryRoot));
      const elideImmutableCommits = this.getEffectiveEliding();
      const { edges, syntheticNodes, visibleIds } = classifyEdges(rawEntries, {
        elideImmutableCommits,
        numberOfImmutableParentsInLog: getNumberOfImmutableParentsInLog(this.repository.repositoryRoot),
      });
      const entriesWithSynthetics = insertSyntheticNodes(rawEntries, syntheticNodes, edges, visibleIds);
      const { changes, maxPrefixLength, offsetWidth } = parseJJLogJson(
        entriesWithSynthetics,
        graphStyle,
        syntheticNodes,
      );

      this.selectedNodes.clear();
      const changeEditAction = config.get<string>("changeEditAction");

      const laneInfo = assignLanes(entriesWithSynthetics);

      this.panel.webview.postMessage({
        command: "updateGraph",
        changes: changes,
        laneInfo,
        changeEditAction,
        graphStyle,
        maxPrefixLength,
        offsetWidth,
        preserveScroll: true,
      });
    } catch (error) {
      if (error instanceof StaleWorkingCopyError) {
        this.panel.webview.postMessage({
          command: "showStaleState",
        });
        return;
      }
      logger.error(`Failed to refresh graph: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private getWebviewContent(webview: vscode.Webview) {
    // In development, files are in src/webview
    // In production (bundled extension), files are in dist/webview
    const webviewPath = this.extensionUri.fsPath.includes("extensions") ? "dist" : "src";

    const cssPath = vscode.Uri.joinPath(this.extensionUri, webviewPath, "webview", "graph.css");
    const cssUri = webview.asWebviewUri(cssPath);

    const codiconPath = vscode.Uri.joinPath(
      this.extensionUri,
      webviewPath === "dist" ? "dist/codicons" : "node_modules/@vscode/codicons/dist",
      "codicon.css",
    );
    const codiconUri = webview.asWebviewUri(codiconPath);

    const htmlPath = vscode.Uri.joinPath(this.extensionUri, webviewPath, "webview", "graph.html");
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
  let prefix = "";
  if (entry.hidden) {
    prefix = "(hidden) ";
  }
  if (entry.empty) {
    prefix += "(empty) ";
  }
  const desc = entry.description.split("\n")[0] || "(no description set)";
  return prefix + desc;
}

export function parseJJLogJson(
  entries: LogEntry[],
  style: string = "full",
  syntheticNodes: Map<string, SyntheticNode> = new Map(),
): { changes: ChangeNode[]; maxPrefixLength: number; offsetWidth: number } {
  const nonSyntheticEntries = entries.filter((e) => !syntheticNodes.has(getUniqueEntryId(e)));

  const changeIdCountsTotal = new Map<string, number>();
  const changeIdCountsNonHidden = new Map<string, number>();
  for (const entry of nonSyntheticEntries) {
    changeIdCountsTotal.set(entry.change_id, (changeIdCountsTotal.get(entry.change_id) ?? 0) + 1);
    if (!entry.hidden) {
      changeIdCountsNonHidden.set(entry.change_id, (changeIdCountsNonHidden.get(entry.change_id) ?? 0) + 1);
    }
  }

  const shouldShowOffset = (e: LogEntry): boolean => {
    if (!e.change_offset) {
      return false;
    }
    if (e.divergent) {
      return true;
    }
    if (e.hidden) {
      return (changeIdCountsTotal.get(e.change_id) ?? 0) > 1;
    }
    return (changeIdCountsNonHidden.get(e.change_id) ?? 0) > 1;
  };

  const offsetWidth = Math.max(
    0,
    ...nonSyntheticEntries.filter(shouldShowOffset).map((e) => e.change_offset.length + 1),
  );
  let maxPrefixLength = Math.max(4, ...nonSyntheticEntries.map((e) => e.change_id_shortest.length));

  const changes = entries.map((entry) => {
    const entryUniqueId = getUniqueEntryId(entry);
    const synthNode = syntheticNodes.get(entryUniqueId);
    if (synthNode) {
      const uniqueParentIds = entry.parents.map((p: ParentRef) =>
        p.change_offset ? `${p.change_id}/${p.change_offset}` : p.change_id,
      );

      return {
        changeId: entryUniqueId,
        changeIdPrefix: "",
        changeIdSuffix: "",
        changeOffset: null,
        label: "",
        description: "",
        tooltip: "",
        currentWorkingCopy: false,
        localBookmarks: [],
        remoteBookmarks: [],
        localTags: [],
        remoteTags: [],
        workingCopies: [],
        parentChangeIds: uniqueParentIds,
        branchType: "~",
        authorName: "",
        authorEmail: "",
        authorTimestamp: "",
        fullDescription: "",
        filesChanged: 0,
        linesAdded: 0,
        linesRemoved: 0,
        mine: false,
        conflict: false,
      };
    }

    const changeIdShortest = entry.change_id_shortest;
    const changeIdSuffix = entry.change_id
      .slice(changeIdShortest.length)
      .substring(0, Math.max(0, maxPrefixLength - changeIdShortest.length));
    const email = entry.author.email;
    const timestamp = entry.author.timestamp;
    const commitId = entry.commit_id_short;

    const showOffset = shouldShowOffset(entry);
    const changeOffset = showOffset ? entry.change_offset : null;
    const uniqueChangeId = entry.change_offset ? `${entry.change_id}/${entry.change_offset}` : entry.change_id;

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
      formattedLine = desc;
    } else {
      formattedLine = `${desc} • ${commitId}`;
    }
    const formattedDescription = entry.mine || entry.root ? timestamp : `${email} ${timestamp}`;

    const filesChanged = entry.diff?.files?.length ?? 0;
    const linesAdded = entry.diff?.total_added ?? 0;
    const linesRemoved = entry.diff?.total_removed ?? 0;

    const uniqueParentIds = entry.parents.map((p: ParentRef) =>
      p.change_offset ? `${p.change_id}/${p.change_offset}` : p.change_id,
    );

    return {
      changeId: uniqueChangeId,
      changeIdPrefix: changeIdShortest,
      changeIdSuffix: changeIdSuffix,
      changeOffset: changeOffset,
      label: formattedLine,
      description: formattedDescription,
      tooltip: entry.change_id,
      currentWorkingCopy: entry.current_working_copy,
      localBookmarks: entry.local_bookmarks.sort((a, b) => a.name.localeCompare(b.name)),
      remoteBookmarks: entry.remote_bookmarks.sort((a, b) => a.name.localeCompare(b.name)),
      localTags: entry.local_tags.sort((a, b) => a.name.localeCompare(b.name)),
      remoteTags: entry.remote_tags.sort((a, b) => a.name.localeCompare(b.name)),
      workingCopies: entry.working_copies.sort(),
      parentChangeIds: uniqueParentIds,
      branchType: branchType,
      authorName: entry.author.name,
      authorEmail: entry.author.email,
      authorTimestamp: entry.author.timestamp,
      fullDescription: entry.description,
      filesChanged: filesChanged,
      linesAdded: linesAdded,
      linesRemoved: linesRemoved,
      mine: entry.mine,
      conflict: entry.conflict,
    };
  });

  const hasConflict = entries.some((e) => e.conflict);
  if (hasConflict) {
    maxPrefixLength += 2;
  }

  return { changes, maxPrefixLength, offsetWidth };
}
