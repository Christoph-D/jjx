import { test, expect } from "../tests/baseTest";
import path from "path";
import fs from "fs/promises";
import { execSync } from "child_process";
import { Page } from "@playwright/test";

const TEMP_SCREENSHOT = "/tmp/jjx-screenshot.png";
const OUTPUT_DIR = path.resolve(__dirname, "..", "..", "images");
const ZOOM_LEVEL = 1;

async function addSettings(userDataDir: string, settings: Record<string, any>) {
  const userDir = path.join(userDataDir, "User");
  const settingsPath = path.join(userDir, "settings.json");
  const s = JSON.parse(await fs.readFile(settingsPath, "utf-8"));
  for (const [key, value] of Object.entries(settings)) {
    s[key] = value;
  }
  await fs.writeFile(settingsPath, JSON.stringify(s));
}

async function initializeSettings(userDataDir: string, zoomLevel: number) {
  addSettings(userDataDir, {
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
}

test("take screenshot of jj graph for readme", async ({ userDataDir, graphFrame, testRepo, workbox }) => {
  await initializeSettings(userDataDir, ZOOM_LEVEL);

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
  await expect(graphFrame.locator(".compact")).toHaveCount(0);
  await screenshot(workbox, "full-view.png", {
    x: clip.x,
    y: clip.y,
    width: clip.width,
    height: 500,
  });

  await addSettings(userDataDir, { "jjx.graphStyle": "compact" });
  await expect(graphFrame.locator(".compact").first()).toBeVisible();

  const secondCommit = nodes.nth(1);
  await secondCommit.hover();
  await workbox.waitForTimeout(500); // hover animation
  await secondCommit.click({ button: "right", position: { x: 80, y: 2 } });
  const createBookmarkEntry = graphFrame.locator('.context-menu-item[data-action="createBookmark"]');
  await expect(createBookmarkEntry).toBeVisible();
  await screenshot(workbox, "context-menu.png", {
    x: clip.x,
    y: clip.y,
    width: 320,
    height: 520,
  });

  // Make the jj graph horizontally larger
  const sash = workbox.locator(".monaco-sash.vertical").nth(1);
  const sashBox = await sash.boundingBox();
  if (sashBox) {
    const sashCenterX = sashBox.x + sashBox.width / 2;
    const sashCenterY = sashBox.y + sashBox.height / 2;
    await workbox.mouse.move(sashCenterX, sashCenterY);
    await workbox.mouse.down();
    await workbox.mouse.move(sashCenterX + 30, sashCenterY);
    await workbox.mouse.up();
    await workbox.mouse.move(0, 0);
  }

  await secondCommit.click({ position: { x: 20, y: 2 } });
  await expect(createBookmarkEntry).toBeHidden();

  const rebaseTarget = nodes.nth(3);
  await secondCommit.dragTo(rebaseTarget);
  const rebaseItem = graphFrame.locator('.context-menu-item[data-action="rebase"]');
  await expect(rebaseItem).toBeVisible();
  await rebaseItem.hover();

  const rebaseOntoItem = graphFrame.locator('.context-submenu-item[data-action="rebaseOnto"]');
  await expect(rebaseOntoItem).toBeVisible();

  await workbox.waitForTimeout(500);
  await screenshot(workbox, "rebase-menu.png", {
    x: clip.x,
    y: clip.y,
    width: 390,
    height: 390,
  });
});
