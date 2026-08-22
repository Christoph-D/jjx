import * as vscode from "vscode";
import * as fs from "fs";
import type { JJRepository, LogEntry, ParentRef } from "./repository";
import { BookmarkBackwardsError, StaleWorkingCopyError } from "./errors";
import { CancelledError } from "./process";
import path from "path";
import { showErrorMessage } from "./vscode-utils";
import {
  changeIdAffixes,
  formatChangeIdShort,
  formatDiffTitle,
  formatWorkingCopyTitle,
  fullChangeId,
  maxChangeIdPrefixLength,
  shouldOpenWorkingCopyRightSide,
  toForwardSlashes,
} from "./utils";
import type { ChangeId, FullChangeId, RealPath } from "./types";
import { assignLanes } from "./lane-assigner";
import {
  getUniqueId,
  type ChangeNode,
  type RegularChangeNode,
  type WebviewToExtensionMessage,
  type ExtensionToWebviewMessage,
} from "./graph-protocol";
import { classifyEdges, insertSyntheticNodes, getUniqueEntryId } from "./elided-edges";
import { logger } from "./logger";
import { getLogRevset, getElidedVisibleImmutableParents } from "./config";
import { DEFAULT_LOG_LIMIT } from "./constants";
import { SplitWebview } from "./split-webview";
import { toJJUri } from "./uri";
import { joinRepositoryPath, repositoryRelativePath, toWorkspaceUri } from "./workspace-paths";

const rootChangeId = "z".repeat(32);

export interface GraphSelection {
  id: ChangeId;
  currentWorkingCopy: boolean;
}

type Message = WebviewToExtensionMessage;

export class JJGraphWebview implements vscode.WebviewViewProvider {
  subscriptions: {
    dispose(): unknown;
  }[] = [];

  public panel?: vscode.WebviewView;
  public repository: JJRepository | undefined;
  public selectedNodes: Set<FullChangeId> = new Set();
  private currentChanges: ChangeNode[] = [];
  private elideOverride: boolean | null = null;
  private readonly splitWebview: SplitWebview;

  private _onDidChangeSelection = new vscode.EventEmitter<GraphSelection[]>();
  readonly onDidChangeSelection: vscode.Event<GraphSelection[]> = this._onDidChangeSelection.event;

  constructor(
    private readonly extensionUri: vscode.Uri,
    repo: JJRepository | undefined,
    private readonly context: vscode.ExtensionContext,
    private readonly jjBinaryNotFound: boolean,
  ) {
    this.repository = repo;
    this.splitWebview = new SplitWebview(extensionUri);

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
      this.postMessageToWebview(msg);
    }

