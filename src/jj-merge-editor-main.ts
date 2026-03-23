import { IPCClient } from "./ipc/ipcClient";

function fatal(err: unknown): void {
  console.error(err);
  process.exit(1);
}

function main(argv: string[]): void {
  const ipcClient = new IPCClient("jj-merge-editor");

  if (argv.length < 4) {
    fatal(new Error("Usage: jj-merge-editor-main.ts $left $base $right $output"));
  }

  const [left, base, right, output] = argv.slice(-4);

  ipcClient
    .call({ left, base, right, output })
    .then((result) => {
      setTimeout(() => process.exit(result === true ? 0 : 1), 0);
    })
    .catch((err) => fatal(err));
}

main(process.argv);
