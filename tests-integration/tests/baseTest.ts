import {
  test as base,
  type Page,
  type Frame,
  type TestInfo,
  _electron,
  expect as pwExpect,
  Locator,
} from "@playwright/test";
import { getVscodePath } from "../globalSetup";
import { expect } from "@playwright/test";
export { expect };
import path from "path";
import os from "os";
import fs from "fs";
import { execSync, spawn, type ChildProcess } from "child_process";
import { TestRepo, newTestRepo } from "../testRepo";

export { TestRepo, newTestRepo };

export const mod = process.platform === "darwin" ? "Meta" : "Control";

export const cursorTop = process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home";
export const cursorBottom = process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End";

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
  workspaceFolders: string[];
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

  workspaceFolders: [
    async ({ testRepo }, use) => {
      await use([testRepo.repoPath]);
    },
    { scope: "test" },
  ],

  userDataDir: async ({ cachePath, customSettings }, use) => {
    const userDataDir = path.join(cachePath, "user-data");
    const userDir = path.join(userDataDir, "User");
    await fs.promises.mkdir(userDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(userDir, "settings.json"),
      JSON.stringify({
        "git.enabled": false,
        "chat.disableAIFeatures": true,
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

  workbox: async ({ cachePath, vscodePath, workspaceFolders, userDataDir, xvfbDisplay }, use, testInfo) => {
    const extensionPath = path.resolve(__dirname, "..", "..");

    let workspaceArg = workspaceFolders[0];
    if (workspaceFolders.length > 1) {
      workspaceArg = path.join(cachePath, "multi-root.code-workspace");
      await fs.promises.writeFile(
        workspaceArg,
        JSON.stringify({ folders: workspaceFolders.map((folder) => ({ path: folder })) }),
      );
    }

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
        ...(process.platform === "win32" || process.platform === "darwin" ? ["--window-size=1920,1080"] : []),
        "--log=trace",
        `--extensionDevelopmentPath=${extensionPath}`,
        `--extensions-dir=${path.join(cachePath, "extensions")}`,
        `--user-data-dir=${userDataDir}`,
        workspaceArg,
      ],
      env: { ...process.env, DISPLAY: xvfbDisplay },
    });

    const workbox = await electronApp.firstWindow();
    if (process.platform === "win32" || process.platform === "darwin") {
      await workbox.setViewportSize({ width: 1920, height: 1080 });
    }
    await use(workbox);
    await electronApp.close();

    if (testInfo.status !== "passed") {
      await dumpExtensionLogs(userDataDir, testInfo);
    }
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

export async function runCommand(workbox: Page, commandName: string) {
  await workbox.keyboard.press(`${mod}+Shift+P`);
  const quickInput = workbox.locator(".quick-input-widget input").first();
  await expect(quickInput).toBeVisible();
  await quickInput.fill(`>${commandName}`);
  const item = workbox
    .locator(".quick-input-widget .monaco-list-row")
    .filter({ hasText: new RegExp(commandName) })
    .first();
  await expect(item).toBeVisible();
  await item.click();
}

export async function handleEditor(workbox: Page, expectedContent: string, newContent: string) {
  const editor = workbox.locator('.monaco-editor[role="code"][data-uri*=".jj"]');
  await pwExpect(editor).toBeVisible();
  await editor.click();
  if (expectedContent !== "") {
    await pwExpect(editor.getByText(expectedContent)).toBeVisible();
  }
  await workbox.keyboard.press(`${mod}+a`);
  await workbox.keyboard.type(newContent);
  await workbox.keyboard.press(`${mod}+s`);
  await pwExpect(workbox.locator(".tab.active")).not.toHaveClass(/dirty/);
  await workbox.keyboard.press(`${mod}+w`);
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

export async function clickPillMenuItem(graphFrame: Frame, pill: Locator, text: string) {
  await expect(async () => {
    await pill.click({ button: "right" });
    const menu = graphFrame.locator("#pill-context-menu");
    const item = menu.locator("[data-action]").filter({ hasText: text });
    await expect(item).toBeVisible();
    await item.click();
    await expect(menu).not.toBeVisible();
  }).toPass();
}

// Closes the chat window and increases the size of the jj graph
async function increaseJJVisibleSize(workbox: Page) {
  // Hide auxiliary side bar (chat window)
  await workbox.keyboard.press(`${mod}+Alt+b`);

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

async function readLogFile(filePath: string): Promise<string | null> {
  try {
    return await fs.promises.readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

// Finds the newest subdirectory of `dir`, returns absolute path or null.
async function newestSubdir(dir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return null;
  }
  let newest: { name: string; mtime: number } | null = null;
  for (const name of entries) {
    const full = path.join(dir, name);
    try {
      const stat = await fs.promises.stat(full);
      if (stat.isDirectory() && (!newest || stat.mtimeMs > newest.mtime)) {
        newest = { name, mtime: stat.mtimeMs };
      }
    } catch {
      // ignore
    }
  }
  return newest ? path.join(dir, newest.name) : null;
}

// Recursively collects all .log files under `root`.
async function collectLogFiles(root: string): Promise<string[]> {
  const stack = [root];
  const results: string[] = [];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".log")) {
        results.push(full);
      }
    }
  }
  return results;
}

// Returns true if a log file (by path relative to the session dir) is the
// "Jujutsu X" extension's output channel log.
function isJujutsuXChannelLog(relPath: string): boolean {
  const normalized = relPath.split(path.sep).join("/");
  return /jjx\.jjx\//.test(normalized) || /Jujutsu X/i.test(normalized);
}

// Reads VS Code's on-disk "Jujutsu X" output channel log and surfaces it after a
// failing test. VS Code writes the channel to
// `<userDataDir>/logs/<session>/window*/exthost/jjx.jjx/Jujutsu X.log`. VS Code
// is launched with `--log=trace`, so logger.trace()/debug() lines are captured.
async function dumpExtensionLogs(userDataDir: string, testInfo: TestInfo): Promise<void> {
  const logsRoot = path.join(userDataDir, "logs");
  const sessionDir = await newestSubdir(logsRoot);
  if (!sessionDir) {
    return;
  }

  const channelLogs = (await collectLogFiles(sessionDir))
    .filter((f) => isJujutsuXChannelLog(path.relative(sessionDir, f)))
    .sort();
  if (channelLogs.length === 0) {
    return;
  }

  const sections: string[] = [];
  sections.push(
    `\n========== Jujutsu X output channel logs (test: ${testInfo.title}, status: ${testInfo.status}) ==========`,
  );

  for (const file of channelLogs) {
    const content = await readLogFile(file);
    if (content && content.trim().length > 0) {
      sections.push(`----- ${path.relative(sessionDir, file)} -----\n${content.trimEnd()}`);
    }
  }

  const combined = sections.join("\n\n");
  console.log(combined);
  await testInfo.attach("jjx-output-channel", { body: combined, contentType: "text/plain" });
}
