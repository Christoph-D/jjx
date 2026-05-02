import { test, expect, newTestRepo, type TestRepo } from "./baseTest";
import type { Frame, Locator } from "@playwright/test";
import path from "path";

async function clickMenuItem(graphFrame: Frame, bookmarkPill: Locator, text: string) {
  await bookmarkPill.click({ button: "right" });
  const pushMenu = graphFrame.locator("#pill-context-menu");
  const item = pushMenu.locator(".context-menu-item").filter({ hasText: text });
  await expect(item).toBeVisible();
  await item.click();
  await expect(pushMenu).not.toBeVisible();
}

async function setupRemotesWithTrackedBookmark(testRepo: TestRepo, graphFrame: Frame) {
  const remoteAPath = path.join(path.dirname(testRepo.repoPath), "remote-a");
  const remoteBPath = path.join(path.dirname(testRepo.repoPath), "remote-b");
  const remoteARepo = await newTestRepo(remoteAPath);
  const remoteBRepo = await newTestRepo(remoteBPath);

  await testRepo.jjCommand(["git", "remote", "add", "remote-a", remoteAPath]);
  await testRepo.jjCommand(["git", "remote", "add", "remote-b", remoteBPath]);
  await testRepo.jjCommand(["bookmark", "create", "my-bookmark"]);

  const bookmarkPill = graphFrame.locator('.bookmark-pill[data-bookmark="my-bookmark"]');
  await expect(bookmarkPill).toBeVisible();

  await clickMenuItem(graphFrame, bookmarkPill, "Track on remote-a");
  await clickMenuItem(graphFrame, bookmarkPill, "Track on remote-b");

  return { remoteARepo, remoteBRepo, bookmarkPill };
}

test("push bookmark to all remotes via upload icon", async ({ graphFrame, testRepo }) => {
  test.slow();
  const { bookmarkPill } = await setupRemotesWithTrackedBookmark(testRepo, graphFrame);

  await testRepo.commitFile("test.txt", "content", "initial commit");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3);

  const unsyncedPill = graphFrame.locator('.bookmark-pill.unsynced[data-bookmark="my-bookmark"]');
  const uploadIcon = bookmarkPill.locator(".bookmark-push-icon");

  await expect(uploadIcon).toBeVisible();

  await uploadIcon.click();

  await expect(unsyncedPill).not.toBeVisible();
});

test("push bookmark to single remote via context menu", async ({ graphFrame, testRepo }) => {
  test.slow();
  const { remoteARepo, remoteBRepo, bookmarkPill } = await setupRemotesWithTrackedBookmark(testRepo, graphFrame);

  await testRepo.commitFile("test.txt", "content", "initial commit");
  const uploadIcon = bookmarkPill.locator(".bookmark-push-icon");
  await expect(uploadIcon).toBeVisible();
  await uploadIcon.click();

  const unsyncedPill = graphFrame.locator('.bookmark-pill.unsynced[data-bookmark="my-bookmark"]');
  await expect(unsyncedPill).not.toBeVisible();

  const changeId = await testRepo.commitFile("new.txt", "new content", "second commit");
  await testRepo.jjCommand(["bookmark", "move", "my-bookmark", "--to", "@-"]);

  await expect(unsyncedPill).toBeVisible();
  await expect(uploadIcon).toBeVisible();

  await clickMenuItem(graphFrame, bookmarkPill, "Push to remote-a");

  await expect(async () => {
    const showResult = await remoteARepo.jjCommand(["show", changeId]);
    expect(showResult.exitCode).toBe(0);
  }).toPass();

  const showResultB = await remoteBRepo.jjCommand(["show", changeId]);
  expect(showResultB.exitCode).not.toBe(0);

  await expect(unsyncedPill).toBeVisible();

  await expect(async () => {
    await bookmarkPill.click({ button: "right" });
    const pushMenu = graphFrame.locator("#pill-context-menu");
    await expect(pushMenu).toBeVisible();
    const pushToB = pushMenu.locator(".context-menu-item").filter({ hasText: "Push to remote-b" });
    await expect(pushToB).toBeVisible();
    const pushToA = pushMenu.locator(".context-menu-item").filter({ hasText: "Push to remote-a" });
    await expect(pushToA).not.toBeVisible({ timeout: 2_000 });
    await graphFrame.locator("body").click({ position: { x: 1, y: 1 } });
    await expect(pushMenu).not.toBeVisible();
  }).toPass();

  await clickMenuItem(graphFrame, bookmarkPill, "Push to remote-b");
  await expect(unsyncedPill).not.toBeVisible();
});

test("push to one remote and untrack from another", async ({ graphFrame, testRepo }) => {
  test.slow();
  const { remoteARepo, bookmarkPill } = await setupRemotesWithTrackedBookmark(testRepo, graphFrame);

  await testRepo.commitFile("test.txt", "content", "initial commit");
  const uploadIcon = bookmarkPill.locator(".bookmark-push-icon");
  await expect(uploadIcon).toBeVisible();
  await uploadIcon.click();

  const unsyncedPill = graphFrame.locator('.bookmark-pill.unsynced[data-bookmark="my-bookmark"]');
  await expect(unsyncedPill).not.toBeVisible();

  const changeId = await testRepo.commitFile("new.txt", "new content", "second commit");
  await testRepo.jjCommand(["bookmark", "move", "my-bookmark", "--to", "@-"]);
  await expect(unsyncedPill).toBeVisible();

  await clickMenuItem(graphFrame, bookmarkPill, "Push to remote-a");

  await expect(async () => {
    const showResult = await remoteARepo.jjCommand(["show", changeId]);
    expect(showResult.exitCode).toBe(0);
  }).toPass();

  await clickMenuItem(graphFrame, bookmarkPill, "Untrack from remote-b");
  await expect(unsyncedPill).not.toBeVisible();

  await clickMenuItem(graphFrame, bookmarkPill, "Untrack from remote-a");

  await expect(async () => {
    const trackedResult = await testRepo.jjCommand(["bookmark", "list", "my-bookmark", "--tracked"]);
    expect(trackedResult.stdout.trim()).toBe("");
  }).toPass();
});
