import { test, expect, newTestRepo, clickPillMenuItem, clickRemoteRefMenuItem, type TestRepo } from "./base-test";
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

test("remote ref pill context menus", async ({ graphFrame, testRepo, workbox }) => {
  test.slow();
  const { "remote-a": remoteARepo, "remote-b": remoteBRepo } = await setupRemotes(testRepo, "remote-a", "remote-b");
  const dialog = workbox.locator(".monaco-dialog-box");

  // A bookmark tracked on and pushed to remote-a.
  await testRepo.commitFile("test.txt", "content", "initial commit");
  await testRepo.jjCommand(["bookmark", "create", "-r", "@-", "my-bookmark"]);
  const bookmarkPill = graphFrame.locator('[data-bookmark="my-bookmark"]');
  await expect(bookmarkPill).toBeVisible();
  await clickPillMenuItem(graphFrame, bookmarkPill, "Track on remote-a");
  const bookmarkUploadIcon = bookmarkPill.locator('[data-role="push-icon"]');
  await expect(bookmarkUploadIcon).toBeVisible();
  await bookmarkUploadIcon.click();
  // Wait for the push to complete (bookmark becomes synced) before proceeding.
  await expect(graphFrame.locator('[data-bookmark="my-bookmark"][data-unsynced]')).not.toBeVisible();

  await test.step("canceling remote bookmark deletion does not delete it from the remote", async () => {
    // Deleting the local bookmark makes the (unsynced, tracked) remote pill appear.
    await testRepo.jjCommand(["bookmark", "delete", "my-bookmark"]);
    const remotePill = graphFrame.locator('[data-remote-bookmark="my-bookmark"][data-remote="remote-a"]');
    await expect(remotePill).toBeVisible();

    await clickRemoteRefMenuItem(graphFrame, remotePill, "Delete Bookmark from remote-a");

    await expect(dialog).toBeVisible();
    await workbox.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    // The remote pill is still there, and the bookmark still exists on the remote.
    await expect(remotePill).toBeVisible();
    expect(await remoteARepo.getBookmark("my-bookmark")).toBeDefined();
  });

  await test.step("restore deleted bookmark from remote via remote pill context menu", async () => {
    const remotePill = graphFrame.locator('[data-remote-bookmark="my-bookmark"][data-remote="remote-a"]');
    await clickRemoteRefMenuItem(graphFrame, remotePill, "Restore Bookmark from remote-a");

    // Restoring recreates the local bookmark, so the remote-only pill disappears
    // and a local bookmark pill takes its place.
    await expect(remotePill).not.toBeVisible();
    await expect(bookmarkPill).toBeVisible();
    expect(await testRepo.getBookmark("my-bookmark")).toBeDefined();
  });

  await test.step("delete bookmark from remote via remote pill context menu", async () => {
    // Delete the local bookmark again to make the remote pill reappear.
    await testRepo.jjCommand(["bookmark", "delete", "my-bookmark"]);
    const remotePill = graphFrame.locator('[data-remote-bookmark="my-bookmark"][data-remote="remote-a"]');
    await expect(remotePill).toBeVisible();

    await clickRemoteRefMenuItem(graphFrame, remotePill, "Delete Bookmark from remote-a");

    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('delete the bookmark "my-bookmark" from "remote-a"');
    await dialog.getByRole("button", { name: "Delete from remote-a" }).click();
    await expect(dialog).not.toBeVisible();

    await expect(remotePill).not.toBeVisible();
    await expect(async () => {
      expect(await remoteARepo.getBookmark("my-bookmark")).toBeUndefined();
    }).toPass();
  });

  // A tag tracked on and pushed to remote-b.
  await testRepo.createTag("my-tag", "@-");
  const tagPill = graphFrame.locator('[data-tag="my-tag"]');
  await expect(tagPill).toBeVisible();
  await testRepo.jjCommand(["tag", "track", "my-tag", "--remote=remote-b"]);
  const tagUploadIcon = tagPill.locator('[data-role="push-icon"]');
  await expect(tagUploadIcon).toBeVisible();
  await tagUploadIcon.click();
  await expect(graphFrame.locator('[data-tag="my-tag"][data-unsynced]')).not.toBeVisible();

  await test.step("restore deleted tag from remote via remote pill context menu", async () => {
    await testRepo.jjCommand(["tag", "delete", "my-tag"]);
    await expect(tagPill).not.toBeVisible();
    const remotePill = graphFrame.locator('[data-remote-tag="my-tag"][data-remote="remote-b"]');
    await expect(remotePill).toBeVisible();

    await clickRemoteRefMenuItem(graphFrame, remotePill, "Restore Tag from remote-b");

    await expect(remotePill).not.toBeVisible();
    await expect(tagPill).toBeVisible();
    expect(await testRepo.getTag("my-tag")).toBeDefined();
  });

  await test.step("delete tag from remote via remote pill context menu", async () => {
    // Delete the local tag again to make the remote pill reappear.
    await testRepo.jjCommand(["tag", "delete", "my-tag"]);
    const remotePill = graphFrame.locator('[data-remote-tag="my-tag"][data-remote="remote-b"]');
    await expect(remotePill).toBeVisible();

    await clickRemoteRefMenuItem(graphFrame, remotePill, "Delete Tag from remote-b");

    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('delete the tag "my-tag" from "remote-b"');
    await dialog.getByRole("button", { name: "Delete from remote-b" }).click();
    await expect(dialog).not.toBeVisible();

    await expect(remotePill).not.toBeVisible();
    await expect(async () => {
      expect(await remoteBRepo.getTag("my-tag")).toBeUndefined();
    }).toPass();
  });

  await test.step("track untracked remote bookmark via remote pill context menu", async () => {
    const { "remote-src": remoteSrcRepo } = await setupRemotes(testRepo, "remote-src");
    // Land the bookmark and the tag on different commits. Both scenarios share a
    // single remote repo, but keeping each ref on its own commit avoids stacking
    // two pills on one row (which makes one pill intercept the other's clicks).
    await remoteSrcRepo.commitFile("a.txt", "x", "first commit");
    await remoteSrcRepo.commitFile("b.txt", "y", "second commit");
    await remoteSrcRepo.jjCommand(["bookmark", "create", "-r", "@-", "remote-only-bookmark"]);
    await remoteSrcRepo.createTag("remote-only-tag", "@--");

    // Scope the fetch to the bookmark so the tag stays unfetched until its step.
    await testRepo.jjCommand(["git", "fetch", "--remote", "remote-src", "--branch", "remote-only-bookmark"]);
    // The default graph revset only shows commits connected to the working
    // copy, so place the working copy on top of the fetched commit to make it
    // (and its untracked remote bookmark) visible.
    await testRepo.jjCommand(["new", "remote-only-bookmark@remote-src"]);

    const remotePill = graphFrame.locator('[data-remote-bookmark="remote-only-bookmark"][data-remote="remote-src"]');
    await expect(remotePill).toBeVisible();

    // Untracked remote ref -> a remote-ref menu offering to track it.
    await clickRemoteRefMenuItem(graphFrame, remotePill, "Track Bookmark from remote-src");

    // Tracking creates a matching local bookmark, so the remote-only pill
    // disappears and a local bookmark pill takes its place.
    await expect(remotePill).not.toBeVisible();
    await expect(graphFrame.locator('[data-bookmark="remote-only-bookmark"]')).toBeVisible();
  });

  await test.step("track untracked remote tag via remote pill context menu", async () => {
    // The tag sits on an ancestor of the bookmark, which the previous step
    // already made visible, so no additional `jj new` is needed.
    await testRepo.jjCommand(["git", "fetch", "--remote", "remote-src", "--tag", "remote-only-tag"]);
    // Fetched tags are tracked locally by default, so delete and untrack the
    // local tag to expose the remote-only (untracked) tag pill.
    await testRepo.jjCommand(["tag", "delete", "remote-only-tag"]);
    await testRepo.jjCommand(["tag", "untrack", "remote-only-tag"]);

    const remotePill = graphFrame.locator('[data-remote-tag="remote-only-tag"][data-remote="remote-src"]');
    await expect(remotePill).toBeVisible();

    await clickRemoteRefMenuItem(graphFrame, remotePill, "Track Tag from remote-src");

    // Tracking creates a matching local tag, so the remote-only pill disappears.
    await expect(remotePill).not.toBeVisible();
    await expect(graphFrame.locator('[data-tag="remote-only-tag"]')).toBeVisible();
  });
});