    webviewView.webview.onDidReceiveMessage(async (message: Message) => {
      if (
        !this.repository &&
        message.command !== "selectChange" &&
        message.command !== "reportError" &&
        message.command !== "showWarning"
      ) {
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
            if (message.changeId === status.workingCopy.changeId.changeId) {
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
        case "selectChange": {
          // Elided ("~") nodes can never be selected.
          const selectedIds = message.selectedNodes.filter((id) => this.findRegularChange(id));
          this.selectedNodes = new Set(selectedIds);
          vscode.commands.executeCommand("setContext", "jjGraphView.nodesSelected", selectedIds.length);
          this._onDidChangeSelection.fire(this.resolveSelection(selectedIds));
          break;
        }
        case "moveBookmark":
          try {
            await repo.moveBookmark(message.bookmark, message.targetChangeId);
            await this.refresh();
          } catch (error: unknown) {
            if (error instanceof BookmarkBackwardsError) {
              const choice = await vscode.window.showWarningMessage(
                "Moving bookmark backwards or sideways, are you sure?",
                { modal: true },
                "Move Bookmark",
              );
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
            if (!(error instanceof CancelledError)) {
              showErrorMessage("Failed to push bookmark", error);
            }
          } finally {
            this.postMessageToWebview({ command: "pushBookmarkDone", bookmark: message.bookmark });
          }
          break;
        case "getBookmarkTrackingRemotes":
          try {
            const info = await repo.getBookmarkTrackingInfo(message.bookmark);
            this.postMessageToWebview({
              command: "bookmarkTrackingRemotesResponse",
              bookmark: message.bookmark,
              remotes: info.trackedRemotes,
              unsyncedRemotes: info.unsyncedTrackedRemotes,
              untrackedRemotes: info.untrackedRemotes,
            });
          } catch (error: unknown) {
            showErrorMessage("Failed to get bookmark tracking remotes", error);
            this.postMessageToWebview({
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
          this.postMessageToWebview({ command: "pushBookmarkDone", bookmark: message.bookmark });
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
            "Delete Bookmark",
            "delete bookmark",
            () => repo.deleteBookmark(message.bookmark),
          );
          break;
        case "deleteTag":
          await this.confirmAndExecute(
            `Are you sure you want to delete the tag "${message.tag}"?`,
            "Delete Tag",
            "delete tag",
            () => repo.deleteTag(message.tag),
          );
          break;
        case "forgetWorkspace":
          if (await this.isCurrentWorkspace(repo, message.workspace)) {
            break;
          }
          await this.confirmAndExecute(
            `Are you sure you want to forget the workspace "${message.workspace}"?`,
            "Forget Workspace",
            "forget workspace",
            () => repo.forgetWorkspace(message.workspace),
          );
          break;
        case "forgetAndDeleteWorkspace": {
          if (await this.isCurrentWorkspace(repo, message.workspace)) {
            break;
          }
          let workspaceRoot: string | undefined;
          try {
            workspaceRoot = await repo.getWorkspaceRoot(message.workspace);
          } catch (error: unknown) {
            showErrorMessage(`Failed to look up workspace "${message.workspace}"`, error);
            break;
          }
          if (!workspaceRoot) {
            // Degrade gracefully: forget the workspace without deleting its
            // directory instead of aborting entirely.
            await this.confirmAndExecute(
              `The root path of workspace "${message.workspace}" could not be determined, so its directory cannot be deleted.\n\nForget the workspace without deleting its directory?`,
              "Forget Workspace",
              "forget workspace",
              () => repo.forgetWorkspace(message.workspace),
            );
            break;
          }
          const root = workspaceRoot;
          await this.confirmAndExecute(
            `Are you sure you want to forget the workspace "${message.workspace}" and delete its directory "${root}"?\n\n` +
              `The directory will be deleted, but all jj-recorded changes will be kept.`,
            "Forget and Delete",
            "forget and delete workspace",
            async () => {
              await repo.forgetWorkspace(message.workspace);
              await vscode.workspace.fs.delete(toWorkspaceUri(root), { useTrash: false, recursive: true });
            },
          );
          break;
        }
        case "copyWorkspacePath":
          try {
            const workspaceRoot = await repo.getWorkspaceRoot(message.workspace);
            if (!workspaceRoot) {
              vscode.window.showWarningMessage(
                `The root path of workspace "${message.workspace}" could not be determined.`,
              );
              break;
            }
            await vscode.env.clipboard.writeText(workspaceRoot);
          } catch (error: unknown) {
            showErrorMessage("Failed to copy workspace path", error);
          }
          break;
        case "getTagPushRemotes":
          try {
            const allRemotes = await repo.getRemotes();
            const tagRemotes = new Set<string>();
            for (const change of this.currentChanges) {
              if (change.branchType === "~") {
                continue;
              }
              for (const rt of change.remoteTags) {
                if (rt.name === message.tag) {
                  tagRemotes.add(rt.remote);
                }
              }
            }
            const pushRemotes = allRemotes.filter((r) => !tagRemotes.has(r));
            this.postMessageToWebview({
              command: "tagPushRemotesResponse",
              tag: message.tag,
              pushRemotes,
            });
          } catch (error: unknown) {
            showErrorMessage("Failed to get tag push remotes", error);
            this.postMessageToWebview({
              command: "tagPushRemotesResponse",
              tag: message.tag,
              pushRemotes: [],
            });
          }
          break;
        case "cancelRemoteRefOperation": {
          const operation = repo.cancelRefOperation(message.refType, message.name);
          if (operation) {
            const kind = message.refType === "bookmark" ? "bookmark" : "tag";
            const noun = operation === "push" ? "push" : "deletion";
            vscode.window.showErrorMessage(
              `Cancelled ${noun} of ${kind} "${message.name}". The ${noun} may already have succeeded. Please fetch from the remote to reconcile the state.`,
            );
          }
          break;
        }
        case "pushTagToRemote":
          await this.withRefresh("push tag", () => repo.pushTagToRemote(message.tag, message.remote));
          this.postMessageToWebview({ command: "pushTagDone", tag: message.tag });
          break;
        case "pushTag":
          try {
            const pushedRemotes = await repo.pushTag(message.tag);
            if (pushedRemotes.length === 0) {
              vscode.window.showInformationMessage(`Tag "${message.tag}" has no out-of-sync tracked remotes.`);
            } else {
              await this.refresh();
            }
          } catch (error: unknown) {
            if (!(error instanceof CancelledError)) {
              showErrorMessage("Failed to push tag", error);
            }
          } finally {
            this.postMessageToWebview({ command: "pushTagDone", tag: message.tag });
          }
          break;
        case "getTagTrackingRemotes":
          try {
            const info = await repo.getTagTrackingInfo(message.tag);
            this.postMessageToWebview({
              command: "tagTrackingRemotesResponse",
              tag: message.tag,
              remotes: info.pushRemotes,
            });
          } catch (error: unknown) {
            showErrorMessage("Failed to get tag tracking remotes", error);
            this.postMessageToWebview({
              command: "tagTrackingRemotesResponse",
              tag: message.tag,
              remotes: [],
            });
          }
          break;
        case "trackTag":
          await this.withRefresh("track tag", () => repo.trackTag(message.tag, message.remote));
          break;
        case "untrackTag":
          await this.withRefresh("untrack tag", () => repo.untrackTag(message.tag, message.remote));
          break;
        case "getRemoteRefStatus":
          try {
            const status = await repo.getRemoteRefStatus(message.refType, message.name, message.remote);
            this.postMessageToWebview({
              command: "remoteRefStatusResponse",
              refType: message.refType,
              name: message.name,
              remote: message.remote,
              found: status !== null,
              tracked: status?.tracked ?? false,
              synced: status?.synced ?? false,
              present: status?.present ?? false,
            });
          } catch (error: unknown) {
            showErrorMessage("Failed to get remote ref status", error);
            this.postMessageToWebview({
              command: "remoteRefStatusResponse",
              refType: message.refType,
              name: message.name,
              remote: message.remote,
              found: false,
              tracked: false,
              synced: false,
              present: false,
            });
          }
          break;
        case "pushRemoteRef":
          await this.withRefresh("push ref", () =>
            message.refType === "bookmark"
              ? repo.pushBookmarkToRemote(message.name, message.remote)
              : repo.pushTagToRemote(message.name, message.remote),
          );
          if (message.refType === "bookmark") {
            this.postMessageToWebview({ command: "pushBookmarkDone", bookmark: message.name });
          } else {
            this.postMessageToWebview({ command: "pushTagDone", tag: message.name });
          }
          break;
        case "deleteRemoteRef": {
          const refKind = message.refType === "bookmark" ? "bookmark" : "tag";
          try {
            await this.confirmAndExecute(
              `Are you sure you want to delete the ${refKind} "${message.name}" from "${message.remote}"?\n\n!!! This deletes the ${refKind} from the remote !!!`,
              `Delete from ${message.remote}`,
              `delete ${refKind} from remote`,
              () =>
                message.refType === "bookmark"
                  ? repo.deleteBookmarkFromRemote(message.name, message.remote)
                  : repo.deleteTagFromRemote(message.name, message.remote),
            );
          } finally {
            this.postMessageToWebview({
              command: "deleteRemoteRefDone",
              refType: message.refType,
              name: message.name,
            });
          }
          break;
        }
        case "restoreRemoteRef":
          await this.withRefresh("restore ref", () =>
            repo.restoreRemoteRef(message.refType, message.name, message.remote),
          );
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
        case "splitChange": {
          const change = this.findRegularChange(message.changeId);
          if (!change) {
            break;
          }
          await this.withRefresh("split change", async () => {
            const state = await this.splitWebview.selectChanges(repo, change.commitId);
            if (!state) {
              return;
            }
            await repo.splitChangeRetryImmutable({ commitId: change.commitId, state });
          });
          break;
        }
        case "abandonChange": {
          const change = this.findRegularChange(message.changeId);
          const fullDescription = change ? change.fullDescription : "";
          const firstLine = fullDescription.split("\n")[0].trim() || "(no description set)";
          const truncated = firstLine.length > 120 ? firstLine.slice(0, 120) + "..." : firstLine;
          const prompt = change
            ? `Are you sure you want to abandon change "${formatChangeIdShort(change.id)}"?\n\n→ ${truncated}`
            : "Are you sure you want to abandon this change?";
          await this.confirmAndExecute(prompt, "Abandon", "abandon change", () =>
            repo.abandonRetryImmutable(message.changeId),
          );
          break;
        }
        case "abandonChanges":
          await this.confirmAndExecute(
            `Are you sure you want to abandon ${message.changeIds.length} changes?`,
            "Abandon",
            "abandon changes",
            () =>
              repo.abandonRetryImmutableMultiple(
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
            repo.rebaseRetryImmutable(message.changeIds, message.targetChangeId, mode, message.withDescendants),
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
            repo.squashRetryImmutable({ fromRevs: message.changeIds, toRev: message.targetChangeId }),
          );
          break;
        case "duplicateOnto":
        case "duplicateAfter":
        case "duplicateBefore": {
          const mode = message.command.replace("duplicate", "").toLowerCase() as "onto" | "after" | "before";
          await this.withRefresh("duplicate", () =>
            repo.duplicateRetryImmutable(message.changeIds, message.targetChangeId, mode),
          );
          break;
        }
        case "revertOnto":
        case "revertAfter":
        case "revertBefore": {
          const mode = message.command.replace("revert", "").toLowerCase() as "onto" | "after" | "before";
          await this.withRefresh("revert", () =>
            repo.revertRetryImmutable(message.changeIds, message.targetChangeId, mode),
          );
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
            this.postMessageToWebview(response);
          } catch {
            // Silently ignore - tooltip simply won't show diff stats
          }
          break;
        case "openFileDiff": {
          const { changeId, path: relPath, status, renamedFrom } = message;
          const absPath = joinRepositoryPath(repo.repositoryRoot, relPath);
          const fileUri = toWorkspaceUri(absPath);

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
          try {
            const node = this.findRegularChange(changeId);
            const toRev = node ? formatChangeIdShort(node.id) : await repo.resolveRevSuffix(changeId);
            const useWorkingCopyRight = shouldOpenWorkingCopyRightSide(
              changeId,
              status,
              await repo.isFileUnchangedInWorkingCopy(changeId, absPath),
            );
            const afterUri = useWorkingCopyRight ? fileUri : toJJUri(fileUri, afterParams);
            const title = useWorkingCopyRight
              ? formatDiffTitle(renamedFrom, path.basename(relPath), `${toRev} Parent`, formatWorkingCopyTitle())
              : formatDiffTitle(renamedFrom, path.basename(relPath), undefined, toRev);
            await vscode.commands.executeCommand("vscode.diff", beforeUri, afterUri, title);
          } catch (error: unknown) {
            showErrorMessage("Failed to open diff", error);
          }
          break;
        }
        case "reportError":
          logger.error(`Webview error: ${message.message}${message.stack ? `\n${message.stack}` : ""}`);
          break;
        case "showWarning":
          vscode.window.showWarningMessage(message.message);
          break;
      }
    });

    await this.updateElidingContext();
    await this.refresh();
  }

  /**
   * Looks up a change node by its {@link FullChangeId}. Elided ("~") nodes only
   * carry a synthetic {@link ElidedChangeNode.fakeId} and are never keyed by a
   * real change ID, so a {@link FullChangeId} can only ever match a
   * {@link RegularChangeNode}.
   */
  private findRegularChange(changeId: FullChangeId): RegularChangeNode | undefined {
    return this.currentChanges.find((c): c is RegularChangeNode => c.branchType !== "~" && c.id.changeId === changeId);
  }

  /**
   * Returns the {@link ChangeId} (with precomputed UI affixes) for a change
   * currently loaded in the graph, so callers can format a title suffix without
   * spawning a jj process. Returns `undefined` if the graph is showing a
   * different repository or the change isn't among the loaded nodes; callers
   * should then fall back to {@link JJRepository.resolveRevSuffix}.
   */
  findChangeId(changeId: FullChangeId, repositoryRoot: string): ChangeId | undefined {
    if (this.repository?.repositoryRoot !== repositoryRoot) {
      return undefined;
    }
    return this.findRegularChange(changeId)?.id;
  }

  /**
   * Like {@link findChangeId}, but matches a loaded node by a change ID *prefix* (as jj emits
   * them in conflict markers) instead of a full change ID. The prefix only has to match the
   * change ID itself, not a possible `/offset` suffix of divergent changes. A commit ID prefix
   * (also emitted in conflict markers) must match the node's commit ID as well; it disambiguates
   * divergent changes that share the same change ID but differ in their `/offset` suffix.
   * Returns `undefined` if the graph is showing a different repository or no loaded node
   * matches; callers should then fall back to the raw prefix.
   */
  findChangeIdByPrefix(changeIdPrefix: string, commitIdPrefix: string, repositoryRoot: string): ChangeId | undefined {
    if (this.repository?.repositoryRoot !== repositoryRoot) {
      return undefined;
    }
    const node = this.currentChanges.find(
      (c): c is RegularChangeNode =>
        c.branchType !== "~" &&
        c.id.changeId.split("/")[0].startsWith(changeIdPrefix) &&
        c.commitId.startsWith(commitIdPrefix),
    );
    return node?.id;
  }

  /**
   * Like {@link findChangeIdByPrefix}, but matches by change ID prefix alone, ignoring the commit
   * ID prefix. Use as a fallback when the commit ID in the conflict markers is stale (e.g. after a
   * rewrite) and no longer matches a loaded node. Any `/offset` suffix is ignored too, so the
   * matched node may be at the wrong offset; callers should present the offset as unknown.
   */
  findChangeIdByChangeIdPrefix(changeIdPrefix: string, repositoryRoot: string): ChangeId | undefined {
    if (this.repository?.repositoryRoot !== repositoryRoot) {
      return undefined;
    }
    const node = this.currentChanges.find(
      (c): c is RegularChangeNode => c.branchType !== "~" && c.id.changeId.split("/")[0].startsWith(changeIdPrefix),
    );
    return node?.id;
  }

  /**
   * Maps selected change IDs to {@link GraphSelection} entries, attaching the
   * working-copy flag from the rendered graph nodes so listeners can detect the
   * working copy without comparing change IDs.
   */
  private resolveSelection(selectedIds: FullChangeId[]): GraphSelection[] {
    return selectedIds.flatMap((id) => {
      const node = this.findRegularChange(id);
      if (!node) {
        return [];
      }
      return { id: node.id, currentWorkingCopy: node.currentWorkingCopy };
    });
  }

  private postMessageToWebview(message: ExtensionToWebviewMessage): Thenable<boolean | undefined> | undefined {
    return this.panel?.webview.postMessage(message);
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
      // Cancellation is user-initiated. The cancel handler reports it,
      // so don't also surface a generic failure message.
      if (error instanceof CancelledError) {
        return;
      }
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

  /**
   * Guards destructive workspace actions: the workspace this graph operates on
   * cannot be forgotten (jj would only warn while leaving the working copy
   * unusable). Returns true (after showing a warning) when the named workspace
   * is the current one. A lookup failure doesn't block the action; the jj
   * invocation then reports the problem itself.
   */
  private async isCurrentWorkspace(repo: JJRepository, workspace: string): Promise<boolean> {
    let currentWorkspace: string | undefined;
    try {
      currentWorkspace = await repo.getCurrentWorkspaceName();
    } catch {
      return false;
    }
    if (currentWorkspace !== workspace) {
      return false;
    }
    vscode.window.showWarningMessage(`The current workspace "${workspace}" cannot be forgotten.`);
    return true;
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
        if (change.branchType === "~") {
          continue;
        }
        for (const b of change.localBookmarks) {
          if (!b.synced && !b.conflict) {
            unsyncedBookmarks.add(b.name);
          }
        }
      }
      if (unsyncedBookmarks.size > 0) {
        const bookmarksWithPushTargets = await this.repository.getBookmarksWithUnsyncedNonGitRemotes(operationId);
        for (const change of changes) {
          if (change.branchType === "~") {
            continue;
          }
          for (const b of change.localBookmarks) {
            if (!b.synced && !b.conflict) {
              b.showPushButton = bookmarksWithPushTargets.has(b.name);
            }
          }
        }
      }

      const supportsTagTracking = this.repository.supportsTagTracking();
      if (supportsTagTracking) {
        const unsyncedTags = new Set<string>();
        for (const change of changes) {
          if (change.branchType === "~") {
            continue;
          }
          for (const t of change.localTags) {
            if (!t.synced && !t.conflict) {
              unsyncedTags.add(t.name);
            }
          }
        }
        if (unsyncedTags.size > 0) {
          const tagsWithPushTargets = await this.repository.getTagsWithUnsyncedNonGitRemotes(operationId);
          for (const change of changes) {
            if (change.branchType === "~") {
              continue;
            }
            for (const t of change.localTags) {
              if (!t.synced && !t.conflict) {
                t.showPushButton = tagsWithPushTargets.has(t.name);
              }
            }
          }
        }
      }

      const changeIdsInGraph = new Set<FullChangeId>(
        changes.filter((c): c is RegularChangeNode => c.branchType !== "~").map((c) => c.id.changeId),
      );
      const previousSelectedNodes = this.selectedNodes;
      this.selectedNodes = new Set(Array.from(previousSelectedNodes).filter((id) => changeIdsInGraph.has(id)));
      // If any selected changes were removed (e.g. abandoned), notify listeners so the
      // SCM view can clear its stale sections.
      if (this.selectedNodes.size !== previousSelectedNodes.size) {
        this._onDidChangeSelection.fire(this.resolveSelection(Array.from(this.selectedNodes)));
      }
      const changeDoubleClickAction = config.get<string>("changeDoubleClickAction") || "edit";

      let currentWorkspace: string | undefined;
      try {
        currentWorkspace = await this.repository.getCurrentWorkspaceName(operationId);
      } catch (error: unknown) {
        logger.warn(
          `Failed to determine the current workspace: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

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
        supportsTagTracking,
        currentWorkspace,
      };
      this.postMessageToWebview(msg);
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
        this.postMessageToWebview(msg);
        return;
      }
      logger.error(`Failed to refresh graph: ${error instanceof Error ? error.message : String(error)}`);
      this.postMessageToWebview({ command: "showErrorState" });
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
    return a.every((nodeA, index) => getUniqueId(nodeA) === getUniqueId(b[index]));
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
  repositoryRoot?: RealPath,
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
  let maxPrefixLength = maxChangeIdPrefixLength(nonSyntheticEntries.map((e) => e.change_id_shortest));

  const changes = entries.map((entry) => {
    const entryUniqueId = getUniqueEntryId(entry);
    if (entryUniqueId.startsWith("~") || entry.change_id.startsWith("~")) {
      const uniqueParentIds = entry.parents.map((p: ParentRef) => fullChangeId(p.change_id, p.change_offset));

      return {
        fakeId: entryUniqueId,
        parentChangeIds: uniqueParentIds,
        branchType: "~" as const,
      };
    }

    const changeIdShortest = entry.change_id_shortest;
    const { changeIdSuffix } = changeIdAffixes(entry.change_id, changeIdShortest, maxPrefixLength);
    const email = entry.author.email;
    const timestamp = entry.author.timestamp;
    const commitId = entry.commit_id_short;

    const showOffset = shouldShowOffset(entry);
    const changeOffset = showOffset ? entry.change_offset : null;
    const uniqueChangeId = fullChangeId(entry.change_id, entry.change_offset);

    let branchType: "@" | "◆" | "○";
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

    const uniqueParentIds = entry.parents.map((p: ParentRef) => fullChangeId(p.change_id, p.change_offset));

    const changedFiles =
      repositoryRoot !== undefined && entry.fileStatuses
        ? entry.fileStatuses.map((f) => ({
            type: f.type,
            path: toForwardSlashes(repositoryRelativePath(repositoryRoot, f.path)),
            ...(f.renamedFrom ? { renamedFrom: toForwardSlashes(f.renamedFrom) } : {}),
            conflict: f.isConflict ?? f.type === "X",
          }))
        : undefined;

    return {
      id: {
        changeId: uniqueChangeId,
        changeIdPrefix: changeIdShortest,
        changeIdSuffix: changeIdSuffix,
        changeOffset: changeOffset,
      },
      label: formattedLine,
      commitId: entry.commit_id,
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
