import { test, expect, newTestRepo } from "./baseTest";
import path from "path";

test("push tag to remote via context menu", async ({ graphFrame, testRepo }) => {
  const remoteAPath = path.join(testRepo.repoPath, "remote-a");
  const remoteBPath = path.join(testRepo.repoPath, "remote-b");
  const remoteARepo = await newTestRepo(remoteAPath);
  const remoteBRepo = await newTestRepo(remoteBPath);

  await testRepo.jjCommand(["git", "remote", "add", "remote-a", "remote-a"]);
  await testRepo.jjCommand(["git", "remote", "add", "remote-b", "remote-b"]);

  await testRepo.commitFile("test.txt", "content", "initial commit");
  await testRepo.createTag("test-tag", "@-");

  const tagPill = graphFrame.locator('.tag-pill[data-tag="test-tag"]');
  await expect(tagPill).toBeVisible();

  const clickMenuItem = async (text: string) => {
    await tagPill.click({ button: "right" });
    const pillContextMenu = graphFrame.locator("#pill-context-menu");
    const item = pillContextMenu.locator(".context-menu-item").filter({ hasText: text });
    await expect(item).toBeVisible();
    await item.click();
    await expect(pillContextMenu).not.toBeVisible();
  };

  await clickMenuItem("Push to remote-a");

  await expect(async () => {
    const tag = await remoteARepo.getTag("test-tag");
    expect(tag).toBeDefined();
  }).toPass();

  const tagB = await remoteBRepo.getTag("test-tag");
  expect(tagB).toBeUndefined();

  await clickMenuItem("Push to remote-b");

  await expect(async () => {
    const tag = await remoteBRepo.getTag("test-tag");
    expect(tag).toBeDefined();
  }).toPass();
});
