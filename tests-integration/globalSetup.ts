import { downloadAndUnzipVSCode } from "@vscode/test-electron/out/download";
import fs from "fs";
import path from "path";

const vscodePathFile = path.join(__dirname, ".vscode-path");
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

function isVscodePathValid(): boolean {
  if (!fs.existsSync(vscodePathFile)) {
    return false;
  }
  const stats = fs.statSync(vscodePathFile);
  const ageMs = Date.now() - stats.mtimeMs;
  return ageMs <= MAX_AGE_MS;
}

export default async () => {
  if (isVscodePathValid()) {
    const vscodePath = fs.readFileSync(vscodePathFile, "utf-8").trim();
    console.log(`Using existing vscode binary: ${vscodePath}`);
    return;
  }
  const vscodePath = await downloadAndUnzipVSCode("stable");
  await fs.promises.writeFile(vscodePathFile, vscodePath);
};

export function getVscodePath(): string {
  return fs.readFileSync(vscodePathFile, "utf-8").trim();
}
