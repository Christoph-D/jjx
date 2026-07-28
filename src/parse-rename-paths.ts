import path from "path";

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
