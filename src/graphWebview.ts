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

export class ChangeNode {
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
  constructor(
    changeId: string,
    changeIdPrefix: string,
    changeIdSuffix: string,
    changeOffset: string | null,
    label: string,
    description: string,
    tooltip: string,
    currentWorkingCopy: boolean,
    localBookmarks: LogEntryLocalRef[],
    remoteBookmarks: LogEntryRemoteRef[],
    localTags: LogEntryLocalRef[],
    remoteTags: LogEntryRemoteRef[],
    workingCopies: string[],
    parentChangeIds: string[] | undefined,
    branchType: string | undefined,
    authorName: string,
    authorEmail: string,
    authorTimestamp: string,
    fullDescription: string,
    filesChanged: number,
    linesAdded: number,
    linesRemoved: number,
    mine: boolean,
    conflict: boolean,
    elided?: number,
  ) {
    this.changeId = changeId;
    this.changeIdPrefix = changeIdPrefix;
    this.changeIdSuffix = changeIdSuffix;
    this.changeOffset = changeOffset;
    this.label = label;
    this.description = description;
    this.tooltip = tooltip;
    this.currentWorkingCopy = currentWorkingCopy;
    this.localBookmarks = localBookmarks;
    this.remoteBookmarks = remoteBookmarks;
    this.localTags = localTags;
    this.remoteTags = remoteTags;
    this.workingCopies = workingCopies;
    this.parentChangeIds = parentChangeIds;
    this.branchType = branchType;
    this.authorName = authorName;
    this.authorEmail = authorEmail;
    this.authorTimestamp = authorTimestamp;
    this.fullDescription = fullDescription;
    this.filesChanged = filesChanged;
    this.linesAdded = linesAdded;
    this.linesRemoved = linesRemoved;
    this.mine = mine;
    this.conflict = conflict;
    this.elided = elided;
  }
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
    this.panel.title = `Source Control Graph (${path.basename(this.repository.repositoryRoot)})`;

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
            vscode.window.showErrorMessage(`Failed to switch to change: ${error as string}`);
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
            vscode.window.showErrorMessage(`Failed to switch to change: ${error as string}`);
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
              vscode.window.showErrorMessage(`Failed to move bookmark: ${error as string}`);
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
            vscode.window.showErrorMessage(`Failed to create bookmark: ${error as string}`);
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
            vscode.window.showErrorMessage(`Failed to create tag: ${error as string}`);
          }
          break;
        case "deleteBookmark":
          try {
            await this.repository.deleteBookmark(message.bookmark);
            await this.refresh();
          } catch (error: unknown) {
            vscode.window.showErrorMessage(`Failed to delete bookmark: ${error as string}`);
          }
          break;
        case "deleteTag":
          try {
            await this.repository.deleteTag(message.tag);
            await this.refresh();
          } catch (error: unknown) {
            vscode.window.showErrorMessage(`Failed to delete tag: ${error as string}`);
          }
          break;
        case "describeChange":
          try {
            await this.repository.describeRetryImmutable(message.changeId);
            await this.refresh();
          } catch (error: unknown) {
            vscode.window.showErrorMessage(`Failed to describe change: ${error as string}`);
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
            vscode.window.showErrorMessage(`Failed to abandon change: ${error as string}`);
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
            vscode.window.showErrorMessage(`Failed to rebase: ${error as string}`);
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
            vscode.window.showErrorMessage(`Failed to rebase: ${error as string}`);
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
            vscode.window.showErrorMessage(`Failed to rebase: ${error as string}`);
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
            vscode.window.showErrorMessage(`Failed to squash: ${error as string}`);
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
            vscode.window.showErrorMessage(`Failed to duplicate: ${error as string}`);
          }
          break;
        case "updateStale":
          try {
            await this.repository.updateStale();
            await this.refresh();
          } catch (error: unknown) {
            vscode.window.showErrorMessage(`Failed to update stale working copy: ${error as string}`);
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
      this.panel.title = `Source Control Graph (${path.basename(this.repository.repositoryRoot)})`;
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

      return new ChangeNode(
        entryUniqueId,
        "",
        "",
        null,
        "",
        "",
        "",
        false,
        [],
        [],
        [],
        [],
        [],
        uniqueParentIds,
        "~",
        "",
        "",
        "",
        "",
        0,
        0,
        0,
        false,
        false,
      );
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

    return new ChangeNode(
      uniqueChangeId,
      changeIdShortest,
      changeIdSuffix,
      changeOffset,
      formattedLine,
      formattedDescription,
      entry.change_id,
      entry.current_working_copy,
      entry.local_bookmarks.sort((a, b) => a.name.localeCompare(b.name)),
      entry.remote_bookmarks.sort((a, b) => a.name.localeCompare(b.name)),
      entry.local_tags.sort((a, b) => a.name.localeCompare(b.name)),
      entry.remote_tags.sort((a, b) => a.name.localeCompare(b.name)),
      entry.working_copies.sort(),
      uniqueParentIds,
      branchType,
      entry.author.name,
      entry.author.email,
      entry.author.timestamp,
      entry.description,
      filesChanged,
      linesAdded,
      linesRemoved,
      entry.mine,
      entry.conflict,
    );
  });

  const hasConflict = entries.some((e) => e.conflict);
  if (hasConflict) {
    maxPrefixLength += 2;
  }

  return { changes, maxPrefixLength, offsetWidth };
}
