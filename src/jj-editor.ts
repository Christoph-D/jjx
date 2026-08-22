import fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { commands, TabInputText, Uri, window, workspace } from "vscode";
import type { ExtensionState } from "./extension-state";
import { parseJJError } from "./errors";
import { IIPCHandler, IPCServer } from "./ipc/ipc-server";
import { EmptyDisposable } from "./vscode-utils";
import { escapeTomlString, formatChangeIdShort, formatChangeIdShortWithUnknownOffset } from "./utils";
import { toWorkspaceUri } from "./workspace-paths";

interface JJEditorRequest {
  descriptionPath?: string;
  sessionId?: string;
}

interface MergeEditorRequest {
  left: string;
  base: string;
  right: string;
  output: string;
  realPath: string;
}

interface MergeEditorTabInput {
  result?: { toString(): string };
}

let editorEnv: Record<string, string> = {};
let mergeEditorConfigs: string[] = [];
let diffToolConfigs: string[] = [];
let squashToolConfigs: string[] = [];
let splitToolConfigs: string[] = [];

function escapeShlexDoubleQuoted(s: string): string {
  return s.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function getJjEditorEnv(): Record<string, string> {
  return editorEnv;
}

export function getMergeEditorConfigs(): string[] {
  return mergeEditorConfigs;
}

export function getDiffToolConfigs(): string[] {
  return diffToolConfigs;
}

export function getSquashToolConfigs(): string[] {
  return squashToolConfigs;
}

export function getSplitToolConfigs(): string[] {
  return splitToolConfigs;
}

function tomlProgramConfig(toolName: string): string {
  return `merge-tools.${toolName}.program="${escapeTomlString(process.execPath)}"`;
}

function tomlArgsConfig(toolName: string, argsField: string, mainJsPath: string, args: string[]): string {
  const allArgs = [`"${escapeTomlString(mainJsPath)}"`, ...args.map((a) => `"${a}"`)];
  return `merge-tools.${toolName}.${argsField}=[${allArgs.join(", ")}]`;
}

interface ConflictSideLabels {
  changeIdShort: string;
  commitIdShort: string;
  description: string;
}

const conflictToRe = /^\\{7}\s+to:\s+(\S+)\s+(\S+)(?:\s+"(.*)")?/;
const conflictAddRe = /^\+{7}\s+(\S+)\s+(\S+)(?:\s+"(.*)")?/;

function parseConflictLabels(content: string): { left?: ConflictSideLabels; right?: ConflictSideLabels } {
  const result: { left?: ConflictSideLabels; right?: ConflictSideLabels } = {};
  for (const line of content.split("\n")) {
    if (!result.left) {
      const m = line.match(conflictToRe);
      if (m) {
        result.left = { changeIdShort: m[1], commitIdShort: m[2], description: m[3] ?? "" };
        continue;
      }
    }
    if (!result.right) {
      const m = line.match(conflictAddRe);
      if (m) {
        result.right = { changeIdShort: m[1], commitIdShort: m[2], description: m[3] ?? "" };
        continue;
      }
    }
    if (result.left && result.right) {
      break;
    }
  }
  return result;
}

/**
 * Resolves the fixed-width change ID prefix parsed from a conflict marker label to the same
 * shortest (padded) change ID representation used in diff titles and the graph view.
 *
 * Only data already loaded in the graph webview is consulted: resolving a merge-editor side
 * title must not spawn a jj process. The commit ID prefix from the conflict marker is used to
 * disambiguate divergent changes that share the same change ID. When that lookup fails because
 * the commit ID is stale (e.g. after a rewrite), the change is matched by change ID prefix
 * alone; the matched node may then be at the wrong offset, which is shown as `/?`. When the
 * change isn't in the cache at all (or the graph is showing a different repository), the raw
 * marker label is returned as-is.
 */
function resolveConflictSideTitle(
  state: ExtensionState | undefined,
  outputUri: Uri,
  labels: ConflictSideLabels,
): string {
  if (state) {
    const repositoryRoot = state.workspaceSCM.getRepositoryFromUri(outputUri)?.repositoryRoot;
    if (repositoryRoot) {
      const changeId = state.graphWebview?.findChangeIdByPrefix(
        labels.changeIdShort,
        labels.commitIdShort,
        repositoryRoot,
      );
      if (changeId) {
        return formatChangeIdShort(changeId);
      }
      const changeIdWithoutCommit = state.graphWebview?.findChangeIdByChangeIdPrefix(
        labels.changeIdShort,
        repositoryRoot,
      );
      if (changeIdWithoutCommit) {
        return formatChangeIdShortWithUnknownOffset(changeIdWithoutCommit);
      }
    }
  }
  return labels.changeIdShort;
}

interface DiffToolRequest {
  requestId: string;
  // Absolute paths of the snapshot directories jj materialized for the diff. The extension reads
  // the files it needs directly from disk; the tool process (and with it the snapshot
  // directories) stays alive until `completeDiffToolRequest` responds to it.
  leftDir: string;
  rightDir: string;
}

interface PendingDiffRequest {
  resolve: (data: { leftDir: string; rightDir: string }) => void;
  reject: (error: Error) => void;
  complete: (success: boolean) => void;
}

const pendingDiffRequests = new Map<string, PendingDiffRequest>();

export function expectDiffToolRequest(requestId: string): Promise<{ leftDir: string; rightDir: string }> {
  return new Promise((resolve, reject) => {
    pendingDiffRequests.set(requestId, { resolve, reject, complete: () => {} });
  });
}

export function completeDiffToolRequest(requestId: string, success: boolean): void {
  const pending = pendingDiffRequests.get(requestId);
  if (pending) {
    pending.complete(success);
    // When the tool request never arrived (e.g. jj exited early), `complete` is still the
    // placeholder no-op and would leave the entry behind, so remove it explicitly.
    pendingDiffRequests.delete(requestId);
  }
}

interface SquashToolRequest {
  requestId: string;
  leftPath: string;
  rightPath: string;
}

interface PendingSquashRequest {
  resolve: (data: { leftPath: string; rightPath: string }) => void;
  reject: (error: Error) => void;
  complete: (success: boolean) => void;
}

const pendingSquashRequests = new Map<string, PendingSquashRequest>();

export function expectSquashToolRequest(requestId: string): Promise<{ leftPath: string; rightPath: string }> {
  return new Promise((resolve, reject) => {
    pendingSquashRequests.set(requestId, { resolve, reject, complete: () => {} });
  });
}

export function completeSquashToolRequest(requestId: string, success: boolean): void {
  const pending = pendingSquashRequests.get(requestId);
  if (pending) {
    pending.complete(success);
  }
}

interface SplitToolRequest {
  requestId: string;
  leftPath: string;
  rightPath: string;
}

interface PendingSplitRequest {
  resolve: (data: { leftPath: string; rightPath: string }) => void;
  reject: (error: Error) => void;
  complete: (success: boolean) => void;
}

const pendingSplitRequests = new Map<string, PendingSplitRequest>();

export function expectSplitToolRequest(requestId: string): Promise<{ leftPath: string; rightPath: string }> {
  return new Promise((resolve, reject) => {
    pendingSplitRequests.set(requestId, { resolve, reject, complete: () => {} });
  });
}

export function completeSplitToolRequest(requestId: string, success: boolean): void {
  const pending = pendingSplitRequests.get(requestId);
  if (pending) {
    pending.complete(success);
    // When the tool request never arrived (e.g. jj exited early), `complete` is still the
    // placeholder no-op and would leave the entry behind, so remove it explicitly.
    pendingSplitRequests.delete(requestId);
  }
}

const editorSessions = new Map<string, string>();

export function consumeEditorSession(sessionId: string): string | undefined {
  const content = editorSessions.get(sessionId);
  editorSessions.delete(sessionId);
  return content;
}

export async function openRecoveredEditor(content: string, error: unknown): Promise<void> {
  const prefixedContent = `** Recovered description **\n\njj operation failed. Your change description has been recovered. Please save it before closing this editor to avoid losing it:\n\n${content}`;
  const doc = await workspace.openTextDocument({ content: prefixedContent, language: "jj-commit" });
  await window.showTextDocument(doc, { preview: false });

  const parsedError = parseJJError(error);
  window.showErrorMessage(`jj command failed: ${parsedError.message}. Your message has been recovered.`);
}

export class JJEditor implements IIPCHandler {
  private disposable = EmptyDisposable;

  constructor(ipc: IPCServer, extensionDir: string) {
    this.disposable = ipc.registerHandler("jj-editor", this);

    editorEnv = {
      JJ_EDITOR: `"${escapeShlexDoubleQuoted(process.execPath)}" "${escapeShlexDoubleQuoted(path.join(extensionDir, "jj-editor-main.js"))}"`,
      ELECTRON_RUN_AS_NODE: "1",
      VSCODE_JJ_IPC_HANDLE: ipc.ipcHandlePath,
    };
  }

  async handle({ descriptionPath, sessionId }: JJEditorRequest): Promise<boolean> {
    if (descriptionPath) {
      const uri = toWorkspaceUri(descriptionPath);
      const doc = await workspace.openTextDocument(uri);
      await window.showTextDocument(doc, { preview: false });

      return new Promise((c) => {
        const onDidClose = window.tabGroups.onDidChangeTabs((tabs) => {
          if (tabs.closed.some((t) => t.input instanceof TabInputText && t.input.uri.toString() === uri.toString())) {
            onDidClose.dispose();
            if (sessionId) {
              editorSessions.set(sessionId, doc.getText());
            }
            return c(true);
          }
        });
      });
    }

    return Promise.resolve(false);
  }

  dispose(): void {
    this.disposable.dispose();
  }
}

export class JJMergeEditor implements IIPCHandler {
  private disposable = EmptyDisposable;

  constructor(
    ipc: IPCServer,
    extensionDir: string,
    private readonly getExtensionState: () => ExtensionState | undefined,
  ) {
    this.disposable = ipc.registerHandler("jj-merge-editor", this);

    const mainJsPath = path.join(extensionDir, "jj-merge-editor-main.js");
    const toolName = "jjx-vscode-merge";
    mergeEditorConfigs = [
      tomlProgramConfig(toolName),
      tomlArgsConfig(toolName, "merge-args", mainJsPath, ["$left", "$base", "$right", "$output"]),
    ];
  }

  async handle(request: MergeEditorRequest): Promise<boolean> {
    const outputUri = toWorkspaceUri(request.realPath);

    const leftBasename = path.basename(request.left);
    const baseBasename = path.basename(request.base);
    const rightBasename = path.basename(request.right);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jjx-merge-"));
    const leftCopy = path.join(tempDir, leftBasename.startsWith("left_") ? leftBasename : `left_${leftBasename}`);
    const baseCopy = path.join(tempDir, baseBasename.startsWith("base_") ? baseBasename : `base_${baseBasename}`);
    const rightCopy = path.join(tempDir, rightBasename.startsWith("right_") ? rightBasename : `right_${rightBasename}`);
    await Promise.all([
      fs.copyFile(request.left, leftCopy),
      fs.copyFile(request.base, baseCopy),
      fs.copyFile(request.right, rightCopy),
    ]);

    const leftCopyUri = toWorkspaceUri(leftCopy);
    const baseCopyUri = toWorkspaceUri(baseCopy);
    const rightCopyUri = toWorkspaceUri(rightCopy);

    let input1: { uri: Uri; title: string; description?: string; detail?: string } = {
      uri: leftCopyUri,
      title: "Left",
    };
    let input2: { uri: Uri; title: string; description?: string; detail?: string } = {
      uri: rightCopyUri,
      title: "Right",
    };

    try {
      const outputContent = await fs.readFile(request.output, "utf-8");
      const labels = parseConflictLabels(outputContent);
      if (labels.left) {
        const desc = labels.left.description.split("\n")[0] || "(no description)";
        input1 = {
          uri: leftCopyUri,
          title: resolveConflictSideTitle(this.getExtensionState(), outputUri, labels.left),
          description: desc,
          detail: `commit ${labels.left.commitIdShort}`,
        };
      }
      if (labels.right) {
        const desc = labels.right.description.split("\n")[0] || "(no description)";
        input2 = {
          uri: rightCopyUri,
          title: resolveConflictSideTitle(this.getExtensionState(), outputUri, labels.right),
          description: desc,
          detail: `commit ${labels.right.commitIdShort}`,
        };
      }
    } catch {
      // Fall back to default titles
    }

    await commands.executeCommand("_open.mergeEditor", {
      base: baseCopyUri,
      input1,
      input2,
      output: outputUri,
    });

    const onDidClose = window.tabGroups.onDidChangeTabs((tabs) => {
      for (const t of tabs.closed) {
        const input = t.input as MergeEditorTabInput | undefined;
        const resultUri = input?.result?.toString();
        if (resultUri === outputUri.toString()) {
          onDidClose.dispose();
          fs.rm(tempDir, { recursive: true }).catch(() => {});
          return;
        }
      }
    });

    return true;
  }

  dispose(): void {
    this.disposable.dispose();
  }
}

export class JJDiffTool implements IIPCHandler {
  private disposable = EmptyDisposable;

  constructor(ipc: IPCServer, extensionDir: string) {
    this.disposable = ipc.registerHandler("jj-diff-tool", this);

    const mainJsPath = path.join(extensionDir, "jj-diff-tool-main.js");
    const toolName = "jjx-vscode-diff";
    diffToolConfigs = [
      tomlProgramConfig(toolName),
      tomlArgsConfig(toolName, "diff-args", mainJsPath, ["$left", "$right"]),
    ];
  }

  handle(request: DiffToolRequest): Promise<boolean> {
    const pending = pendingDiffRequests.get(request.requestId);
    if (!pending) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      pending.resolve({ leftDir: request.leftDir, rightDir: request.rightDir });
      pending.complete = (success: boolean) => {
        pendingDiffRequests.delete(request.requestId);
        resolve(success);
      };
    });
  }

  dispose(): void {
    this.disposable.dispose();
  }
}

