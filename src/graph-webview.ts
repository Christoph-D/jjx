import * as vscode from "vscode";
import * as fs from "fs";
import type { JJRepository, LogEntry, ParentRef } from "./repository";
import { BookmarkBackwardsError, StaleWorkingCopyError } from "./errors";
import path from "path";
import { formatDiffTitle, formatRevSuffix, showErrorMessage } from "./utils";
import { assignLanes } from "./lane-assigner";
import type { ChangeNode, WebviewToExtensionMessage, ExtensionToWebviewMessage } from "./graph-protocol";
import { classifyEdges, insertSyntheticNodes, getUniqueEntryId } from "./elided-edges";
import { logger } from "./logger";
import { getLogRevset, getElidedVisibleImmutableParents } from "./config";
import { DEFAULT_LOG_LIMIT } from "./constants";
import { toJJUri } from "./uri";

const rootChangeId = "z".repeat(32);

type Message = WebviewToExtensionMessage;

export class JJGraphWebview implements vscode.WebviewViewProvider {
  subscriptions: {
    dispose(): unknown;
  }[] = [];

  public panel?: vscode.WebviewView;
  public repository: JJRepository | undefined;
  public selectedNodes: Set<string> = new Set();
  private currentChanges: ChangeNode[] = [];
  private elideOverride: boolean | null = null;

  private _onDidChangeSelection = new vscode.EventEmitter<string[]>();
  readonly onDidChangeSelection: vscode.Event<string[]> = this._onDidChangeSelection.event;

