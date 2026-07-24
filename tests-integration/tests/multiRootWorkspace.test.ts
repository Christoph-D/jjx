import fs from "fs";
import os from "os";
import path from "path";
import type { Locator, Page } from "@playwright/test";
import { test as base, expect, type TestRepo, newTestRepo } from "./baseTest";

// Opens a multi-root workspace with two independent jj repositories so that
// repository selection across the graph view, operation log view, and SCM view
// can be exercised.
const test = base.extend<{ repoA: TestRepo; repoB: TestRepo }>({
  repoA: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jjx-multiroot-a-"));
      const repo = await newTestRepo(path.join(tempDir, "repo-alpha"));
      await use(repo);
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    },
    { scope: "test" },
  ],
  repoB: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "jjx-multiroot-b-"));
      const repo = await newTestRepo(path.join(tempDir, "repo-beta"));
      await use(repo);
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    },
    { scope: "test" },
  ],
  workspaceFolders: [
    async ({ repoA, repoB }, use) => {
      await use([repoA.repoPath, repoB.repoPath]);
    },
    { scope: "test" },
  ],
});

function graphPaneHeader(scmView: Locator): Locator {
  return scmView.locator(".pane-header", { hasText: "JJ Graph" }).first();
}

function opLogPaneHeader(scmView: Locator): Locator {
  return scmView.locator(".pane-header", { hasText: "Operation Log" }).first();
}

async function openRepoPicker(workbox: Page, paneHeader: Locator): Promise<Locator> {
  await paneHeader.getByRole("button", { name: "Select Repository" }).click();
  const quickInput = workbox.locator(".quick-input-widget");
  await expect(quickInput).toBeVisible();
  return quickInput;
}

test("graph webview shows the selected repo and the repo picker lists both repos", async ({
  workbox,
  scmView,
  graphFrame,
  repoA,
  repoB,
}) => {
  await repoA.commitFile("alpha.txt", "alpha", "alpha commit one");
  await repoB.commitFile("beta.txt", "beta", "beta commit one");

  // The first workspace folder is the initially selected repository.
  await expect(graphFrame.getByText("alpha commit one")).toBeVisible();
  await expect(graphPaneHeader(scmView).locator("h3.title")).toHaveText(/repo-alpha/);

  const picker = await openRepoPicker(workbox, graphPaneHeader(scmView));
  await expect(picker.locator("input").first()).toHaveAttribute("placeholder", "Select a Repository");
  await expect(picker.getByRole("option")).toHaveCount(2);
  await expect(picker.getByRole("option", { name: repoA.repoPath })).toBeVisible();
  await expect(picker.getByRole("option", { name: repoB.repoPath })).toBeVisible();

  await workbox.keyboard.press("Escape");
});

test("switching the selected repo via the graph picker refreshes the graph", async ({
  workbox,
  scmView,
  graphFrame,
  repoA,
  repoB,
}) => {
  await repoA.commitFile("alpha.txt", "alpha", "alpha commit one");
  await repoB.commitFile("beta.txt", "beta", "beta commit one");

  await expect(graphFrame.getByText("alpha commit one")).toBeVisible();

  const picker = await openRepoPicker(workbox, graphPaneHeader(scmView));
  await picker.getByRole("option", { name: repoB.repoPath }).click();

  // The graph refreshes to show the other repository's commits.
  await expect(graphFrame.getByText("beta commit one")).toBeVisible();
  await expect(graphFrame.getByText("alpha commit one")).toHaveCount(0);
  await expect(graphPaneHeader(scmView).locator("h3.title")).toHaveText(/repo-beta/);
});

test("operation log repo picker lists both repos and switching refreshes the operation log", async ({
  workbox,
  scmView,
  opLog,
  repoA,
  repoB,
}) => {
  await repoA.commitFile("alpha.txt", "alpha", "alpha commit one");
  await repoB.commitFile("beta.txt", "beta", "beta commit one");

  await expect(opLogPaneHeader(scmView).locator("h3.title")).toHaveText(/repo-alpha/);

  const picker = await openRepoPicker(workbox, opLogPaneHeader(scmView));
  await expect(picker.locator("input").first()).toHaveAttribute("placeholder", "Select a Repository");
  await expect(picker.getByRole("option")).toHaveCount(2);
  await expect(picker.getByRole("option", { name: repoA.repoPath })).toBeVisible();
  await expect(picker.getByRole("option", { name: repoB.repoPath })).toBeVisible();
  await picker.getByRole("option", { name: repoB.repoPath }).click();

  // The operation log refreshes to show the other repository's history.
  await expect(opLogPaneHeader(scmView).locator("h3.title")).toHaveText(/repo-beta/);
  await expect(opLog.locator('[role="treeitem"]').filter({ hasText: "beta commit one" }).first()).toBeVisible();
  await expect(opLog.locator('[role="treeitem"]').filter({ hasText: "alpha commit one" })).toHaveCount(0);
});

test("SCM view shows both repositories as separate source controls", async ({ scmView, repoA, repoB }) => {
  await repoA.commitFile("alpha.txt", "alpha", "alpha commit one");
  await repoB.commitFile("beta.txt", "beta", "beta commit one");

  const scmTree = scmView.getByRole("tree", { name: "Source Control Management" });
  const repoItems = scmTree.locator('[role="treeitem"][aria-level="1"]');
  await expect(repoItems).toHaveCount(2);
  await expect(repoItems.filter({ hasText: "repo-alpha" })).toHaveAttribute("aria-label", /repo-alpha Jujutsu/);
  await expect(repoItems.filter({ hasText: "repo-beta" })).toHaveAttribute("aria-label", /repo-beta Jujutsu/);

  // Each repository tracks its own independent working copy state.
  await expect(
    scmTree.locator('[role="treeitem"][aria-level="2"]').filter({ hasText: "alpha commit one" }),
  ).toBeVisible();
  await expect(
    scmTree.locator('[role="treeitem"][aria-level="2"]').filter({ hasText: "beta commit one" }),
  ).toBeVisible();
});
