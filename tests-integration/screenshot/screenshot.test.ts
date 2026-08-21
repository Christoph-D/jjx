import { test, expect, TestRepo, newTestRepo } from "../tests/base-test";
import path from "path";
import fs from "fs/promises";
import { execSync } from "child_process";
import { Frame, Locator, Page } from "@playwright/test";

// Use the system jj identity for the screenshots to match the identity seen by the extension under test.
TestRepo.userName = null;
TestRepo.userEmail = null;

const TEMP_SCREENSHOT = "/tmp/jjx-screenshot.png";
const OUTPUT_DIR = path.resolve(__dirname, "..", "..", "images");
const ZOOM_LEVEL = 1;

async function addSettings(userDataDir: string, settings: Record<string, unknown>) {
  const userDir = path.join(userDataDir, "User");
  const settingsPath = path.join(userDir, "settings.json");
  const s = JSON.parse(await fs.readFile(settingsPath, "utf-8")) as Record<string, unknown>;
  for (const [key, value] of Object.entries(settings)) {
    s[key] = value;
  }
  await fs.writeFile(settingsPath, JSON.stringify(s));
}

async function initializeSettings(userDataDir: string, zoomLevel: number) {
  await addSettings(userDataDir, {
    "window.zoomLevel": zoomLevel,
    "workbench.colorTheme": "Dark+",
    "jjx.graphStyle": "compact",
  });
}

function scaleToZoomLevel(p: number) {
  return p * Math.pow(1.2, ZOOM_LEVEL);
}

async function screenshot(
  workbox: Page,
  filename: string,
  clip: { x: number; y: number; width: number; height: number },
) {
  const screenshot = await workbox.screenshot({ clip });
  await fs.writeFile(TEMP_SCREENSHOT, screenshot);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, filename);
  execSync(`convert "${TEMP_SCREENSHOT}" -strip -define png:compression-level=9 "${outputPath}"`);
  execSync(`pngcrush -q -ow "${outputPath}"`);
}

async function screenshotClipAfter(
  workbox: Page,
  filename: string,
  clip: { x: number; y: number; width: number; height: number },
) {
  const fullScreenshot = await workbox.screenshot();
  const fullScreenshotPath = "/tmp/jjx-full-screenshot.png";
  await fs.writeFile(fullScreenshotPath, fullScreenshot);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(OUTPUT_DIR, filename);
  const { x, y, width, height } = clip;
  execSync(
    `convert "${fullScreenshotPath}" -crop ${width}x${height}+${x}+${y} +repage -strip -define png:compression-level=9 "${outputPath}"`,
  );
  execSync(`pngcrush -q -ow "${outputPath}"`);
}

async function initializeExampleRepo(testRepo: TestRepo) {
  await testRepo.commitFile("a1", "", "Elided commit");
  const elidedCommit = await testRepo.commitFile("a2", "", "Old change");
  await testRepo.commitFile("a2", "", "Elided commit");
  const elidedCommit2 = await testRepo.commitFile("a3", "", "Elided commit");
  await testRepo.jjCommand(["new", elidedCommit]);
  await testRepo.commitFile("a4", "", "Old branch");
  await testRepo.jjCommand(["new", elidedCommit2]);
  const commit1 = await testRepo.commitFile("a", "", "Immutable commit");
  const commit2 = await testRepo.commitFile("b", "", "chore: Bump to v1.1.0");
  await testRepo.jjCommand(["tag", "set", "v1.1.0", "-r", commit2]);
  await testRepo.jjCommand(["new", commit1]);
  await testRepo.commitFile("d", "", "feat: Some feature");
  const commitE = await testRepo.commitFile("e", "", "fix: Fix some bug (1)");
  await testRepo.commitFile("e2", "", "fix: Fix some bug (2)");
  await testRepo.commitFile("e3", "", "fix: Another bug");
  await testRepo.jjCommand(["bookmark", "create", "dev-branch"]);
  await testRepo.commitFile("e4", "", "test: Add a test");
  await testRepo.jjCommand(["new", commit2, commitE]);
  await testRepo.commitFile("f", "", "merge into main");
  await testRepo.commitFile("g", "", "fix: Critical bugfix");
  await testRepo.commitFile("h", "", "docs: Prepare for release");
}