  constructor(
    private readonly extensionUri: vscode.Uri,
    repo: JJRepository | undefined,
    private readonly context: vscode.ExtensionContext,
    private readonly jjBinaryNotFound: boolean,
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
    this.panel.title = this.repository ? `JJ Graph (${path.basename(this.repository.repositoryRoot)})` : "JJ Graph";

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

    if (!this.repository) {
      const msg: ExtensionToWebviewMessage = this.jjBinaryNotFound
        ? { command: "showJJNotFoundState" }
        : { command: "showNoRepoFoundState" };
      webviewView.webview.postMessage(msg);
    }

    webviewView.webview.onDidReceiveMessage(async (message: Message) => {
      if (!this.repository && message.command !== "selectChange" && message.command !== "reportError") {
        return;
      }
      const repo = this.repository!;
      switch (message.command) {
        case "editChange":
          try {
            const config = vscode.workspace.getConfiguration("jjx");
            const changeDoubleClickAction = config.get<string>("changeDoubleClickAction") || "edit";
            if (changeDoubleClickAction === "new") {
              await repo.new(undefined, [message.changeId]);
            } else {
              if (message.changeId === rootChangeId) {
                return;
              }
              await repo.editRetryImmutable(message.changeId);
            }
          } catch (error: unknown) {
            showErrorMessage("Failed to switch to change", error);
          }
          break;
        case "editChangeDirect":
          try {
            if (message.changeId === rootChangeId) {
              return;
            }
            const status = await repo.getStatus(true);
            if (message.changeId === status.workingCopy.changeId) {
              return;
            }
            await repo.editRetryImmutable(message.changeId);
          } catch (error: unknown) {
            showErrorMessage("Failed to switch to change", error);
          }
          break;
        case "newChildChange":
          await this.withRefresh("create new child change", () => repo.new(undefined, [message.changeId]));
          break;
        case "selectChange":
          this.selectedNodes = new Set(message.selectedNodes);
          vscode.commands.executeCommand("setContext", "jjGraphView.nodesSelected", message.selectedNodes.length);
          this._onDidChangeSelection.fire(message.selectedNodes);
          break;
        case "moveBookmark":
          try {
            await repo.moveBookmark(message.bookmark, message.targetChangeId);
            await this.refresh();
          } catch (error: unknown) {
            if (error instanceof BookmarkBackwardsError) {
              const choice = await vscode.window.showQuickPick(["Continue"], {
                title: "Moving bookmark backwards or sideways, are you sure?",
              });
              if (choice) {
                try {
                  await repo.moveBookmark(message.bookmark, message.targetChangeId, true);
                  await this.refresh();
                } catch (retryError: unknown) {
                  showErrorMessage("Failed to move bookmark", retryError);
                }
              }
            } else {
              showErrorMessage("Failed to move bookmark", error);
            }
          }
          break;
        case "createBookmark": {
          const bookmarkName = await vscode.window.showInputBox({
            prompt: "Enter Bookmark Name",
            placeHolder: "bookmark-name",
          });
          if (bookmarkName === undefined || bookmarkName === "") {
            break;
          }
          await this.withRefresh("create bookmark", () => repo.createBookmark(bookmarkName, message.targetChangeId));
          break;
        }
        case "createTag": {
          const tagName = await vscode.window.showInputBox({
            prompt: "Enter Tag Name",
            placeHolder: "v1.0.0",
          });
          if (tagName === undefined || tagName === "") {
            break;
          }
          await this.withRefresh("create tag", () => repo.createTag(tagName, message.targetChangeId));
          break;
        }
        case "pushBookmark":
          try {
            const pushedRemotes = await repo.pushBookmark(message.bookmark);
            if (pushedRemotes.length === 0) {
              vscode.window.showInformationMessage(
                `Bookmark "${message.bookmark}" has no out-of-sync tracked remotes.`,
              );
            } else {
              await this.refresh();
            }
          } catch (error: unknown) {
            showErrorMessage("Failed to push bookmark", error);
          } finally {
            this.panel?.webview.postMessage({ command: "pushBookmarkDone", bookmark: message.bookmark });
          }
          break;
        case "getBookmarkTrackingRemotes":
          try {
            const info = await repo.getBookmarkTrackingInfo(message.bookmark);
            this.panel?.webview.postMessage({
              command: "bookmarkTrackingRemotesResponse",
              bookmark: message.bookmark,
              remotes: info.trackedRemotes,
              unsyncedRemotes: info.unsyncedTrackedRemotes,
              untrackedRemotes: info.untrackedRemotes,
            });
          } catch (error: unknown) {
            showErrorMessage("Failed to get bookmark tracking remotes", error);
            this.panel?.webview.postMessage({
              command: "bookmarkTrackingRemotesResponse",
              bookmark: message.bookmark,
              remotes: [],
              unsyncedRemotes: [],
              untrackedRemotes: [],
            });
          }
          break;
        case "pushBookmarkToRemote":
          await this.withRefresh("push bookmark", () => repo.pushBookmarkToRemote(message.bookmark, message.remote));
          break;
        case "trackBookmark":
          await this.withRefresh("track bookmark", () => repo.trackBookmark(message.bookmark, message.remote));
          break;
        case "untrackBookmark":
          await this.withRefresh("untrack bookmark", () => repo.untrackBookmark(message.bookmark, message.remote));
          break;
        case "deleteBookmark":
          await this.confirmAndExecute(
            `Are you sure you want to delete the bookmark "${message.bookmark}"?`,
            "Delete",
            "delete bookmark",
            () => repo.deleteBookmark(message.bookmark),
          );
          break;
        case "deleteTag":
          await this.confirmAndExecute(
            `Are you sure you want to delete the tag "${message.tag}"?`,
            "Delete",
            "delete tag",
            () => repo.deleteTag(message.tag),
          );
          break;
        case "getTagPushRemotes":
          try {
            const allRemotes = await repo.getRemotes();
            const tagRemotes = new Set<string>();
            for (const change of this.currentChanges) {
              for (const rt of change.remoteTags) {
                if (rt.name === message.tag) {
                  tagRemotes.add(rt.remote);
                }
              }
            }
            const pushRemotes = allRemotes.filter((r) => !tagRemotes.has(r));
            this.panel?.webview.postMessage({
              command: "tagPushRemotesResponse",
              tag: message.tag,
              pushRemotes,
            });
          } catch (error: unknown) {
            showErrorMessage("Failed to get tag push remotes", error);
            this.panel?.webview.postMessage({
              command: "tagPushRemotesResponse",
              tag: message.tag,
              pushRemotes: [],
            });
          }
          break;
        case "pushTagToRemote":
          await this.withRefresh("push tag", () => repo.pushTagToRemote(message.tag, message.remote));
          break;
        case "describeChange":
          await this.withRefresh("describe change", () => repo.describeRetryImmutable(message.changeId));
          break;
        case "absorbChange":
          await this.withRefresh("absorb change", async () => {
            const absorbResult = await repo.absorb(message.changeId);
            if (absorbResult.stderr.toString().includes("Nothing changed.")) {
              vscode.window.showInformationMessage("Absorb: Nothing changed.");
            }
          });
          break;
        case "abandonChange": {
          const change = this.currentChanges.find((c) => c.changeId === message.changeId);
          const firstLine = change?.fullDescription.split("\n")[0].trim() || "(no description set)";
          const truncated = firstLine.length > 120 ? firstLine.slice(0, 120) + "..." : firstLine;
          const prompt = change
            ? `Are you sure you want to abandon change "${change.changeIdPrefix}"?\n\n→ ${truncated}`
            : "Are you sure you want to abandon this change?";
          await this.confirmAndExecute(prompt, "Abandon", "abandon change", () =>
            repo.abandonRetryImmutable([message.changeId]),
          );
          break;
        }
        case "abandonChanges":
          await this.confirmAndExecute(
            `Are you sure you want to abandon ${message.changeIds.length} changes?`,
            "Abandon",
            "abandon changes",
            () =>
              repo.abandonRetryImmutable(
                message.changeIds,
                "Some of the selected changes are immutable, are you sure?",
              ),
          );
          break;
        case "copyUrl":
          try {
            const url = await repo.getCommitUrl(message.changeId);
            if (url) {
              await vscode.env.clipboard.writeText(url);
            } else {
              vscode.window.showWarningMessage("No web remote configured for this repository.");
            }
          } catch (error: unknown) {
            showErrorMessage("Failed to get commit URL", error);
          }
          break;
        case "rebaseOnto":
        case "rebaseAfter":
        case "rebaseBefore": {
          const mode = message.command.replace("rebase", "").toLowerCase() as "onto" | "after" | "before";
          await this.withRefresh("rebase", () =>
            repo.rebaseRetryImmutable(message.changeId, message.targetChangeId, mode, message.withDescendants),
          );
          break;
        }
        case "rebaseAddParent":
          await this.withRefresh("rebase", () =>
            repo.rebaseAddParentRetryImmutable(message.changeId, message.targetChangeId),
          );
          break;
        case "rebaseRemoveParent":
          await this.withRefresh("rebase", () =>
            repo.rebaseRemoveParentRetryImmutable(message.changeId, message.targetChangeId),
          );
          break;
        case "squashInto":
          await this.withRefresh("squash", () =>
            repo.squashRetryImmutable({ fromRev: message.changeId, toRev: message.targetChangeId }),
          );
          break;
        case "duplicateOnto":
        case "duplicateAfter":
        case "duplicateBefore": {
          const mode = message.command.replace("duplicate", "").toLowerCase() as "onto" | "after" | "before";
          await this.withRefresh("duplicate", () => repo.duplicate(message.changeId, message.targetChangeId, mode));
          break;
        }
        case "revertOnto":
        case "revertAfter":
        case "revertBefore": {
          const mode = message.command.replace("revert", "").toLowerCase() as "onto" | "after" | "before";
          await this.withRefresh("revert", () => repo.revert(message.changeId, message.targetChangeId, mode));
          break;
        }
        case "updateStale":
          await this.withRefresh("update stale working copy", () => repo.updateStale());
          break;
        case "fetchDiffStats":
          try {
            const stats = await repo.getDiffStats(message.changeId);
            const response: ExtensionToWebviewMessage = {
              command: "diffStatsResponse",
              changeId: message.changeId,
              stats,
            };
            this.panel?.webview.postMessage(response);
          } catch {
            // Silently ignore - tooltip simply won't show diff stats
          }
          break;
        case "openFileDiff": {
          const { changeId, path: relPath, status, renamedFrom } = message;
          const absPath = path.join(repo.repositoryRoot, relPath);
          const fileUri = vscode.Uri.file(absPath);

          let beforeParams: Parameters<typeof toJJUri>[1];
          let afterParams: Parameters<typeof toJJUri>[1];
          if (status === "A") {
            beforeParams = { deleted: true };
            afterParams = { rev: changeId };
          } else if (status === "D") {
            beforeParams = { diffOriginalRev: changeId };
            afterParams = { deleted: true };
          } else if (status === "R" || status === "C") {
            beforeParams = renamedFrom ? { diffOriginalRev: changeId, renamedFrom } : { diffOriginalRev: changeId };
            afterParams = { rev: changeId };
          } else {
            beforeParams = { diffOriginalRev: changeId };
            afterParams = { rev: changeId };
          }
          const beforeUri = toJJUri(fileUri, beforeParams);
          const afterUri = toJJUri(fileUri, afterParams);
          const diffTitleSuffix = formatRevSuffix(changeId);
          const title = formatDiffTitle(renamedFrom, path.basename(relPath), diffTitleSuffix);
          try {
            await vscode.commands.executeCommand("vscode.diff", beforeUri, afterUri, title);
          } catch (error: unknown) {
            showErrorMessage("Failed to open diff", error);
          }
          break;
        }
        case "reportError":
          logger.error(`Webview error: ${message.message}${message.stack ? `\n${message.stack}` : ""}`);
          break;
      }
    });

    await this.updateElidingContext();
    await this.refresh();
  }

