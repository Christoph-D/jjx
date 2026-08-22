import path from "path";
import { toForwardSlashes } from "./utils";

const renameRegex = /^(.*)\{\s*(.*?)\s*=>\s*(.*?)\s*\}(.*)$/;

export function parseRenamePaths(file: string): { fromPath: string; toPath: string } | null {
  const renameMatch = renameRegex.exec(file);
  if (renameMatch) {
    const [_, prefix, fromPart, toPart, suffix] = renameMatch;
    const rawFromPath = prefix + fromPart + suffix;
    const rawToPath = prefix + toPart + suffix;
    const fromPath = toForwardSlashes(path.normalize(rawFromPath));
    const toPath = toForwardSlashes(path.normalize(rawToPath));
    return { fromPath, toPath };
  }
  return null;
}
