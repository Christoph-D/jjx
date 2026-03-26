import { test, expect, increaseJJVisibleSize } from "../tests/baseTest";
import path from "path";
import fs from "fs/promises";
import { execSync } from "child_process";

const TEMP_SCREENSHOT = "/tmp/jjx-screenshot.png";
const OUTPUT_DIR = path.resolve(__dirname, "..", "..", "images");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "compact-view.png");
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
  });
}

function scaleToZoomLevel(p: number) {
  return p * Math.pow(1.2, ZOOM_LEVEL);
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

  await increaseJJVisibleSize(workbox);
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

  const screenshot = await workbox.screenshot({
    clip: {
      x: scaleToZoomLevel(headerBox.x),
      y: scaleToZoomLevel(headerBox.y) + 1,
      width: scaleToZoomLevel(sideBarBox.x + sideBarBox.width - headerBox.x),
      height: 420,
    },
  });
  await fs.writeFile(TEMP_SCREENSHOT, screenshot);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  execSync(`convert "${TEMP_SCREENSHOT}" -strip -define png:compression-level=9 "${OUTPUT_PATH}"`);
});