  public async setSelectedRepository(repo: JJRepository) {
    const prevRoot = this.repository?.repositoryRoot;
    this.repository = repo;
    if (this.panel) {
      this.panel.title = `JJ Graph (${path.basename(this.repository.repositoryRoot)})`;
    }
    if (prevRoot !== repo.repositoryRoot) {
      await this.refresh();
    }
  }

  private async withRefresh(errorLabel: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
      await this.refresh();
    } catch (error: unknown) {
      showErrorMessage(`Failed to ${errorLabel}`, error);
    }
  }

  private async confirmAndExecute(
    prompt: string,
    confirmLabel: string,
    errorLabel: string,
    fn: () => Promise<unknown>,
  ): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(prompt, { modal: true }, confirmLabel);
    if (confirm !== confirmLabel) {
      return;
    }
    await this.withRefresh(errorLabel, fn);
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

  public async refresh(providedOperationId?: string) {
    if (!this.panel || !this.repository) {
      return;
    }

    try {
      const operationId = providedOperationId ?? (await this.repository.getLatestOperationId(false));
      this.repository.resetAutoUpdateStaleAttempted();
      const config = vscode.workspace.getConfiguration("jjx");
      const graphStyle = config.get<string>("graphStyle") || "full";

      const logLimit = config.get<number>("logLimit") ?? DEFAULT_LOG_LIMIT;
      const showChangedFiles = config.get<boolean>("showChangedFiles") ?? false;
      const logStart = performance.now();
      const rawEntries = await this.repository.log(
        getLogRevset(),
        logLimit,
        {
          includeFiles: showChangedFiles,
        },
        operationId,
      );
      const logDuration = performance.now() - logStart;
      logger.info(`jj log took ${logDuration.toFixed(1)}ms`);
      const elideImmutableCommits = this.getEffectiveEliding();
      const { edges, visibleIds, reachableVisibleFrom } = classifyEdges(rawEntries, {
        elideImmutableCommits,
        elidedVisibleImmutableParents: getElidedVisibleImmutableParents(this.repository.repositoryRoot),
      });
      const entriesWithSynthetics = insertSyntheticNodes(rawEntries, edges, visibleIds, reachableVisibleFrom);
      const { changes, maxPrefixLength, offsetWidth } = parseJJLogJson(
        entriesWithSynthetics,
        graphStyle,
        this.repository.repositoryRoot,
      );
      this.currentChanges = changes;

      const unsyncedBookmarks = new Set<string>();
      for (const change of changes) {
        for (const b of change.localBookmarks) {
          if (!b.synced && !b.conflict) {
            unsyncedBookmarks.add(b.name);
          }
        }
      }
      if (unsyncedBookmarks.size > 0) {
        const bookmarksWithPushTargets = await this.repository.getBookmarksWithUnsyncedNonGitRemotes(operationId);
        for (const change of changes) {
          for (const b of change.localBookmarks) {
            if (!b.synced && !b.conflict) {
              b.showPushButton = bookmarksWithPushTargets.has(b.name);
            }
          }
        }
      }

      const changeIdsInGraph = new Set(changes.map((c) => c.changeId));
      const previousSelectedNodes = this.selectedNodes;
      this.selectedNodes = new Set(Array.from(previousSelectedNodes).filter((id) => changeIdsInGraph.has(id)));
      // If any selected changes were removed (e.g. abandoned), notify listeners so the
      // SCM view can clear its stale sections.
      if (this.selectedNodes.size !== previousSelectedNodes.size) {
        this._onDidChangeSelection.fire(Array.from(this.selectedNodes));
      }
      const changeDoubleClickAction = config.get<string>("changeDoubleClickAction") || "edit";

      const laneInfo = assignLanes(entriesWithSynthetics);

      const msg: ExtensionToWebviewMessage = {
        command: "updateGraph",
        changes: changes,
        laneInfo,
        changeDoubleClickAction,
        graphStyle,
        maxPrefixLength,
        offsetWidth,
        preserveScroll: true,
        showTooltips: config.get<boolean>("showTooltips") ?? true,
        showChangedFiles,
      };
      this.panel.webview.postMessage(msg);
      try {
        await this.repository.getStatus(false, undefined, operationId);
      } catch {
        // best effort — don't let cache update failure affect the graph
      }
    } catch (error) {
      if (error instanceof StaleWorkingCopyError) {
        const didAutoUpdate = await this.repository.tryAutoUpdateStale();
        if (didAutoUpdate) {
          await this.refresh();
          return;
        }
        const msg: ExtensionToWebviewMessage = {
          command: "showStaleState",
        };
        this.panel.webview.postMessage(msg);
        return;
      }
      logger.error(`Failed to refresh graph: ${error instanceof Error ? error.message : String(error)}`);
      this.panel.webview.postMessage({ command: "showErrorState" });
    }
  }

  private getWebviewContent(webview: vscode.Webview) {
    const cssPath = vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "graph.css");
    const cssUri = webview.asWebviewUri(cssPath);

    const codiconPath = vscode.Uri.joinPath(this.extensionUri, "dist", "codicons", "codicon.css");
    const codiconUri = webview.asWebviewUri(codiconPath);

    const graphJsPath = vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "graph.js");
    const graphJsUri = webview.asWebviewUri(graphJsPath);

    const htmlPath = vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "graph.html");
    let html = fs.readFileSync(htmlPath.fsPath, "utf8");

    // Replace placeholders in the HTML
    html = html.replace("${cssUri}", cssUri.toString());
    html = html.replace("${codiconUri}", codiconUri.toString());
    html = html.replace("${graphJsUri}", graphJsUri.toString());

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

