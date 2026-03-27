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

  if (production) {
    copyDir("node_modules/@vscode/codicons/dist", "dist/codicons");
  }
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

async function main() {
  // Production/watch build for src/main.ts (extension code)
  const ctx = await esbuild.context({
    entryPoints: ["src/main.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/main.js",
    external: ["vscode"],
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin],
  });

  // Build jj-editor-main.ts (standalone script for JJ_EDITOR)
  const jjEditorCtx = await esbuild.context({
    entryPoints: ["src/jj-editor-main.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/jj-editor-main.js",
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin],
  });

  // Build jj-merge-editor-main.ts (standalone script for merge tool)
  const jjMergeEditorCtx = await esbuild.context({
    entryPoints: ["src/jj-merge-editor-main.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/jj-merge-editor-main.js",
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin],
  });

  // Build jj-diff-tool-main.ts (standalone script for diff tool)
  const jjDiffToolCtx = await esbuild.context({
    entryPoints: ["src/jj-diff-tool-main.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/jj-diff-tool-main.js",
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin],
  });

  // Build jj-squash-tool-main.ts (standalone script for squash tool)
  const jjSquashToolCtx = await esbuild.context({
    entryPoints: ["src/jj-squash-tool-main.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/jj-squash-tool-main.js",
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin],
  });

  // Build webview graph script (runs in VS Code webview sandbox)
  const webviewGraphCtx = await esbuild.context({
    entryPoints: ["src/webview/graph/main.ts"],
    bundle: true,
    format: "iife",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "browser",
    outfile: "dist/webview/graph.js",
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin],
  });

  if (watch) {
    copyAssets();
    await ctx.watch();
    await jjEditorCtx.watch();
    await jjMergeEditorCtx.watch();
    await jjDiffToolCtx.watch();
    await jjSquashToolCtx.watch();
    await webviewGraphCtx.watch();
  } else {
    await ctx.rebuild();
    await jjEditorCtx.rebuild();
    await jjMergeEditorCtx.rebuild();
    await jjDiffToolCtx.rebuild();
    await jjSquashToolCtx.rebuild();
    await webviewGraphCtx.rebuild();
    copyAssets();
    await ctx.dispose();
    await jjEditorCtx.dispose();
    await jjMergeEditorCtx.dispose();
    await jjDiffToolCtx.dispose();
    await jjSquashToolCtx.dispose();
    await webviewGraphCtx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
