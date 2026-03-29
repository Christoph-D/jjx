#!/usr/bin/env node

import { execSync } from "child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, relative } from "path";
import { posix } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const vendorDir = join(rootDir, "src", "vendor", "vscode");
const manifestPath = join(rootDir, "src", "vendor", "manifest.json");
const vscodeRepoDir = join(rootDir, ".vscode-repo");
const vscodeSourceDir = join(vscodeRepoDir, "src", "vs");

function parseArgs() {
  const args = process.argv.slice(2);
  let tag = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tag" && args[i + 1]) {
      tag = args[++i];
    }
  }
  return { tag };
}

function run(cmd, opts = {}) {
  execSync(cmd, { stdio: "inherit", ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: "utf-8" }).trim();
}

function ensureRepo(repoUrl) {
  if (!existsSync(join(vscodeRepoDir, ".git"))) {
    console.log("Cloning VS Code repository...");
    run(`git clone ${repoUrl} "${vscodeRepoDir}"`);
  } else {
    console.log("Fetching latest from VS Code repository...");
    run(`git -C "${vscodeRepoDir}" fetch --tags`);
  }
}

function checkoutRef(ref) {
  console.log(`Checking out ${ref}...`);
  run(`git -C "${vscodeRepoDir}" checkout ${ref}`);
}

function getLatestReleaseTag() {
  const result = runCapture(`git -C "${vscodeRepoDir}" tag --list --sort=-version:refname '1.*'`);
  const tags = result.split("\n").filter((t) => !t.includes("-"));
  if (tags.length === 0) {
    throw new Error("No VS Code release tags found");
  }
  return tags[0];
}

function resolveImports(filePath, content) {
  const imports = new Set();
  const regex = /from\s+['"](\.\.?\/[^'"]+)['"]/g;
  const fileDir = posix.dirname(filePath);

  let match;
  while ((match = regex.exec(content)) !== null) {
    const importPath = match[1].replace(/\.js$/, "").replace(/\.ts$/, "");
    const resolved = posix.normalize(posix.join(fileDir, importPath));
    imports.add(resolved + ".ts");
  }

  return imports;
}

const baseCommonAllowed = [
  "arrays.ts",
  "arraysFind.ts",
  "assert.ts",
  "charCode.ts",
  "diff/",
  "errors.ts",
  "hash.ts",
  "map.ts",
  "strings.ts",
  "uint.ts",
];

function isInScope(filePath) {
  if (filePath.startsWith("editor/common/core/")) return true;
  if (filePath.startsWith("editor/common/diff/")) return true;
  if (filePath.startsWith("base/common/")) {
    const rel = filePath.slice("base/common/".length);
    return baseCommonAllowed.some((s) => rel === s || (s.endsWith("/") && rel.startsWith(s)));
  }
  return false;
}

function discoverAndCopyFiles(entryPoints) {
  const queue = [...entryPoints];
  const visited = new Set();
  const allFiles = [];
  const externalDeps = new Set();
  let missing = 0;

  while (queue.length > 0) {
    const file = queue.pop();
    if (visited.has(file)) continue;
    visited.add(file);

    const src = join(vscodeSourceDir, file);
    if (!existsSync(src)) {
      console.error(`  MISSING: ${file}`);
      missing++;
      continue;
    }

    const dest = join(vendorDir, file);
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(src, dest);
    allFiles.push(file);

    const content = readFileSync(src, "utf-8");
    const imports = resolveImports(file, content);

    for (const imp of imports) {
      if (visited.has(imp)) continue;

      if (isInScope(imp)) {
        queue.push(imp);
      } else {
        externalDeps.add(imp);
      }
    }
  }

  return { allFiles, externalDeps, missing };
}

function removeOrphanedFiles(validFiles) {
  const validSet = new Set(validFiles.map((f) => join(vendorDir, f)));

  function walk(dir) {
    if (!existsSync(dir)) return;
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        try {
          if (readdirSync(fullPath).length === 0) {
            rmSync(fullPath);
          }
        } catch {}
      } else if (entry.isFile() && entry.name.endsWith(".ts")) {
        if (!validSet.has(fullPath)) {
          console.log(`  Removing: ${relative(vendorDir, fullPath)}`);
          rmSync(fullPath);
        }
      }
    }
  }

  walk(vendorDir);
}

const { tag: argTag } = parseArgs();
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

ensureRepo(manifest.repoUrl);

const tag = argTag || getLatestReleaseTag();
checkoutRef(tag);

console.log("\nDiscovering and copying files...");
const { allFiles, externalDeps, missing } = discoverAndCopyFiles(manifest.entryPoints);

if (missing > 0) {
  console.error(`\n${missing} files not found. Check entry points and VS Code version.`);
  process.exit(1);
}

console.log(`Copied ${allFiles.length} files.`);

if (externalDeps.size > 0) {
  console.log("\nExternal dependencies (not vendored):");
  for (const dep of [...externalDeps].sort()) {
    console.log(`  ${dep}`);
  }
}

console.log("\nRemoving orphaned files...");
removeOrphanedFiles(allFiles);

manifest.vscodeRef = tag;
manifest.files = allFiles.sort();
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`\nUpdated manifest: vscodeRef=${tag}, ${allFiles.length} files`);

console.log("\nRunning type check...");
try {
  run("npm run check-types", { cwd: rootDir });
  console.log("\nDone! Vendor update complete.");
} catch {
  console.error("\nType check failed. Manual fixes may be needed.");
  process.exit(1);
}
