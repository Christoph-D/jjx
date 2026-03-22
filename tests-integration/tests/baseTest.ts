import { test as base, type Page, type Frame, _electron } from "@playwright/test";
import { getVscodePath } from "../globalSetup";
export { expect } from "@playwright/test";
import path from "path";
import os from "os";
import fs from "fs";
import { execSync, spawn, type ChildProcess } from "child_process";
import { TestRepo, newTestRepo } from "../testRepo";

export { TestRepo };

export type TestOptions = {
  vscodeVersion: string;
};

type TestFixtures = TestOptions & {
  workbox: Page;
  graphFrame: Frame;
  testRepo: TestRepo;
};

type WorkerFixtures = {
  vscodePath: string;
  xvfbDisplay: string;
};

function hasXvfb(): boolean {
  try {
    execSync("which Xvfb", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  vscodePath: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use(getVscodePath());
    },
    { scope: "worker" },
  ],

  xvfbDisplay: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use, workerInfo) => {
      if (!hasXvfb()) {
        await use(process.env.DISPLAY ?? ":0");
        return;
      }

      const display = `:${99 + workerInfo.workerIndex}`;
      const xvfb: ChildProcess = spawn("Xvfb", [display, "-screen", "0", "1024x768x24"], {
        stdio: "ignore",
        detached: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      if (xvfb.exitCode !== null) {
        console.log(`Xvfb failed to start on ${display}, using existing display`);
        await use(process.env.DISPLAY ?? ":0");
        return;
      }

      await use(display);

      try {
        if (xvfb.pid) {
          process.kill(xvfb.pid, "SIGTERM");
        }
      } catch {
        // Process may already be gone
      }
    },
    { scope: "worker" },
  ],

  testRepo: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jjx-test-"));
      const repoPath = path.join(tempDir, "repo");

      const testRepo = await newTestRepo(repoPath);

      await use(testRepo);

      await fs.promises.rm(tempDir, { recursive: true, force: true });
    },
    { scope: "test" },
  ],

  workbox: async ({ vscodePath, testRepo, xvfbDisplay }, use) => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jjx-cache-"));
    const cachePath = path.join(tempDir, "cache");
    await fs.promises.mkdir(cachePath, { recursive: true });

    const extensionPath = path.resolve(__dirname, "..", "..");

    const userDataDir = path.join(cachePath, "user-data");
    const userDir = path.join(userDataDir, "User");
    await fs.promises.mkdir(userDir, { recursive: true });
    await fs.promises.writeFile(path.join(userDir, "settings.json"), '{"git.enabled": false}');

    const electronApp = await _electron.launch({
      executablePath: vscodePath,
      args: [
        "--no-sandbox",
        "--disable-gpu-sandbox",
        "--disable-dev-shm-usage",
        "--disable-updates",
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-workspace-trust",
        `--extensionDevelopmentPath=${extensionPath}`,
        `--extensions-dir=${path.join(cachePath, "extensions")}`,
        `--user-data-dir=${userDataDir}`,
        testRepo.repoPath,
      ],
      env: { ...process.env, DISPLAY: xvfbDisplay } as { [key: string]: string },
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
