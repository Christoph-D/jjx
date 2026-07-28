import { test, expect, newTestRepo, clickPillMenuItem, runCommand } from "./baseTest";
import path from "path";

test("create and delete bookmark from context menu", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("test.txt", "content", "test commit");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3);

  const commitNode = nodes.nth(0);

  const createBookmarkViaContextMenu = async (name: string) => {
    await commitNode.locator('[data-role="change-id"]').click({ button: "right" });

    const createBookmarkItem = graphFrame.locator('[data-action="createBookmark"]');
    await createBookmarkItem.click();

    const input = workbox.locator("input").first();
    await input.waitFor({ state: "visible" });
    await input.fill(name);
    await workbox.keyboard.press("Enter");
  };

  await createBookmarkViaContextMenu("test-bookmark");

  const bookmarkPill = graphFrame.locator('[data-bookmark="test-bookmark"]');
  await expect(bookmarkPill).toBeVisible();

  const bookmark = await testRepo.getBookmark("test-bookmark");
  expect(bookmark).toBeDefined();

  await createBookmarkViaContextMenu("#special");

  const specialBookmarkPill = graphFrame.locator('[data-bookmark="#special"]');
  await expect(specialBookmarkPill).toBeVisible();

  expect((await testRepo.jjCommand(["bookmark", "list"])).stdout).toContain("#special");

  await clickPillMenuItem(graphFrame, bookmarkPill, "Delete Bookmark");

  const dialog = workbox.locator(".monaco-dialog-box");
  await expect(dialog).toContainText("test-bookmark");
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(bookmarkPill).not.toBeVisible();

  expect(await testRepo.getBookmark("test-bookmark")).toBeUndefined();

  await clickPillMenuItem(graphFrame, specialBookmarkPill, "Delete Bookmark");

  await expect(dialog).toContainText("#special");
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(specialBookmarkPill).not.toBeVisible();
  expect((await testRepo.jjCommand(["bookmark", "list"])).stdout).not.toContain("#special");
});

test("move bookmark via drag and drop", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content a", "commit 1");
  await testRepo.jjCommand(["bookmark", "create", "test-bookmark", "-r", "@-"]);
  await testRepo.commitFile("b.txt", "content b", "commit 2");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const commit2Node = nodes.nth(1);
  const commit1Node = nodes.nth(2);

  await expect(commit1Node.locator('[data-bookmark="test-bookmark"]')).toBeVisible();

  const bookmarkPill = graphFrame.locator('[data-bookmark="test-bookmark"]');
  await bookmarkPill.dragTo(commit2Node);

  await expect(commit2Node.locator('[data-bookmark="test-bookmark"]')).toBeVisible();
  await expect(commit1Node.locator('[data-bookmark="test-bookmark"]')).not.toBeVisible();

  let bookmark = await testRepo.getBookmark("test-bookmark");
  expect(bookmark?.description).toBe("commit 2");

  await bookmarkPill.dragTo(commit1Node);

  const quickPickContinue = workbox.getByRole("option", { name: "Continue", exact: true });
  await quickPickContinue.click();

  await expect(commit1Node.locator('[data-bookmark="test-bookmark"]')).toBeVisible();
  await expect(commit2Node.locator('[data-bookmark="test-bookmark"]')).not.toBeVisible();

  bookmark = await testRepo.getBookmark("test-bookmark");
  expect(bookmark?.description).toBe("commit 1");
});

test("conflicted bookmark shows both sides with conflicted class", async ({ graphFrame, testRepo, workbox }) => {
  await testRepo.commitFile("a.txt", "content", "commit A");
  await testRepo.jjCommand(["bookmark", "create", "test-bookmark"]);

  const remotePath = path.join(testRepo.repoPath, "remote");
  const remoteRepo = await newTestRepo(remotePath);

  await testRepo.jjCommand(["git", "remote", "add", "origin", "remote"]);
  await testRepo.jjCommand(["bookmark", "track", "test-bookmark", "--remote=origin"]);
  await testRepo.jjCommand(["git", "push"]);

  await remoteRepo.jjCommand(["new", "test-bookmark"]);
  await remoteRepo.commitFile("b.txt", "content", "commit B");
  await remoteRepo.jjCommand(["bookmark", "set", "test-bookmark"]);

  await testRepo.jjCommand(["new", "test-bookmark"]);
  await testRepo.commitFile("c.txt", "content", "commit C");
  await testRepo.jjCommand(["bookmark", "set", "test-bookmark"]);

  await testRepo.jjCommand(["git", "fetch"]);
  await runCommand(workbox, "Refresh");

  const conflictedBookmarks = graphFrame.locator('[data-bookmark="test-bookmark"][data-conflicted]');
  await expect(conflictedBookmarks).toHaveCount(2);

  const allBookmarks = graphFrame.locator('[data-bookmark="test-bookmark"]');
  await expect(allBookmarks).toHaveCount(2);
});
