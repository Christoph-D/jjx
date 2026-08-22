import path from "path";
import { parseRenamePaths } from "./parse-rename-paths";
import type { FileStatus, FileStatusType } from "./types";

/**
 * Parses the textual output of `jj interdiff --summary` (or `jj diff --summary`)
 * into structured {@link FileStatus} objects. Each summary line is `<status> <path>`,
 * with renames/copies rendered as `{from => to}` (optionally with prefix/suffix).
 */
export function parseInterdiffSummary(output: string, repositoryRoot: string): FileStatus[] {
  const fileStatuses: FileStatus[] = [];
  for (const lineRaw of output.trim().split("\n")) {
    const line = lineRaw.trim();
    if (!line) {
      continue;
    }
    const type = line.charAt(0) as FileStatusType;
    const rest = line.slice(2).trim().replace(/\\/g, "/");
    if (type === "R" || type === "C") {
      const parseResult = parseRenamePaths(rest);
      if (!parseResult) {
        continue;
      }
      const fullPath = path.join(repositoryRoot, parseResult.toPath);
      fileStatuses.push({
        type,
        file: path.basename(parseResult.toPath),
        path: fullPath,
        renamedFrom: parseResult.fromPath,
      });
    } else {
      const fullPath = path.join(repositoryRoot, rest);
      fileStatuses.push({ type, file: path.basename(rest), path: fullPath });
    }
  }
  return fileStatuses;
}
