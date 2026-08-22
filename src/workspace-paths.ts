import fs from "fs";
import path from "path";
import * as vscode from "vscode";
import { remapPathSpelling, type PathSpellingMapping } from "./utils";
import type { RealPath, WorkspacePath } from "./types";

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
 * Brands a path that is known to already use the resolved (realpath) spelling, e.g. the output
 * of `fs.realpathSync.native`, jj's stdout, or a join of an already-resolved root with a
 * relative path. This is a no-op assertion.
 */
export function asRealPath(fsPath: string): RealPath {
  return fsPath as RealPath;
}

/**
 * Maps a path spelled relative to a VS Code workspace folder onto its resolved (realpath)
 * spelling, so it matches paths derived from the canonical repository root. Returns the input
 * unchanged when the path lives outside the workspace folders or already uses the resolved
 * spelling.
 */
export function toRealPathSpelling(fsPath: string): RealPath {
  return asRealPath(remapPathSpelling(fsPath, workspaceFolderMappings().byWorkspacePath) ?? fsPath);
}

/**
 * Resolves `fsPath` to its canonical (realpath) spelling so it can be compared against the
 * resolved paths jj reports (repository roots, file statuses).
 *
 * This is the single spell-proof resolver: no other code should combine
 * `realpathSync.native` with its own ad-hoc fallback.
 */
export function resolveRepositoryPath(fsPath: string): RealPath {
  try {
    return asRealPath(fs.realpathSync.native(fsPath));
  } catch {
    return toRealPathSpelling(fsPath);
  }
}

/**
 * Maps a resolved (realpath) path onto the spelling VS Code uses for the workspace folder
 * containing it. Returns the input unchanged when the path lives outside the workspace folders
 * or no workspace folder resolves to it.
 */
export function toWorkspaceSpelling(fsPath: string): WorkspacePath {
  return (remapPathSpelling(fsPath, workspaceFolderMappings().byRealPath) ?? fsPath) as WorkspacePath;
}

/**
 * Constructs a `file://` URI with the workspace folder's path spelling so it matches the URIs
 * VS Code itself uses for editors, tabs, and decorations.
 */
export function toWorkspaceUri(fsPath: string): vscode.Uri {
  return vscode.Uri.file(toWorkspaceSpelling(fsPath));
}

/**
 * Returns `fsPath` relative to `repositoryRoot`.
 */
export function repositoryRelativePath(repositoryRoot: RealPath, fsPath: RealPath): string {
  return path.relative(repositoryRoot, fsPath);
}

/**
 * Joins a repository-relative path onto the resolved repository root, keeping the resolved
 * spelling.
 */
export function joinRepositoryPath(repositoryRoot: RealPath, relativePath: string): RealPath {
  return asRealPath(path.join(repositoryRoot, relativePath));
}
