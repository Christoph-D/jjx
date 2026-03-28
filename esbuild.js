const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function copyDir(src, dest) {
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function copyAssets() {
  fs.copyFileSync("src/webview/graph.html", "dist/webview/graph.html");
  fs.copyFileSync("src/webview/graph.css", "dist/webview/graph.css");
  copyFile("src/config.toml", "dist/config.toml");
  copyFile("src/jj-editor.sh", "dist/jj-editor.sh");
  copyFile("src/jj-merge-editor.sh", "dist/jj-merge-editor.sh");
  copyFile("src/jj-diff-tool.sh", "dist/jj-diff-tool.sh");
  copyFile("src/jj-squash-tool.sh", "dist/jj-squash-tool.sh");
  fs.chmodSync("dist/jj-editor.sh", 0o755);
  fs.chmodSync("dist/jj-merge-editor.sh", 0o755);
  fs.chmodSync("dist/jj-diff-tool.sh", 0o755);
  fs.chmodSync("dist/jj-squash-tool.sh", 0o755);

  copyDir("node_modules/@vscode/codicons/dist", "dist/codicons");
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",

  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log("[watch] build finished");
    });
  },
};

function createContext(entryPoint, outfile, overrides = {}) {
  return esbuild.context({
    entryPoints: [entryPoint],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile,
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin],
    ...overrides,
  });
}

async function main() {
  const contexts = await Promise.all([
    createContext("src/main.ts", "dist/main.js", { external: ["vscode"] }),
    createContext("src/jj-editor-main.ts", "dist/jj-editor-main.js"),
    createContext("src/jj-merge-editor-main.ts", "dist/jj-merge-editor-main.js"),
    createContext("src/jj-diff-tool-main.ts", "dist/jj-diff-tool-main.js"),
    createContext("src/jj-squash-tool-main.ts", "dist/jj-squash-tool-main.js"),
    createContext("src/webview/graph/main.tsx", "dist/webview/graph.js", {
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      jsxImportSource: "preact",
    }),
  ]);

  if (watch) {
    copyAssets();
    await Promise.all(contexts.map((ctx) => ctx.watch()));
  } else {
    await Promise.all(contexts.map((ctx) => ctx.rebuild()));
    copyAssets();
    await Promise.all(contexts.map((ctx) => ctx.dispose()));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