function parseJJLogJson(
  entries: LogEntry[],
  style: string = "full",
  repositoryRoot?: string,
): { changes: ChangeNode[]; maxPrefixLength: number; offsetWidth: number } {
  const nonSyntheticEntries = entries.filter((e) => !getUniqueEntryId(e).startsWith("~"));

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
    if (entryUniqueId.startsWith("~") || entry.change_id.startsWith("~")) {
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
        mine: false,
        conflict: false,
        isEmpty: true,
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

    const uniqueParentIds = entry.parents.map((p: ParentRef) =>
      p.change_offset ? `${p.change_id}/${p.change_offset}` : p.change_id,
    );

    const changedFiles =
      repositoryRoot !== undefined && entry.fileStatuses
        ? entry.fileStatuses.map((f) => ({
            type: f.type,
            path: path.relative(repositoryRoot, f.path).replace(/\\/g, "/"),
            ...(f.renamedFrom ? { renamedFrom: f.renamedFrom.replace(/\\/g, "/") } : {}),
            conflict: f.type === "X",
          }))
        : undefined;

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
      mine: entry.mine,
      conflict: entry.conflict,
      isEmpty: entry.empty,
      ...(changedFiles ? { changedFiles } : {}),
    };
  });

  const hasConflict = entries.some((e) => e.conflict);
  if (hasConflict) {
    maxPrefixLength += 2;
  }

  return { changes, maxPrefixLength, offsetWidth };
}
