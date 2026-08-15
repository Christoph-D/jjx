import * as path from "path";
import { IPCClient } from "./ipc/ipc-client";

function fatal(err: unknown): void {
  console.error(err);
  process.exit(1);
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

  // Only the snapshot directory paths are sent over IPC; the extension reads the files it needs
  // directly from disk. jj removes the snapshot directories when this process exits, so the exit
  // is delayed until the IPC response arrives — the extension withholds it while it reads.
  ipcClient
    .call({ requestId, leftDir: leftAbsolute, rightDir: rightAbsolute })
    .then((result) => {
      setTimeout(() => process.exit(result === true ? 0 : 1), 0);
    })
    .catch((err) => fatal(err));
}

main(process.argv);
