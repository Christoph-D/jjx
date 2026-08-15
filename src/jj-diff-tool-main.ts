import * as fs from "fs";
import * as path from "path";
import { IPCClient } from "./ipc/ipc-client";

function fatal(err: unknown): void {
  console.error(err);
  process.exit(1);
}

// Windows file systems don't track the Unix executable bit, so file modes cannot be collected
// reliably there; the Split view's mode-change entries stay disabled on Windows.
const supportsFileModes = process.platform !== "win32";

/** Git-style octal file mode ("100644", "100755", or "120000" for symlinks). */
function fileMode(fullPath: string): string {
  const stat = fs.lstatSync(fullPath);
  if (stat.isSymbolicLink()) {
    return "120000";
  }
  return (stat.mode & 0o111) !== 0 ? "100755" : "100644";
}

function readDirRecursive(
  dir: string,
  base: string = dir,
): { files: Record<string, string>; modes: Record<string, string> } {
  const files: Record<string, string> = {};
  const modes: Record<string, string> = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(base, fullPath).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      const nested = readDirRecursive(fullPath, base);
      Object.assign(files, nested.files);
      Object.assign(modes, nested.modes);
    } else {
      // A symlink's content is its target string (matching how git and jj diff symlinks):
      // read the link itself so a link whose target is missing from the materialized snapshot
      // (jj only writes changed files there) doesn't fail the whole directory read.
      if (entry.isSymbolicLink()) {
        files[relativePath] = Buffer.from(fs.readlinkSync(fullPath), "utf8").toString("base64");
      } else {
        files[relativePath] = fs.readFileSync(fullPath).toString("base64");
      }
      if (supportsFileModes) {
        modes[relativePath] = fileMode(fullPath);
      }
    }
  }
  return { files, modes };
}

function main(argv: string[]): void {
  const ipcClient = new IPCClient("jj-diff-tool");

  const requestId = process.env["VSCODE_JJ_DIFF_REQUEST_ID"];
  if (!requestId) {
    fatal(new Error("Missing VSCODE_JJ_DIFF_REQUEST_ID"));
  }

  if (argv.length < 2) {
    fatal(new Error("Usage: jj-diff-tool-main.ts <left> <right>"));
  }

  const [left, right] = argv.slice(-2);
  const cwd = process.cwd();

  const leftAbsolute = path.isAbsolute(left) ? left : path.join(cwd, left);
  const rightAbsolute = path.isAbsolute(right) ? right : path.join(cwd, right);

  let leftFiles: Record<string, string> = {};
  let rightFiles: Record<string, string> = {};
  let leftModes: Record<string, string> = {};
  let rightModes: Record<string, string> = {};

  try {
    ({ files: leftFiles, modes: leftModes } = readDirRecursive(leftAbsolute));
  } catch {
    // left dir may not exist for pure additions
  }

  try {
    ({ files: rightFiles, modes: rightModes } = readDirRecursive(rightAbsolute));
  } catch {
    // right dir may not exist for pure deletions
  }

  ipcClient
    .call({ requestId, leftFiles, rightFiles, leftModes, rightModes })
    .then((result) => {
      setTimeout(() => process.exit(result === true ? 0 : 1), 0);
    })
    .catch((err) => fatal(err));
}

main(process.argv);
