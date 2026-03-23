import * as fs from "fs";
import * as path from "path";
import { IPCClient } from "./ipc/ipcClient";

function fatal(err: unknown): void {
  console.error(err);
  process.exit(1);
}

function readDirRecursive(dir: string, base: string = dir): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(base, fullPath);
    if (entry.isDirectory()) {
      Object.assign(files, readDirRecursive(fullPath, base));
    } else {
      files[relativePath] = fs.readFileSync(fullPath, "utf8");
    }
  }
  return files;
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

  try {
    leftFiles = readDirRecursive(leftAbsolute);
  } catch {
    // left dir may not exist for pure additions
  }

  try {
    rightFiles = readDirRecursive(rightAbsolute);
  } catch {
    // right dir may not exist for pure deletions
  }

  ipcClient
    .call({ requestId, leftFiles, rightFiles })
    .then((result) => {
      setTimeout(() => process.exit(result === true ? 0 : 1), 0);
    })
    .catch((err) => fatal(err));
}

main(process.argv);
