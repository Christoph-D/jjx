import { test as base, type Page, type Frame, _electron, expect as pwExpect, Locator } from "@playwright/test";
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
  scmView: Locator;
  opLog: Locator;
  testRepo: TestRepo;
  userDataDir: string;
  customSettings: Record<string, unknown>;
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

      const maxAttempts = 20;
      let startedXvfb: ChildProcess | undefined;
      let startedDisplay: string | undefined;

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const display = `:${99 + workerInfo.workerIndex + attempt}`;
        const xvfb: ChildProcess = spawn("Xvfb", [display, "-screen", "0", "1920x1080x24"], {
          stdio: "ignore",
          detached: true,
        });

        await new Promise((resolve) => setTimeout(resolve, 100));

        if (xvfb.exitCode === null) {
          startedXvfb = xvfb;
          startedDisplay = display;
          if (xvfb.pid) {
            xvfbPids.add(xvfb.pid);
          }
          break;
        }
      }

      if (!startedXvfb || !startedDisplay) {
        console.log(`Xvfb failed to start after ${maxAttempts} attempts, using existing display`);
        await use(process.env.DISPLAY ?? ":0");
        return;
      }

      await use(startedDisplay);

      if (startedXvfb.pid) {
        xvfbPids.delete(startedXvfb.pid);
        try {
          process.kill(startedXvfb.pid, "SIGTERM");
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

  customSettings:
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      await use({});
    },

  userDataDir: async ({ cachePath, customSettings }, use) => {
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
        "jjx.pollIntervalSeconds": 5,
        "window.dialogStyle": "custom",
        "window.autoDetectColorScheme": false,
        ...customSettings,
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
        ...(process.platform === "win32" ? ["--window-size=1920,1080"] : []),
        `--extensionDevelopmentPath=${extensionPath}`,
        `--extensions-dir=${path.join(cachePath, "extensions")}`,
        `--user-data-dir=${userDataDir}`,
        testRepo.repoPath,
      ],
      env: { ...process.env, DISPLAY: xvfbDisplay },
    });

    const workbox = await electronApp.firstWindow();
    if (process.platform === "win32") {
      await workbox.setViewportSize({ width: 1920, height: 1080 });
    }
    await use(workbox);
    await electronApp.close();
  },

  scmView: async ({ workbox }, use) => {
    await workbox.locator(".monaco-workbench").waitFor();
    await workbox.getByRole("tab", { name: /Source Control/i }).click();
    const scmView = workbox.locator(".sidebar").filter({ hasText: /JJ Graph/i });
    await scmView.waitFor();
    await use(scmView);
  },

  graphFrame: async ({ scmView, workbox }, use) => {
    const graphHeader = scmView.getByRole("button", { name: /JJ Graph/i });
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

  opLog: async ({ scmView }, use) => {
    const opLogHeader = scmView.getByRole("button", { name: /Operation Log/ });
    await opLogHeader.click();
    const opLogPane = scmView.locator(".pane", { hasText: "Operation Log" });
    await expect(opLogPane).toBeVisible();
    await use(opLogPane);
  },
});

export async function handleEditor(workbox: Page, expectedContent: string, newContent: string) {
  const editor = workbox.locator('.monaco-editor[role="code"][data-uri*=".jj"]');
  await pwExpect(editor).toBeVisible();
  await editor.click();
  if (expectedContent !== "") {
    await pwExpect(editor.getByText(expectedContent)).toBeVisible();
  }
  await workbox.keyboard.press("Control+a");
  await workbox.keyboard.type(newContent);
  await workbox.keyboard.press("Control+s");
  await pwExpect(workbox.locator(".tab.active")).not.toHaveClass(/dirty/);
  await workbox.keyboard.press("Control+w");
  await pwExpect(editor).toBeHidden();
}

export async function waitForSCMView(
  workbox: Page,
  workingCopy: string[],
  firstParentCommit: string[],
  selectedCommit?: string[],
): Promise<Locator> {
  const scmView = workbox.locator(".scm-view").first();
  await scmView.waitFor();

  const scmTree = workbox.getByRole("tree", { name: "Source Control Management" });

  async function waitForFilesInSection(sectionLabel: string, files: string[]) {
    if (files.length === 0) {
      return;
    }
    await expect(async () => {
      const sectionFiles = await scmTree.evaluate(
        (el, args) => {
          const items = Array.from(el.querySelectorAll("[role='treeitem']"));
          let foundSection = false;
          let inSection = false;
          const foundFiles: string[] = [];
          for (const item of items) {
            const level = item.getAttribute("aria-level");
            const label = item.getAttribute("aria-label") ?? "";
            if (level === "1") {
              if (!foundSection && label.includes(args.sectionLabel)) {
                foundSection = true;
                inSection = true;
              } else {
                inSection = false;
              }
            } else if (level === "2" && inSection) {
              const fileName = label.split(",")[0].trim();
              if (fileName) {
                foundFiles.push(fileName);
              }
            }
          }
          return foundSection ? foundFiles : null;
        },
        { sectionLabel },
      );
      expect(sectionFiles).not.toBeNull();
      expect(sectionFiles).toEqual(expect.arrayContaining(files));
    }).toPass();
  }

  await waitForFilesInSection("Working Copy", workingCopy);
  await waitForFilesInSection("Parent Commit", firstParentCommit);
  if (selectedCommit) {
    await waitForFilesInSection("Selected Commit", selectedCommit);
  }

  return scmView;
}

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
