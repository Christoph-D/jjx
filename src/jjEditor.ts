import * as path from "path";
import { TabInputText, Uri, window, workspace } from "vscode";
import { IIPCHandler, IPCServer } from "./ipc/ipcServer";
import { EmptyDisposable } from "./utils";

interface JJEditorRequest {
  descriptionPath?: string;
}

let editorEnv: Record<string, string> = {};

export function getJjEditorEnv(): Record<string, string> {
  return editorEnv;
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
