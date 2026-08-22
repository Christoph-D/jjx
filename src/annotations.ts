import * as vscode from "vscode";
import type { ChangeWithDetails } from "./types";
import { resolveRev } from "./uri";
import type { ExtensionState } from "./extension-state";
import { relativeTime } from "./relative-time";
import { toWorkspaceUri } from "./workspace-paths";

export function registerAnnotations(state: ExtensionState): void {
  const context = state.context;

  const annotationDecoration = vscode.window.createTextEditorDecorationType({
    after: {
      margin: "0 0 0 3em",
      textDecoration: "none",
    },
    rangeBehavior: vscode.DecorationRangeBehavior.OpenOpen,
  });
  let annotateInfo:
    | {
        uri: vscode.Uri;
        changeIdsByLine: string[];
      }
    | undefined;
  let activeEditorUri: vscode.Uri | undefined;
  let activeLines: number[] = [];
  let lastUniqueChangeIds: string = "";
  let cachedChanges: Map<string, ChangeWithDetails> = new Map();
  const setDecorations = async (editor: vscode.TextEditor, lines: number[]) => {
    const repository = state.workspaceSCM.getRepositoryFromUri(editor.document.uri);
    if (!repository) {
      return;
    }
    const config = vscode.workspace.getConfiguration("jjx", toWorkspaceUri(repository.repositoryRoot));
    if (!config.get("enableAnnotations")) {
      editor.setDecorations(annotationDecoration, []);
      return;
    }

    if (annotateInfo && annotateInfo.uri === editor.document.uri && activeEditorUri === editor.document.uri) {
      const safeLines = lines.filter((line) => line !== annotateInfo!.changeIdsByLine.length);
      const linesKey = lines.join(",");
      const uniqueChangeIds = [
        ...new Set(safeLines.map((line) => annotateInfo!.changeIdsByLine[line]).filter(Boolean)),
      ];
      const uniqueChangeIdsKey = uniqueChangeIds.sort().join(",");
      if (uniqueChangeIdsKey !== lastUniqueChangeIds) {
        lastUniqueChangeIds = uniqueChangeIdsKey;
        const showResults = await repository.showAll(uniqueChangeIds);
        cachedChanges = new Map<string, ChangeWithDetails>(
          showResults.map((result) => [result.change.changeId.changeId, result.change]),
        );
      }
      if (annotateInfo && annotateInfo.uri === editor.document.uri && activeEditorUri === editor.document.uri) {
        const decorations: vscode.DecorationOptions[] = [];
        for (const line of safeLines) {
          const changeId = annotateInfo.changeIdsByLine[line];
          if (!changeId) {
            continue; // Could be possible if `annotateInfo` is stale due to the await
          }
          const change = cachedChanges.get(changeId);
          if (!change) {
            continue; // Could be possible if `annotateInfo` is mismatched with `changes` due to a race
          }
          const desc = change.description ? change.description.split("\n")[0] : "(no description)";
          const contextText = `${change.author.name}, ${relativeTime(change.authoredDate)} • ${desc}`;
          decorations.push({
            renderOptions: {
              after: {
                backgroundColor: "#00000000",
                color: "#99999959",
                contentText: contextText,
                textDecoration: "none;",
              },
            },
            range: editor.document.validateRange(new vscode.Range(line, 2 ** 30 - 1, line, 2 ** 30 - 1)),
          });
        }
        // Bail out if a newer selection event updated activeLines while we were
        // awaiting showAll. Without this guard, a stale call can replace the
        // correct decorations with ones computed for an old cursor position.
        if (activeLines.join(",") !== linesKey) {
          return;
        }
        editor.setDecorations(annotationDecoration, decorations);
      }
    }
  };
  const updateAnnotateInfo = async (uri: vscode.Uri) => {
    if (!["file", "jj"].includes(uri.scheme)) {
      annotateInfo = undefined;
      return;
    }
    const rev = resolveRev(uri, { diffOriginalRevBehavior: "suffix" });
    if (!rev) {
      annotateInfo = undefined;
      return;
    }

    const repository = state.workspaceSCM.getRepositoryFromUri(uri);
    if (!repository) {
      return;
    }
    const config = vscode.workspace.getConfiguration("jjx", toWorkspaceUri(repository.repositoryRoot));
    if (!config.get("enableAnnotations")) {
      annotateInfo = undefined;
      return;
    }

    try {
      const changeIdsByLine = await repository.annotate(uri.fsPath, rev);
      if (activeEditorUri === uri && changeIdsByLine.length > 0) {
        annotateInfo = { changeIdsByLine, uri };
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("more than one revision")) {
        annotateInfo = undefined;
      } else {
        throw error;
      }
    }
  };
  const handleDidChangeActiveTextEditor = async (editor: vscode.TextEditor | undefined) => {
    if (editor) {
      const uri = editor.document.uri;
      activeEditorUri = uri;
      lastUniqueChangeIds = "";
      cachedChanges.clear();
      await updateAnnotateInfo(uri);
      activeLines = editor.selections.map((selection) => selection.active.line);
      await setDecorations(editor, activeLines);
    }
  };
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(handleDidChangeActiveTextEditor));
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(async (e) => {
      activeLines = e.selections.map((selection) => selection.active.line);
      await setDecorations(e.textEditor, activeLines);
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(async (e) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.uri.toString() === e.document.uri.toString()) {
        await setDecorations(editor, activeLines);
      }
    }),
  );
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration("jjx.enableAnnotations")) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          lastUniqueChangeIds = "";
          cachedChanges.clear();
          await updateAnnotateInfo(editor.document.uri);
          activeLines = editor.selections.map((selection) => selection.active.line);
          await setDecorations(editor, activeLines);
        }
      }
    }),
  );
  context.subscriptions.push(
    state.workspaceSCM.onDidRepoUpdate(async ({ repoSCM }) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return;
      }
      const repo = state.workspaceSCM.getRepositoryFromUri(editor.document.uri);
      if (!repo || repo.repositoryRoot !== repoSCM.repositoryRoot) {
        return;
      }
      annotateInfo = undefined;
      lastUniqueChangeIds = "";
      cachedChanges.clear();
      await updateAnnotateInfo(editor.document.uri);
      activeLines = editor.selections.map((selection) => selection.active.line);
      await setDecorations(editor, activeLines);
    }),
  );

  if (vscode.window.activeTextEditor) {
    void handleDidChangeActiveTextEditor(vscode.window.activeTextEditor);
  }
}
