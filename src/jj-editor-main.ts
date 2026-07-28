import { IPCClient } from "./ipc/ipc-client";

function fatal(err: unknown): void {
  console.error(err);
  process.exit(1);
}

function main(argv: string[]): void {
  const ipcClient = new IPCClient("jj-editor");
  const descriptionPath = argv[argv.length - 1];
  const sessionId = process.env["VSCODE_JJ_SESSION_ID"];

  ipcClient
    .call({ descriptionPath, sessionId })
    .then(() => {
      setTimeout(() => process.exit(0), 0);
    })
    .catch((err) => fatal(err));
}

main(process.argv);