test("take screenshot of jj graph for readme", async ({ userDataDir, graphFrame, testRepo, workbox }) => {
  await initializeSettings(userDataDir, ZOOM_LEVEL);
  await initializeExampleRepo(testRepo);
  await workbox.mouse.move(0, 0);

  const nodes = graphFrame.locator("#nodes > div");

  await workbox.waitForTimeout(1000);
  await workbox.setViewportSize({ width: 1920, height: 1080 });

  const graphHeader = workbox.getByRole("button", { name: /JJ Graph.*Section/i }).first();
  const headerBox = await graphHeader.boundingBox();
  if (!headerBox) {
    throw new Error("Graph header not found");
  }

  const sideBar = workbox.locator(".part.sidebar");
  const sideBarBox = await sideBar.boundingBox();
  if (!sideBarBox) {
    throw new Error("Sidebar not found");
  }

  const clip = {
    x: scaleToZoomLevel(headerBox.x),
    y: scaleToZoomLevel(headerBox.y) + 1,
    width: scaleToZoomLevel(sideBarBox.x + sideBarBox.width - headerBox.x),
    height: 390,
  };

  await screenshot(workbox, "compact-view.png", clip);

  await addSettings(userDataDir, { "workbench.colorTheme": "Light+" });
  await workbox.waitForTimeout(1000);
  await screenshot(workbox, "compact-view-light.png", clip);

  await addSettings(userDataDir, {
    "workbench.colorTheme": "Dark+",
    "jjx.graphStyle": "full",
  });
  await expect(graphFrame.locator('[data-mode="compact"]')).toHaveCount(0);
  await screenshot(workbox, "full-view.png", {
    x: clip.x,
    y: clip.y,
    width: clip.width,
    height: 500,
  });

  await addSettings(userDataDir, { "jjx.graphStyle": "compact" });
  await expect(graphFrame.locator('[data-mode="compact"]').first()).toBeVisible();

  const secondCommit = nodes.nth(1);
  await secondCommit.hover();
  await workbox.waitForTimeout(500); // hover animation
  await secondCommit.click({ button: "right", position: { x: 80, y: 2 } });
  const createBookmarkEntry = graphFrame.locator('[data-action="createBookmark"]');
  await expect(createBookmarkEntry).toBeVisible();
  await screenshot(workbox, "context-menu.png", {
    x: clip.x,
    y: clip.y,
    width: 320,
    height: 440,
  });

  // Make the jj graph horizontally larger
  const sash = workbox.locator(".monaco-sash.vertical").nth(1);
  const sashBox = await sash.boundingBox();
  if (sashBox) {
    const sashCenterX = sashBox.x + sashBox.width / 2;
    const sashCenterY = sashBox.y + sashBox.height / 2;
    await workbox.mouse.move(sashCenterX, sashCenterY);
    await workbox.mouse.down();
    await workbox.mouse.move(sashCenterX + 50, sashCenterY);
    await workbox.mouse.up();
    await workbox.mouse.move(0, 0);
  }

  await secondCommit.click({ position: { x: 20, y: 2 } });
  await expect(createBookmarkEntry).toBeHidden();

  const rebaseTarget = nodes.nth(3);
  await secondCommit.dragTo(rebaseTarget);
  const rebaseItem = graphFrame.locator('[data-action="rebase"]');
  await expect(rebaseItem).toBeVisible();
  await rebaseItem.hover();

  const rebaseOntoItem = graphFrame.locator('[data-action="rebaseOnto"]');
  await expect(rebaseOntoItem).toBeVisible();

  await workbox.waitForTimeout(500);
  await screenshot(workbox, "rebase-menu.png", {
    x: clip.x,
    y: clip.y,
    width: 410,
    height: 390,
  });
});

test.only("take screenshot of conflicts", async ({ userDataDir, scmView, graphFrame, testRepo, workbox }) => {
  const sash = scmView.locator(".monaco-sash.horizontal").first();
  const sashBox = await sash.boundingBox();
  if (!sashBox) {
    throw new Error("Failed to resize jj graph");
  }
  const sashCenterX = sashBox.x + sashBox.width / 2;
  const sashCenterY = sashBox.y + sashBox.height / 2;
  await workbox.mouse.move(sashCenterX, sashCenterY);
  await workbox.mouse.down();
  await workbox.mouse.move(sashCenterX, sashCenterY - 190);
  await workbox.mouse.up();
  await workbox.mouse.move(0, 0);

  await workbox.setViewportSize({ width: 1920, height: 1080 });
  await initializeSettings(userDataDir, ZOOM_LEVEL);

  await testRepo.commitFile("file.txt", "content: A", "write A");
  await testRepo.jjCommand(["new", "root()"]);
  await testRepo.commitFile("file.txt", "content: B", "write B");
  await testRepo.jjCommand(["new", "root()+", "-m", "merge A+B"]);

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);
  await expect(nodes.locator('[data-role="conflict-indicator"]')).toHaveCount(1);

  const conflicts = scmView.getByRole("treeitem").filter({ hasText: "file.txt" });
  await expect(conflicts).toHaveCount(2);

  const graphHeader = workbox.getByRole("button", { name: /JJ Graph.*Section/i }).first();
  const headerBox = await graphHeader.boundingBox();
  if (!headerBox) {
    throw new Error("Graph header not found");
  }

  const sideBar = workbox.locator(".part.sidebar");
  const sideBarBox = await sideBar.boundingBox();
  if (!sideBarBox) {
    throw new Error("Sidebar not found");
  }

  const clip = {
    x: scaleToZoomLevel(headerBox.x),
    y: 45,
    width: scaleToZoomLevel(sideBarBox.x + sideBarBox.width - headerBox.x),
    height: 350,
  };

  await screenshot(workbox, "conflicts.png", clip);

  await workbox.setViewportSize({ width: 1000, height: 600 });

  await conflicts.first().click();
  const mergeEditorLeft = workbox.locator('.monaco-editor[role="code"][data-uri*="left_file.txt"]');
  await expect(mergeEditorLeft).toBeVisible();

  await screenshot(workbox, "merge-editor.png", {
    x: 0,
    y: 0,
    width: 1000,
    height: 600,
  });
});

