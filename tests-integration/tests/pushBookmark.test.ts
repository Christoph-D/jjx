import { test, expect, newTestRepo } from "./baseTest";
import path from "path";

test("push bookmark to all remotes via upload icon, then push to single remote", async ({ graphFrame, testRepo }) => {
  const remoteAPath = path.join(testRepo.repoPath, "remote-a");
  const remoteBPath = path.join(testRepo.repoPath, "remote-b");
  const remoteARepo = await newTestRepo(remoteAPath);
  const remoteBRepo = await newTestRepo(remoteBPath);

  await testRepo.jjCommand(["git", "remote", "add", "remote-a", "remote-a"]);
  await testRepo.jjCommand(["git", "remote", "add", "remote-b", "remote-b"]);
  await testRepo.jjCommand(["bookmark", "create", "my-bookmark"]);
  //await testRepo.jjCommand(["bookmark", "track", "my-bookmark", "--remote=remote-a"]);
  //await testRepo.jjCommand(["bookmark", "track", "my-bookmark", "--remote=remote-b"]);

  const bookmarkPill = graphFrame.locator('.bookmark-pill[data-bookmark="my-bookmark"]');
  await expect(bookmarkPill).toBeVisible();

  const clickMenuItem = async (text: string) => {
    await bookmarkPill.click({ button: "right" });
    const pushMenu = graphFrame.locator("#pill-context-menu");
    const item = pushMenu.locator(".context-menu-item").filter({ hasText: text });
    await expect(item).toBeVisible();
    await item.click();
    await expect(pushMenu).not.toBeVisible();
  };

  const assertMenuItemNotVisible = async (text: string) => {
    await bookmarkPill.click({ button: "right" });
    const pushMenu = graphFrame.locator("#pill-context-menu");
    const item = pushMenu.locator(".context-menu-item").filter({ hasText: text });
    await expect(item).not.toBeVisible();
    await graphFrame.locator("body").click();
    await expect(pushMenu).not.toBeVisible();
  };
  await clickMenuItem("Track on remote-a");
  await clickMenuItem("Track on remote-b");

  await testRepo.commitFile("test.txt", "content", "initial commit");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(3);

  const unsyncedPill = graphFrame.locator('.bookmark-pill.unsynced[data-bookmark="my-bookmark"]');
  const uploadIcon = bookmarkPill.locator(".bookmark-push-icon");

  await expect(uploadIcon).toBeVisible();

  await uploadIcon.click();

  await expect(unsyncedPill).not.toBeVisible();

  const changeId = await testRepo.commitFile("new.txt", "new content", "second commit");
  await testRepo.jjCommand(["bookmark", "move", "my-bookmark", "--to", "@-"]);

  await expect(unsyncedPill).toBeVisible();
  await expect(uploadIcon).toBeVisible();

  await clickMenuItem("Push to remote-a");

  await expect(async () => {
    const showResult = await remoteARepo.jjCommand(["show", changeId]);
    expect(showResult.exitCode).toBe(0);
  }).toPass();

  const showResultB = await remoteBRepo.jjCommand(["show", changeId]);
  expect(showResultB.exitCode).not.toBe(0);

  await expect(unsyncedPill).toBeVisible();

  await expect(async () => {
    await assertMenuItemNotVisible("Push to remote-a");
  }).toPass();

  await clickMenuItem("Push to remote-b");
  await expect(unsyncedPill).not.toBeVisible();

  await testRepo.commit("third commit");
  await testRepo.jjCommand(["bookmark", "move", "my-bookmark", "--to", "@-"]);
  await expect(unsyncedPill).toBeVisible();

  await clickMenuItem("Push to remote-a");
  await clickMenuItem("Untrack from remote-b");
  await expect(unsyncedPill).not.toBeVisible();

  await clickMenuItem("Untrack from remote-a");

  await expect(async () => {
    const trackedResult = await testRepo.jjCommand(["bookmark", "list", "my-bookmark", "--tracked"]);
    expect(trackedResult.stdout.trim()).toBe("");
  }).toPass();
});
