import fs from "fs";
import * as vscode from "vscode";
import { remapPathSpelling, type PathSpellingMapping } from "./utils";

// Mappings between workspace folder paths as spelled by VS Code and their resolved (realpath)
// spellings, cached per set of workspace folders. VS Code keeps the spelling a folder was
// opened with (e.g. through a symlink such as /var/folders -> /private/var/folders on macOS),
// while jj reports resolved paths, so the two spellings must be translated explicitly.
let cachedFolderKey: string | undefined;
let cachedByWorkspacePath: PathSpellingMapping[] = [];
let cachedByRealPath: PathSpellingMapping[] = [];

function longestFromSideFirst(mappings: PathSpellingMapping[]): PathSpellingMapping[] {
  return [...mappings].sort((a, b) => b.from.length - a.from.length);
}

function workspaceFolderMappings(): { byWorkspacePath: PathSpellingMapping[]; byRealPath: PathSpellingMapping[] } {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const key = folders.map((folder) => folder.uri.toString()).join("\n");
  if (key !== cachedFolderKey) {
    cachedFolderKey = key;
    const mappings = folders.map((folder): PathSpellingMapping => {
      const workspacePath = folder.uri.fsPath;
      let realPath = workspacePath;
      try {
        realPath = fs.realpathSync.native(workspacePath);
      } catch {
        // The folder may not exist on disk (yet); fall back to VS Code's spelling.
      }
      return { from: workspacePath, to: realPath };
    });
    cachedByWorkspacePath = longestFromSideFirst(mappings);
    cachedByRealPath = longestFromSideFirst(mappings.map(({ from, to }) => ({ from: to, to: from })));
  }
  return { byWorkspacePath: cachedByWorkspacePath, byRealPath: cachedByRealPath };
}

/**
 * Maps a path spelled relative to a VS Code workspace folder onto its resolved (realpath)
 * spelling, so it matches paths derived from the canonical repository root. Returns the input
 * unchanged when the path lives outside the workspace folders or already uses the resolved
 * spelling.
 */
export function toRealPathSpelling(fsPath: string): string {
  return remapPathSpelling(fsPath, workspaceFolderMappings().byWorkspacePath) ?? fsPath;
}

/**
 * Maps a resolved (realpath) path onto the spelling VS Code uses for the workspace folder
 * containing it. Returns the input unchanged when the path lives outside the workspace folders
 * or no workspace folder resolves to it.
 */
export function toWorkspaceSpelling(fsPath: string): string {
  return remapPathSpelling(fsPath, workspaceFolderMappings().byRealPath) ?? fsPath;
}
