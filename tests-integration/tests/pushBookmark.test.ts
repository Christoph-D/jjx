import { test, expect, newTestRepo } from "./baseTest";
import path from "path";

test("push bookmark to all remotes via upload icon, then push to single remote", async ({ graphFrame, testRepo }) => {
  const remoteAPath = path.join(testRepo.repoPath, "remote-a");
  const remoteBPath = path.join(testRepo.repoPath, "remote-b");
  const remoteARepo = await newTestRepo(remoteAPath);
  const remoteBRepo = await newTestRepo(remoteBPath);

  await testRepo.commitFile("test.txt", "content", "initial commit");
  await testRepo.jjCommand(["git", "remote", "add", "remote-a", "remote-a"]);
  await testRepo.jjCommand(["git", "remote", "add", "remote-b", "remote-b"]);
  await testRepo.jjCommand(["bookmark", "create", "my-bookmark", "-r", "@-"]);
  await testRepo.jjCommand(["bookmark", "track", "my-bookmark", "--remote=remote-a"]);
  await testRepo.jjCommand(["bookmark", "track", "my-bookmark", "--remote=remote-b"]);

  const bookmarkPill = graphFrame.locator('.bookmark-pill[data-bookmark="my-bookmark"]');
  await expect(bookmarkPill).toBeVisible();

  const unsyncedPill = graphFrame.locator('.bookmark-pill.unsynced[data-bookmark="my-bookmark"]');
  const uploadIcon = bookmarkPill.locator(".bookmark-push-icon");

  await expect(uploadIcon).toBeVisible();

  await uploadIcon.click();

  await expect(unsyncedPill).not.toBeVisible();

  const changeId = await testRepo.commitFile("new.txt", "new content", "second commit");
  await testRepo.jjCommand(["bookmark", "move", "my-bookmark", "--to", "@-"]);

  await expect(unsyncedPill).toBeVisible();
  await expect(uploadIcon).toBeVisible();

  await uploadIcon.click({ button: "right" });

  const pushMenu = graphFrame.locator("#push-bookmark-menu");
  await expect(pushMenu).toBeVisible();

  const pushToRemoteA = pushMenu.locator(".context-menu-item").filter({ hasText: "Push to remote-a" });
  await expect(pushToRemoteA).toBeVisible();
  await pushToRemoteA.click();

  await expect(async () => {
    const showResult = await remoteARepo.jjCommand(["show", changeId]);
    expect(showResult.exitCode).toBe(0);
  }).toPass();

  const showResultB = await remoteBRepo.jjCommand(["show", changeId]);
  expect(showResultB.exitCode).not.toBe(0);

  await expect(unsyncedPill).toBeVisible();
});
