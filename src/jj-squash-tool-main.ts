import * as path from "path";
import { IPCClient } from "./ipc/ipcClient";

function fatal(err: unknown): void {
  console.error(err);
  process.exit(1);
}

function main(argv: string[]): void {
  const ipcClient = new IPCClient("jj-squash-tool");

  const requestId = process.env["VSCODE_JJ_SQUASH_REQUEST_ID"];
  if (!requestId) {
    fatal(new Error("Missing VSCODE_JJ_SQUASH_REQUEST_ID"));
  }

  if (argv.length < 2) {
    fatal(new Error("Usage: jj-squash-tool-main.ts <left> <right>"));
  }

  const [left, right] = argv.slice(-2);
  const cwd = process.cwd();

  const leftAbsolute = path.isAbsolute(left) ? left : path.join(cwd, left);
  const rightAbsolute = path.isAbsolute(right) ? right : path.join(cwd, right);

  ipcClient
    .call({ requestId, leftPath: leftAbsolute, rightPath: rightAbsolute })
    .then((result) => {
      setTimeout(() => process.exit(result === true ? 0 : 1), 0);
    })
    .catch((err) => fatal(err));
}

main(process.argv);
