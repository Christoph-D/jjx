import path from "path";
import * as os from "os";
import * as crypto from "crypto";
import fs from "fs/promises";

const renameRegex = /^(.*)\{\s*(.*?)\s*=>\s*(.*?)\s*\}(.*)$/;

export function parseRenamePaths(file: string): { fromPath: string; toPath: string } | null {
  const renameMatch = renameRegex.exec(file);
  if (renameMatch) {
    const [_, prefix, fromPart, toPart, suffix] = renameMatch;
    const rawFromPath = prefix + fromPart + suffix;
    const rawToPath = prefix + toPart + suffix;
    const fromPath = path.normalize(rawFromPath).replace(/\\/g, "/");
    const toPath = path.normalize(rawToPath).replace(/\\/g, "/");
    return { fromPath, toPath };
  }
  return null;
}

export function filepathToFileset(filepath: string): string {
  return `file:"${filepath.replaceAll(/\\/g, "\\\\")}"`;
}

export async function prepareFakeeditor(): Promise<{
  succeedFakeeditor: () => Promise<void>;
  cleanup: () => Promise<void>;
  envVars: { [key: string]: string };
}> {
  const random = crypto.randomBytes(16).toString("hex");
  const signalDir = path.join(os.tmpdir(), `jjx-signal-${random}`);

  await fs.mkdir(signalDir, { recursive: true });

  return {
    envVars: { JJ_FAKEEDITOR_SIGNAL_DIR: signalDir },
    succeedFakeeditor: async () => {
      const signalFilePath = path.join(signalDir, "0");
      try {
        await fs.writeFile(signalFilePath, "");
      } catch (error) {
        throw new Error(
          `Failed to write signal file '${signalFilePath}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    cleanup: async () => {
      try {
        await fs.rm(signalDir, { recursive: true, force: true });
      } catch (error) {
        throw new Error(
          `Failed to cleanup signal directory '${signalDir}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}
