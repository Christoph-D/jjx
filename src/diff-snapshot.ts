import * as fs from "fs/promises";
import * as path from "path";

// Windows file systems don't track the Unix executable bit, so file modes cannot be collected
// reliably there; the Split view's mode-change entries stay disabled on Windows.
const supportsFileModes = process.platform !== "win32";

/** Git-style octal file mode ("100644", "100755", or "120000" for symlinks). */
async function fileMode(fullPath: string): Promise<string> {
  const stat = await fs.lstat(fullPath);
  if (stat.isSymbolicLink()) {
    return "120000";
  }
  return (stat.mode & 0o111) !== 0 ? "100755" : "100644";
}

/**
 * Reads one file from a snapshot directory materialized by jj for the `jjx-vscode-diff` tool.
 * A symlink's content is its target string (matching how git and jj diff symlinks): the link
 * itself is read so a link whose target is missing from the snapshot (jj only writes changed
 * files there) doesn't fail. Returns undefined when the file is absent from the snapshot.
 */
export async function readSnapshotFile(dir: string, relativePath: string): Promise<Buffer | undefined> {
  if (!dir) {
    return undefined;
  }
  const fullPath = path.join(dir, relativePath);
  try {
    const stat = await fs.lstat(fullPath);
    if (stat.isSymbolicLink()) {
      return Buffer.from(await fs.readlink(fullPath), "utf8");
    }
    if (!stat.isFile()) {
      return undefined;
    }
    return await fs.readFile(fullPath);
  } catch {
    return undefined;
  }
}

export interface SnapshotContents {
  // Snapshot-relative path → file content.
  files: Map<string, Buffer>;
  // Snapshot-relative path → git-style octal file mode; empty on platforms that cannot track
  // file modes (see supportsFileModes above).
  modes: Map<string, string>;
}

/**
 * Recursively reads a snapshot directory materialized by jj for the `jjx-vscode-diff` tool.
 * Returns empty contents when the directory doesn't exist (pure additions/deletions materialize
 * only one side, and jj may not invoke the tool at all for an empty diff).
 */
export async function readSnapshotDir(dir: string): Promise<SnapshotContents> {
  const files = new Map<string, Buffer>();
  const modes = new Map<string, string>();
  await readDirRecursive(dir, dir, files, modes);
  return { files, modes };
}

async function readDirRecursive(
  dir: string,
  base: string,
  files: Map<string, Buffer>,
  modes: Map<string, string>,
): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(base, fullPath).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      await readDirRecursive(fullPath, base, files, modes);
    } else if (entry.isSymbolicLink()) {
      files.set(relativePath, Buffer.from(await fs.readlink(fullPath), "utf8"));
      if (supportsFileModes) {
        modes.set(relativePath, "120000");
      }
    } else {
      files.set(relativePath, await fs.readFile(fullPath));
      if (supportsFileModes) {
        modes.set(relativePath, await fileMode(fullPath));
      }
    }
  }
}