export class JJSquashTool implements IIPCHandler {
  private disposable = EmptyDisposable;

  constructor(ipc: IPCServer, extensionDir: string) {
    this.disposable = ipc.registerHandler("jj-squash-tool", this);

    const mainJsPath = path.join(extensionDir, "jj-squash-tool-main.js");
    const toolName = "jjx-vscode-squash";
    squashToolConfigs = [
      tomlProgramConfig(toolName),
      tomlArgsConfig(toolName, "edit-args", mainJsPath, ["$left", "$right"]),
    ];
  }

  handle(request: SquashToolRequest): Promise<boolean> {
    const pending = pendingSquashRequests.get(request.requestId);
    if (!pending) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      pending.resolve({ leftPath: request.leftPath, rightPath: request.rightPath });
      pending.complete = (success: boolean) => {
        pendingSquashRequests.delete(request.requestId);
        resolve(success);
      };
    });
  }

  dispose(): void {
    this.disposable.dispose();
  }
}

export class JJSplitTool implements IIPCHandler {
  private disposable = EmptyDisposable;

  constructor(ipc: IPCServer, extensionDir: string) {
    this.disposable = ipc.registerHandler("jj-split-tool", this);

    const mainJsPath = path.join(extensionDir, "jj-split-tool-main.js");
    const toolName = "jjx-vscode-split";
    splitToolConfigs = [
      tomlProgramConfig(toolName),
      tomlArgsConfig(toolName, "edit-args", mainJsPath, ["$left", "$right"]),
    ];
  }

  handle(request: SplitToolRequest): Promise<boolean> {
    const pending = pendingSplitRequests.get(request.requestId);
    if (!pending) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      pending.resolve({ leftPath: request.leftPath, rightPath: request.rightPath });
      pending.complete = (success: boolean) => {
        pendingSplitRequests.delete(request.requestId);
        resolve(success);
      };
    });
  }

  dispose(): void {
    this.disposable.dispose();
  }
}