/** Right-clicks `node` in the graph, picks "Split..." and returns the frame of the opened Split view. */
async function openSplitView(workbox: Page, graphFrame: Frame, node: Locator): Promise<Frame> {
  await node.click({ button: "right" });
  const splitItem = graphFrame.locator('[data-action="split"]');
  await expect(splitItem).toBeVisible();
  await splitItem.click();

  let splitFrame: Frame | undefined;
  await expect(async () => {
    for (const frame of workbox.frames()) {
      try {
        if ((await frame.locator(".splitRoot").count()) > 0) {
          splitFrame = frame;
          return;
        }
      } catch {
        // The frame can be mid-navigation while the webview (re)loads; just try the next.
      }
    }
    throw new Error("Split view frame not ready");
  }).toPass();
  return splitFrame!;
}

/** Expands a file's hunk list by clicking its chevron; files start collapsed in the split view. */
async function expandSplitFile(row: Locator): Promise<void> {
  await row.locator(".splitFileRow > .splitChevron").click();
}

test("take screenshot of split view", async ({ userDataDir, graphFrame, testRepo, workbox }) => {
  await initializeSettings(userDataDir, ZOOM_LEVEL);

  // Base commit: a 20-line file, a file destined for deletion, and one destined for a rename.
  const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
  await testRepo.writeFile("some-file.txt", `${lines.join("\n")}\n`);
  await testRepo.writeFile("deleted.txt", "Obsolete line 1\nObsolete line 2\nObsolete line 3\n");
  await testRepo.writeFile("old.txt", "Renamed content\n");
  await testRepo.commit("initial commit");

  // The commit to split: lines 3 and 4 modified, deleted.txt removed, old.txt renamed to new.txt.
  lines[2] = "Line 3 (modified)";
  lines[3] = "Line 4 (modified)";
  await testRepo.writeFile("some-file.txt", `${lines.join("\n")}\n`);
  await testRepo.deleteFile("deleted.txt");
  await testRepo.deleteFile("old.txt");
  await testRepo.writeFile("new.txt", "Renamed content\n");
  await testRepo.commit("refactor: Reorganize project files");

  await workbox.waitForTimeout(1000);
  await workbox.setViewportSize({ width: 1920, height: 1080 });

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  // Narrow the editor area so the split view panel fits the screenshot nicely.
  const sash = workbox.locator(".monaco-sash.vertical").nth(1);
  const sashBox = await sash.boundingBox();
  if (!sashBox) {
    throw new Error("Failed to resize editor area");
  }
  const sashCenterX = sashBox.x + sashBox.width / 2;
  const sashCenterY = sashBox.y + sashBox.height / 2;
  await workbox.mouse.move(sashCenterX, sashCenterY);
  await workbox.mouse.down();
  await workbox.mouse.move(sashCenterX + 350, sashCenterY);
  await workbox.mouse.up();
  await workbox.mouse.move(0, 0);

  const splitFrame = await openSplitView(workbox, graphFrame, nodes.nth(1));
  await expect(splitFrame.locator(".splitFile")).toHaveCount(3);
  await expect(splitFrame.locator(".splitHeaderDescription")).toHaveText("refactor: Reorganize project files");

  // The deleted file stays collapsed and the pure rename is a leaf whose checkbox covers the rename.
  const deletedFile = splitFrame.locator(".splitFile").filter({ hasText: "deleted.txt" });
  await expect(deletedFile.locator(".splitStatus")).toHaveText("D");
  await expect(deletedFile.locator(".splitFileRow .splitLeafDetail")).toHaveText("-3");
  const renamedFile = splitFrame.locator(".splitFile").filter({ hasText: "new.txt" });
  await expect(renamedFile.locator(".splitLeafDetail", { hasText: "←" })).toContainText("← old.txt");

  // Files start collapsed; expand the modified file so its hunk shows with every line.
  const someFile = splitFrame.locator(".splitFile").filter({ hasText: "some-file.txt" });
  await expandSplitFile(someFile);
  await expect(someFile.locator(".splitHunk")).toHaveCount(1);
  await expect(someFile.locator(".splitLineRow")).toHaveCount(4);

  await workbox.mouse.move(0, 0);

  const splitRootBox = await splitFrame.locator(".splitRoot").boundingBox();
  const someFileBox = await someFile.boundingBox();
  if (!splitRootBox || !someFileBox) {
    throw new Error("Split view not laid out");
  }

  await screenshot(workbox, "split-view.png", {
    x: scaleToZoomLevel(splitRootBox.x),
    y: scaleToZoomLevel(splitRootBox.y) + 1,
    width: scaleToZoomLevel(splitRootBox.width / 2),
    height: scaleToZoomLevel(someFileBox.y + someFileBox.height - splitRootBox.y) + 12,
  });
});

