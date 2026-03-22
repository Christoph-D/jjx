import { downloadAndUnzipVSCode } from "@vscode/test-electron/out/download";
import fs from "fs";
import path from "path";

const vscodePathFile = path.join(__dirname, ".vscode-path");

export default async () => {
  const vscodePath = await downloadAndUnzipVSCode("stable");
  await fs.promises.writeFile(vscodePathFile, vscodePath);
};

export function getVscodePath(): string {
  return fs.readFileSync(vscodePathFile, "utf-8").trim();
}
