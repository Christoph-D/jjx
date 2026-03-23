import * as path from "path";
import { commands, TabInputText, Uri, window, workspace } from "vscode";
import { IIPCHandler, IPCServer } from "./ipc/ipcServer";
import { EmptyDisposable } from "./utils";

interface JJEditorRequest {
  descriptionPath?: string;
}

interface MergeEditorRequest {
  left: string;
  base: string;
  right: string;
  output: string;
}

interface MergeEditorTabInput {
  result?: { toString(): string };
}

let editorEnv: Record<string, string> = {};
let mergeEditorPath = "";

export function getJjEditorEnv(): Record<string, string> {
  return editorEnv;
}

export function getMergeEditorPath(): string {
  return mergeEditorPath;
}

export class JJEditor implements IIPCHandler {
  private disposable = EmptyDisposable;

  constructor(ipc: IPCServer, extensionDir: string) {
    this.disposable = ipc.registerHandler("jj-editor", this);

    editorEnv = {
      JJ_EDITOR: `"${path.join(extensionDir, "jj-editor.sh")}"`,
      VSCODE_JJ_EDITOR_NODE: process.execPath,
      VSCODE_JJ_EDITOR_MAIN: path.join(extensionDir, "jj-editor-main.js"),
      VSCODE_JJ_IPC_HANDLE: ipc.ipcHandlePath,
    };
  }

  async handle({ descriptionPath }: JJEditorRequest): Promise<boolean> {
    if (descriptionPath) {
      const uri = Uri.file(descriptionPath);
      const doc = await workspace.openTextDocument(uri);
      await window.showTextDocument(doc, { preview: false });

      return new Promise((c) => {
        const onDidClose = window.tabGroups.onDidChangeTabs((tabs) => {
          if (tabs.closed.some((t) => t.input instanceof TabInputText && t.input.uri.toString() === uri.toString())) {
            onDidClose.dispose();
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

  constructor(ipc: IPCServer, extensionDir: string) {
    this.disposable = ipc.registerHandler("jj-merge-editor", this);

    mergeEditorPath = path.join(extensionDir, "jj-merge-editor.sh");

    editorEnv = {
      ...editorEnv,
      VSCODE_JJ_MERGE_NODE: process.execPath,
      VSCODE_JJ_MERGE_MAIN: path.join(extensionDir, "jj-merge-editor-main.js"),
    };
  }

  async handle(request: MergeEditorRequest): Promise<boolean> {
    const leftUri = Uri.file(request.left);
    const baseUri = Uri.file(request.base);
    const rightUri = Uri.file(request.right);
    const outputUri = Uri.file(request.output);

    await commands.executeCommand("_open.mergeEditor", {
      base: baseUri,
      input1: { uri: leftUri, title: "Left" },
      input2: { uri: rightUri, title: "Right" },
      output: outputUri,
    });

    return new Promise((c) => {
      const onDidClose = window.tabGroups.onDidChangeTabs((tabs) => {
        for (const t of tabs.closed) {
          const input = t.input as MergeEditorTabInput | undefined;
          const resultUri = input?.result?.toString();
          if (resultUri === outputUri.toString()) {
            onDidClose.dispose();
            return c(true);
          }
        }
      });
    });
  }

  dispose(): void {
    this.disposable.dispose();
  }
}