test("take screenshot of divergent commits", async ({ userDataDir, graphFrame, testRepo, workbox }) => {
  await workbox.setViewportSize({ width: 1920, height: 1080 });
  await initializeSettings(userDataDir, ZOOM_LEVEL);

  await testRepo.writeFile("file.txt", "content");
  await testRepo.jjCommand(["describe", "-m", "commit"]);
  const initialCommit = await testRepo.commitFile("file.txt", "new content", "commit");
  await testRepo.jjCommand(["new", `${initialCommit}/1`]);

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);
  await expect(nodes.filter({ hasText: "/0" })).toBeVisible();

  const graphHeader = workbox.getByRole("button", { name: /JJ Graph.*Section/i }).first();
  const headerBox = await graphHeader.boundingBox();
  if (!headerBox) {
    throw new Error("Graph header not found");
  }

  const sideBar = workbox.locator(".part.sidebar");
  const sideBarBox = await sideBar.boundingBox();
  if (!sideBarBox) {
    throw new Error("Sidebar not found");
  }

  const clip = {
    x: scaleToZoomLevel(headerBox.x),
    y: scaleToZoomLevel(headerBox.y) + 1,
    width: scaleToZoomLevel(sideBarBox.x + sideBarBox.width - headerBox.x),
    height: 130,
  };

  await screenshot(workbox, "divergent-commits.png", clip);
});

test("take screenshot of workspace labels", async ({ userDataDir, graphFrame, testRepo, workbox }) => {
  await workbox.setViewportSize({ width: 1920, height: 1080 });
  await workbox.mouse.move(0, 0);
  await initializeSettings(userDataDir, ZOOM_LEVEL);
  await testRepo.commitFile("initial.txt", "", "initial commit");

  const workspace2Path = path.join(testRepo.repoPath, "workspace2");
  await testRepo.jjCommand(["workspace", "add", workspace2Path]);
  const workspace2 = new TestRepo(workspace2Path);
  await workspace2.writeFile("some-file", "");
  await workspace2.jjCommand(["describe", "-m", "experiment"]);

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);
  await expect(nodes.filter({ hasText: "experiment" })).toBeVisible();

  const graphHeader = workbox.getByRole("button", { name: /JJ Graph.*Section/i }).first();
  const headerBox = await graphHeader.boundingBox();
  if (!headerBox) {
    throw new Error("Graph header not found");
  }

  const sideBar = workbox.locator(".part.sidebar");
  const sideBarBox = await sideBar.boundingBox();
  if (!sideBarBox) {
    throw new Error("Sidebar not found");
  }

  const clip = {
    x: scaleToZoomLevel(headerBox.x),
    y: scaleToZoomLevel(headerBox.y) + 1,
    width: scaleToZoomLevel(sideBarBox.x + sideBarBox.width - headerBox.x),
    height: 130,
  };

  await screenshot(workbox, "workspaces.png", clip);
});

