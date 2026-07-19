import path from "path";
import type { DiffFileEntry, FileStatus, FileStatusType } from "./types";

export type ParsedFileStatuses = {
  fileStatuses: FileStatus[];
  fileStatusesByPath: Map<string, FileStatus>;
  conflictedFiles: Set<string>;
};

const isWindows = process.platform === "win32";
const isMacintosh = process.platform === "darwin";

function normalizePath(p: string): string {
  if (isWindows || isMacintosh) {
    return p.toLowerCase();
  }
  return p;
}

/**
 * Parses `jj` diff file entries into structured {@link FileStatus} objects.
 * Files present in `conflictedPaths` but absent from `diffFiles` are
 * synthesized as conflict (`X`) entries, mirroring `jj`'s status output.
 */
export function parseFileStatuses(
  diffFiles: DiffFileEntry[],
  conflictedPaths: string[] | undefined,
  repositoryRoot: string,
): ParsedFileStatuses {
  const fileStatuses: FileStatus[] = [];
  const fileStatusesByPath = new Map<string, FileStatus>();

  for (const diffFile of diffFiles) {
    const statusChar = diffFile.status_char as FileStatusType;
    const targetPath = path.normalize(diffFile.target_path).replace(/\\/g, "/");
    const sourcePath = path.normalize(diffFile.source_path).replace(/\\/g, "/");
    const fullPath = path.join(repositoryRoot, targetPath);

    let fileStatus: FileStatus;
    if (statusChar === "R" || statusChar === "C") {
      fileStatus = {
        type: statusChar,
        file: path.basename(targetPath),
        path: fullPath,
        renamedFrom: sourcePath,
      };
    } else {
      fileStatus = {
        type: statusChar,
        file: path.basename(targetPath),
        path: fullPath,
      };
    }
    fileStatuses.push(fileStatus);
    fileStatusesByPath.set(normalizePath(fullPath), fileStatus);
  }

  const conflictedFiles = new Set<string>();
  for (const conflictedPath of conflictedPaths || []) {
    const normalizedPath = path.normalize(conflictedPath).replace(/\\/g, "/");
    const fullPath = path.join(repositoryRoot, normalizedPath);
    conflictedFiles.add(normalizePath(fullPath));

    const normalizedFullPath = normalizePath(fullPath);
    if (!fileStatusesByPath.has(normalizedFullPath)) {
      fileStatuses.push({
        type: "X",
        file: path.basename(normalizedPath),
        path: fullPath,
      });
      fileStatusesByPath.set(normalizedFullPath, fileStatuses[fileStatuses.length - 1]);
    }
  }

  return { fileStatuses, fileStatusesByPath, conflictedFiles };
}
