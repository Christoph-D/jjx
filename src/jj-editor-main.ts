import { IPCClient } from "./ipc/ipcClient";

function fatal(err: unknown): void {
  console.error(err);
  process.exit(1);
}

function main(argv: string[]): void {
  const ipcClient = new IPCClient("jj-editor");
  const descriptionPath = argv[argv.length - 1];

  ipcClient
    .call({ descriptionPath })
    .then(() => {
      setTimeout(() => process.exit(0), 0);
    })
    .catch((err) => fatal(err));
}

main(process.argv);