test("take screenshot of bookmark upload", async ({ userDataDir, graphFrame, testRepo, workbox }) => {
  await workbox.setViewportSize({ width: 1920, height: 1080 });
  await workbox.mouse.move(0, 0);
  await initializeSettings(userDataDir, ZOOM_LEVEL);
  await testRepo.commitFile("initial.txt", "", "initial commit");

  const remoteRepoPath = path.join(testRepo.repoPath, "origin");
  await newTestRepo(remoteRepoPath);
  await testRepo.jjCommand(["git", "remote", "add", "origin", "origin"]);
  await testRepo.jjCommand(["bookmark", "create", "main", "-r", "@-"]);
  await testRepo.jjCommand(["bookmark", "track", "main", "--remote=origin"]);

  const unsyncedPill = graphFrame.locator('[data-bookmark="main"][data-unsynced]');
  await expect(unsyncedPill).toBeVisible();
  const uploadIcon = unsyncedPill.locator('[data-role="push-icon"]');
  await expect(uploadIcon).toBeVisible();
  await uploadIcon.hover();
  await workbox.waitForTimeout(500);

  const graphHeader = workbox.getByRole("button", { name: /JJ Graph.*Section/i }).first();
  const headerBox = await graphHeader.boundingBox();
  if (!headerBox) {
    throw new Error("Graph header not found");
  }

  const sideBar = workbox.locator(".part.sidebar");
  const sideBarBox = await sideBar.boundingBox();
  if (!sideBarBox) {
    throw new Error("Sidebar not found");
  }

  const clip = {
    x: scaleToZoomLevel(headerBox.x),
    y: scaleToZoomLevel(headerBox.y) + 1,
    width: scaleToZoomLevel(sideBarBox.x + sideBarBox.width - headerBox.x),
    height: 100,
  };

  await screenshot(workbox, "unsynced-bookmark.png", clip);

  await unsyncedPill.click({ button: "right", position: { x: 35, y: 15 } });
  const deleteBookmarkEntry = graphFrame.locator('[data-action="deleteRef"]');
  await expect(deleteBookmarkEntry).toBeVisible();

  const clip2 = {
    x: scaleToZoomLevel(headerBox.x),
    y: scaleToZoomLevel(headerBox.y) + 1,
    width: scaleToZoomLevel(sideBarBox.x + sideBarBox.width - headerBox.x),
    height: 220,
  };

  await screenshot(workbox, "bookmark-context-menu.png", clip2);
});

test("take screenshot of oplog for readme", async ({ userDataDir, scmView, opLog, testRepo, workbox }) => {
  await initializeSettings(userDataDir, ZOOM_LEVEL);
  await initializeExampleRepo(testRepo);

  // Click elsewhere to remove the highlight frame around the op log header
  const scmViewTitle = scmView.locator(".title-label");
  await scmViewTitle.click();

  // Make the op log larger
  const sash = workbox.locator(".monaco-sash.horizontal.maximum").nth(1);
  const sashBox = await sash.boundingBox();
  if (!sashBox) {
    throw new Error("Failed to resize op log vertically");
  }
  const sashCenterX = sashBox.x + sashBox.width / 2;
  const sashCenterY = sashBox.y + sashBox.height / 2;
  await workbox.mouse.move(sashCenterX, sashCenterY);
  await workbox.mouse.down();
  await workbox.mouse.move(sashCenterX, sashCenterY - 300);
  await workbox.mouse.up();

  const sashVertical = workbox.locator(".monaco-sash.vertical").nth(1);
  const sashVBox = await sashVertical.boundingBox();
  if (!sashVBox) {
    throw new Error("Failed to resize op log horizontally");
  }
  const sashVCenterX = sashVBox.x + sashVBox.width / 2;
  const sashVCenterY = sashVBox.y + sashVBox.height / 2;
  await workbox.mouse.move(sashVCenterX, sashVCenterY);
  await workbox.mouse.down();
  await workbox.mouse.move(sashVCenterX + 300, sashVCenterY);
  await workbox.mouse.up();

  const opLogEntries = opLog
    .locator(".pane-body")
    .getByRole("treeitem")
    .filter({ hasText: /jj.* commit -m 'docs/ });
  await expect(opLogEntries).toHaveCount(2);
  await opLogEntries.first().hover();

  const opLogBox = await opLog.boundingBox();
  if (!opLogBox) {
    throw new Error("Op log not found");
  }

  const sideBar = workbox.locator(".part.sidebar");
  const sideBarBox = await sideBar.boundingBox();
  if (!sideBarBox) {
    throw new Error("Sidebar not found");
  }

  const clip = {
    x: scaleToZoomLevel(opLogBox.x),
    y: scaleToZoomLevel(opLogBox.y) + 2,
    width: scaleToZoomLevel(sideBarBox.x + sideBarBox.width - opLogBox.x),
    height: 90,
  };

  await screenshotClipAfter(workbox, "oplog.png", clip);
});
