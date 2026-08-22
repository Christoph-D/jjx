import path from "path";
import { normalizePath } from "./utils";
import type { DiffFileEntry, FileStatus, FileStatusType } from "./types";

export type ParsedFileStatuses = {
  fileStatuses: FileStatus[];
  fileStatusesByPath: Map<string, FileStatus>;
  conflictedFiles: Set<string>;
};

/**
 * Parses `jj` diff file entries into structured {@link FileStatus} objects.
 * Files present in `conflictedPaths` but absent from `diffFiles` are
 * synthesized as conflict (`X`) entries, mirroring `jj`'s status output.
 * Every file listed in `conflictedPaths` — including ones that also appear in
 * `diffFiles` with a plain status letter — is flagged via `isConflict`.
 */
export function parseFileStatuses(
  diffFiles: DiffFileEntry[],
  conflictedPaths: string[] | undefined,
  repositoryRoot: string,
): ParsedFileStatuses {
  const fileStatuses: FileStatus[] = [];
  const fileStatusesByPath = new Map<string, FileStatus>();

  const conflictedFiles = new Set<string>();
  for (const conflictedPath of conflictedPaths || []) {
    const normalizedPath = path.normalize(conflictedPath).replace(/\\/g, "/");
    const fullPath = path.join(repositoryRoot, normalizedPath);
    conflictedFiles.add(normalizePath(fullPath));
  }

  for (const diffFile of diffFiles) {
    const statusChar = diffFile.status_char as FileStatusType;
    const targetPath = path.normalize(diffFile.target_path).replace(/\\/g, "/");
    const sourcePath = path.normalize(diffFile.source_path).replace(/\\/g, "/");
    const fullPath = path.join(repositoryRoot, targetPath);
    const isConflict = conflictedFiles.has(normalizePath(fullPath));

    let fileStatus: FileStatus;
    if (statusChar === "R" || statusChar === "C") {
      fileStatus = {
        type: statusChar,
        file: path.basename(targetPath),
        path: fullPath,
        renamedFrom: sourcePath,
        isConflict,
      };
    } else {
      fileStatus = {
        type: statusChar,
        file: path.basename(targetPath),
        path: fullPath,
        isConflict,
      };
    }
    fileStatuses.push(fileStatus);
    fileStatusesByPath.set(normalizePath(fullPath), fileStatus);
  }

  for (const conflictedPath of conflictedPaths || []) {
    const normalizedPath = path.normalize(conflictedPath).replace(/\\/g, "/");
    const fullPath = path.join(repositoryRoot, normalizedPath);

    const normalizedFullPath = normalizePath(fullPath);
    if (!fileStatusesByPath.has(normalizedFullPath)) {
      const fileStatus: FileStatus = {
        type: "X",
        file: path.basename(normalizedPath),
        path: fullPath,
        isConflict: true,
      };
      fileStatuses.push(fileStatus);
      fileStatusesByPath.set(normalizedFullPath, fileStatus);
    }
  }

  return { fileStatuses, fileStatusesByPath, conflictedFiles };
}

const UNTRACKED_SECTION_HEADER = "Untracked paths:";

/**
 * Parses the "Untracked paths:" section of `jj status` output into
 * {@link FileStatus} objects with type `?`. Untracked files only ever appear
 * for the working copy, so this is only relevant when inspecting `@`.
 */
export function parseUntrackedFileStatuses(statusOutput: string, repositoryRoot: string): FileStatus[] {
  const lines = statusOutput.split("\n");
  const result: FileStatus[] = [];
  let inUntrackedSection = false;
  for (const line of lines) {
    if (!inUntrackedSection) {
      if (line.trim() === UNTRACKED_SECTION_HEADER) {
        inUntrackedSection = true;
      }
      continue;
    }
    if (line.startsWith("? ")) {
      const relativePath = path.normalize(line.slice(2).trim()).replace(/\\/g, "/");
      if (!relativePath) {
        continue;
      }
      const fullPath = path.join(repositoryRoot, relativePath);
      result.push({
        type: "?",
        file: path.basename(relativePath),
        path: fullPath,
      });
    } else if (line.trim() !== "" && !line.startsWith("?")) {
      break;
    }
  }
  return result;
}
