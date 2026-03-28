import { test as base, type Page, type Frame, _electron } from "@playwright/test";
import { getVscodePath } from "../globalSetup";
import { expect } from "@playwright/test";
export { expect };
import path from "path";
import os from "os";
import fs from "fs";
import { execSync, spawn, type ChildProcess } from "child_process";
import { TestRepo, newTestRepo } from "../testRepo";

export { TestRepo, newTestRepo };

export type TestOptions = {
  vscodeVersion: string;
};

type TestFixtures = TestOptions & {
  cachePath: string;
  workbox: Page;
  graphFrame: Frame;
  testRepo: TestRepo;
  userDataDir: string;
};

type WorkerFixtures = {
  vscodePath: string;
  xvfbDisplay: string;
};

const xvfbPids: Set<number> = new Set();

function killXvfbProcesses(): void {
  for (const pid of xvfbPids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process may already be gone
    }
  }
  xvfbPids.clear();
}

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.once(signal, () => {
    killXvfbProcesses();
    process.exit(128 + (signal === "SIGTERM" ? 15 : signal === "SIGINT" ? 2 : 1));
  });
}

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
      const xvfb: ChildProcess = spawn("Xvfb", [display, "-screen", "0", "1920x1080x24"], {
        stdio: "ignore",
        detached: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      if (xvfb.exitCode !== null) {
        console.log(`Xvfb failed to start on ${display}, using existing display`);
        await use(process.env.DISPLAY ?? ":0");
        return;
      }

      if (xvfb.pid) {
        xvfbPids.add(xvfb.pid);
      }

      await use(display);

      if (xvfb.pid) {
        xvfbPids.delete(xvfb.pid);
        try {
          process.kill(xvfb.pid, "SIGTERM");
        } catch {
          // Process may already be gone
        }
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

  cachePath:
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jjx-cache-"));
      const cachePath = path.join(tempDir, "cache");
      await fs.promises.mkdir(cachePath, { recursive: true });
      await use(cachePath);
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    },

  userDataDir: async ({ cachePath }, use) => {
    const userDataDir = path.join(cachePath, "user-data");
    const userDir = path.join(userDataDir, "User");
    await fs.promises.mkdir(userDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(userDir, "settings.json"),
      JSON.stringify({
        "git.enabled": false,
        "diffEditor.renderSideBySide": true,
        "diffEditor.renderSideBySideInlineBreakpoint": 50,
        "jjx.showTooltips": false, // tooltips interfere with mouse positioning
        "window.dialogStyle": "custom",
        "window.autoDetectColorScheme": false,
      }),
    );
    await use(userDataDir);
  },

  workbox: async ({ cachePath, vscodePath, testRepo, userDataDir, xvfbDisplay }, use) => {
    const extensionPath = path.resolve(__dirname, "..", "..");

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
  },

  graphFrame: async ({ workbox }, use) => {
    await workbox.locator(".monaco-workbench").waitFor();

    await workbox.getByRole("tab", { name: /Source Control/i }).click();
    await workbox.locator(".scm-view").first().waitFor();

    const graphHeader = workbox.getByRole("button", { name: /JJ Graph/i });
    const isExpanded = await graphHeader.getAttribute("aria-expanded");
    if (isExpanded === "false") {
      await graphHeader.click();
    }

    let graphFrame: Frame | undefined;
    await expect(async () => {
      for (const frame of workbox.frames()) {
        const content = await frame.content();
        if (content.includes('id="nodes"')) {
          graphFrame = frame;
          return;
        }
      }
      throw new Error("Graph frame not found");
    }).toPass();

    await increaseJJVisibleSize(workbox);

    await use(graphFrame!);
  },
});

// Closes the chat window and increases the size of the jj graph
async function increaseJJVisibleSize(workbox: Page) {
  // Hide auxiliary side bar (chat window)
  await workbox.keyboard.press("Control+Alt+b");

  // Make the jj graph larger
  const sash = workbox.locator(".monaco-sash.horizontal.maximum").first();
  const sashBox = await sash.boundingBox();
  if (sashBox) {
    const sashCenterX = sashBox.x + sashBox.width / 2;
    const sashCenterY = sashBox.y + sashBox.height / 2;
    await workbox.mouse.move(sashCenterX, sashCenterY);
    await workbox.mouse.down();
    await workbox.mouse.move(sashCenterX, sashCenterY - 300);
    await workbox.mouse.up();
  }
}
