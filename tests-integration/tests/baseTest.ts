import { test as base, type Page, type Frame, _electron } from "@playwright/test";
import { downloadAndUnzipVSCode } from "@vscode/test-electron/out/download";
export { expect } from "@playwright/test";
import path from "path";
import os from "os";
import fs from "fs";
import { spawn, spawnSync, execSync } from "child_process";

export type TestOptions = {
  vscodeVersion: string;
};

type TestFixtures = TestOptions & {
  workbox: Page;
  graphFrame: Frame;
};

type WorkerFixtures = {
  vscodePath: string;
};

let xvfb: ReturnType<typeof spawn> | null = null;
let display: string | undefined;

function startXvfb(): string | undefined {
  try {
    execSync("which Xvfb", { stdio: "ignore" });
  } catch {
    return undefined;
  }

  const maxAttempts = 10;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const displayNum = 99 + Math.floor(Math.random() * 900);
    const displayVal = `:${displayNum}`;

    xvfb = spawn("Xvfb", [displayVal, "-screen", "0", "1024x768x24"], {
      stdio: "ignore",
    });

    const startTime = Date.now();
    while (Date.now() - startTime < 100) {
      if (xvfb.exitCode !== null) {
        xvfb = null;
        break;
      }
    }

    if (xvfb && xvfb.exitCode === null) {
      return displayVal;
    }
  }

  return undefined;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  vscodePath: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const vscodePath = await downloadAndUnzipVSCode("stable");
      await use(vscodePath);
    },
    { scope: "worker" },
  ],

  workbox: async ({ vscodePath }, use) => {
    if (!display) {
      display = startXvfb();
    }

    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jjx-test-"));

    const cachePath = path.join(tempDir, "cache");
    await fs.promises.mkdir(cachePath, { recursive: true });

    const repoPath = path.join(tempDir, "repo");
    await fs.promises.mkdir(repoPath, { recursive: true });

    console.log(`Creating test jj repo in ${repoPath}`);
    spawnSync("jj git init", {
      cwd: repoPath,
      shell: true,
      stdio: "inherit",
    });

    const extensionPath = path.resolve(__dirname, "..", "..");

    const electronApp = await _electron.launch({
      executablePath: vscodePath,
      args: [
        "--no-sandbox",
        "--disable-gpu-sandbox",
        "--disable-updates",
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-workspace-trust",
        `--extensionDevelopmentPath=${extensionPath}`,
        `--extensions-dir=${path.join(cachePath, "extensions")}`,
        `--user-data-dir=${path.join(cachePath, "user-data")}`,
        repoPath,
      ],
      env: {
        ...process.env,
        ...(display ? { DISPLAY: display } : {}),
      },
    });

    const workbox = await electronApp.firstWindow();

    await use(workbox);

    await electronApp.close();
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  },

  graphFrame: async ({ workbox }, use) => {
    await workbox.locator(".monaco-workbench").waitFor({ timeout: 30000 });

    await workbox.getByRole("tab", { name: /Source Control/i }).click();
    await workbox.locator(".scm-view").first().waitFor({ timeout: 10000 });

    const graphHeader = workbox.getByRole("button", { name: /Source Control Graph/i });
    const isExpanded = await graphHeader.getAttribute("aria-expanded");
    if (isExpanded === "false") {
      await graphHeader.click();
      await workbox.waitForTimeout(2000);
    }

    const allFrames = workbox.frames();
    let graphFrame: Frame | null = null;
    for (const frame of allFrames) {
      const content = await frame.content();
      if (content.includes('id="nodes"')) {
        graphFrame = frame;
        break;
      }
    }

    if (!graphFrame) {
      throw new Error("Graph frame not found");
    }

    await use(graphFrame);
  },
});

process.on("exit", () => {
  if (xvfb) {
    xvfb.kill();
  }
});
