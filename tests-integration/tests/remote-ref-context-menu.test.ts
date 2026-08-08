import { test, expect, newTestRepo, clickPillMenuItem, clickRemoteRefMenuItem, type TestRepo } from "./base-test";
import type { Frame } from "@playwright/test";
import path from "path";

async function setupRemotes(testRepo: TestRepo, ...names: string[]) {
  const repos: Record<string, TestRepo> = {};
  for (const name of names) {
    const remotePath = path.join(path.dirname(testRepo.repoPath), name);
    repos[name] = await newTestRepo(remotePath);
    await testRepo.jjCommand(["git", "remote", "add", name, remotePath]);
  }
  return repos;
}

async function setupTrackedAndPushedBookmark(testRepo: TestRepo, graphFrame: Frame) {
  const { "remote-a": remoteARepo } = await setupRemotes(testRepo, "remote-a");
  await testRepo.commitFile("test.txt", "content", "initial commit");
  await testRepo.jjCommand(["bookmark", "create", "-r", "@-", "my-bookmark"]);

  const bookmarkPill = graphFrame.locator('[data-bookmark="my-bookmark"]');
  await expect(bookmarkPill).toBeVisible();
  await clickPillMenuItem(graphFrame, bookmarkPill, "Track on remote-a");
  const uploadIcon = bookmarkPill.locator('[data-role="push-icon"]');
  await expect(uploadIcon).toBeVisible();
  await uploadIcon.click();
  // Wait for the push to complete (bookmark becomes synced) before proceeding.
  await expect(graphFrame.locator('[data-bookmark="my-bookmark"][data-unsynced]')).not.toBeVisible();
  return { remoteARepo, bookmarkPill };
}

async function setupTrackedAndPushedTag(testRepo: TestRepo, graphFrame: Frame) {
  const { "remote-a": remoteARepo } = await setupRemotes(testRepo, "remote-a");
  await testRepo.commitFile("test.txt", "content", "initial commit");
  await testRepo.createTag("my-tag", "@-");

  const tagPill = graphFrame.locator('[data-tag="my-tag"]');
  await expect(tagPill).toBeVisible();
  await clickPillMenuItem(graphFrame, tagPill, "Track on remote-a");
  const uploadIcon = tagPill.locator('[data-role="push-icon"]');
  await expect(uploadIcon).toBeVisible();
  await uploadIcon.click();
  await expect(graphFrame.locator('[data-tag="my-tag"][data-unsynced]')).not.toBeVisible();
  return { remoteARepo, tagPill };
}

test("delete bookmark from remote via remote pill context menu", async ({ graphFrame, testRepo, workbox }) => {
  test.slow();
  const { remoteARepo } = await setupTrackedAndPushedBookmark(testRepo, graphFrame);

  // Deleting the local bookmark makes the (unsynced, tracked) remote pill appear.
  await testRepo.jjCommand(["bookmark", "delete", "my-bookmark"]);
  const remotePill = graphFrame.locator('[data-remote-bookmark="my-bookmark"][data-remote="remote-a"]');
  await expect(remotePill).toBeVisible();

  await clickRemoteRefMenuItem(graphFrame, remotePill, "Delete from remote-a");

  const dialog = workbox.locator(".monaco-dialog-box");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('delete the bookmark "my-bookmark" from "remote-a"');
  await dialog.getByRole("button", { name: "Delete from remote-a" }).click();
  await expect(dialog).not.toBeVisible();

  await expect(remotePill).not.toBeVisible();
  await expect(async () => {
    expect(await remoteARepo.getBookmark("my-bookmark")).toBeUndefined();
  }).toPass();
});

test("cancel deletion does not delete the bookmark from the remote", async ({ graphFrame, testRepo, workbox }) => {
  test.slow();
  const { remoteARepo } = await setupTrackedAndPushedBookmark(testRepo, graphFrame);

  await testRepo.jjCommand(["bookmark", "delete", "my-bookmark"]);
  const remotePill = graphFrame.locator('[data-remote-bookmark="my-bookmark"][data-remote="remote-a"]');
  await expect(remotePill).toBeVisible();

  await clickRemoteRefMenuItem(graphFrame, remotePill, "Delete from remote-a");

  const dialog = workbox.locator(".monaco-dialog-box");
  await expect(dialog).toBeVisible();
  await workbox.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();

  // The remote pill is still there, and the bookmark still exists on the remote.
  await expect(remotePill).toBeVisible();
  expect(await remoteARepo.getBookmark("my-bookmark")).toBeDefined();
});

test("delete tag from remote via remote pill context menu", async ({ graphFrame, testRepo, workbox }) => {
  test.slow();
  const { remoteARepo } = await setupTrackedAndPushedTag(testRepo, graphFrame);

  await testRepo.jjCommand(["tag", "delete", "my-tag"]);
  const remotePill = graphFrame.locator('[data-remote-tag="my-tag"][data-remote="remote-a"]');
  await expect(remotePill).toBeVisible();

  await clickRemoteRefMenuItem(graphFrame, remotePill, "Delete from remote-a");

  const dialog = workbox.locator(".monaco-dialog-box");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('delete the tag "my-tag" from "remote-a"');
  await dialog.getByRole("button", { name: "Delete from remote-a" }).click();
  await expect(dialog).not.toBeVisible();

  await expect(remotePill).not.toBeVisible();
  await expect(async () => {
    expect(await remoteARepo.getTag("my-tag")).toBeUndefined();
  }).toPass();
});

test("right-click on untracked remote bookmark falls back to change menu", async ({ graphFrame, testRepo }) => {
  test.slow();
  const { "remote-src": remoteSrcRepo } = await setupRemotes(testRepo, "remote-src");
  await remoteSrcRepo.commitFile("remote.txt", "content", "remote commit");
  await remoteSrcRepo.jjCommand(["bookmark", "create", "-r", "@-", "remote-only-bookmark"]);

  await testRepo.jjCommand(["git", "fetch", "--remote", "remote-src"]);
  // The default graph revset only shows commits connected to the working copy,
  // so place the working copy on top of the fetched commit to make it (and its
  // untracked remote bookmark) visible.
  await testRepo.jjCommand(["new", "remote-only-bookmark@remote-src"]);

  const remotePill = graphFrame.locator('[data-remote-bookmark="remote-only-bookmark"][data-remote="remote-src"]');
  await expect(remotePill).toBeVisible();

  await remotePill.click({ button: "right" });

  // Untracked remote ref -> no remote-ref menu, right-click passes through to
  // the change context menu.
  await expect(graphFrame.locator("#context-menu")).toBeVisible();
  await expect(graphFrame.locator("#remote-ref-context-menu")).not.toBeVisible();
});
