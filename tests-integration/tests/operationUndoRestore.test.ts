import { test, expect } from "./baseTest";

test("undo a specific operation from operation log tree view", async ({ graphFrame, opLog, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(4);

  const paneBody = opLog.locator(".pane-body");
  const treeItems = paneBody.locator('[role="treeitem"]');
  await expect(treeItems.first()).toBeVisible();

  const firstItem = treeItems.filter({ hasText: /^jj .*commit/ }).first();
  await firstItem.scrollIntoViewIfNeeded();
  await firstItem.hover();
  const revertBtn = firstItem.getByRole("button", { name: "Revert Operation" });
  await expect(revertBtn).toBeVisible();
  await revertBtn.click();

  await expect(nodes).toHaveCount(3);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(logEntries.find((e) => e.description.trim() === "B")).toBeUndefined();
    expect(logEntries.find((e) => e.description.trim() === "A")).toBeDefined();
  }).toPass();
});

test("restore repo to a specific operation from operation log tree view", async ({ graphFrame, opLog, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "commit A");
  await testRepo.commitFile("a.txt", "content b", "commit B");
  await testRepo.commitFile("a.txt", "content c", "commit C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const paneBody = opLog.locator(".pane-body");
  const treeItems = paneBody.locator('[role="treeitem"]');
  await expect(treeItems.first()).toBeVisible();

  const targetItem = treeItems.filter({ hasText: /commit A/ }).first();
  await targetItem.scrollIntoViewIfNeeded();
  await targetItem.hover();
  const restoreBtn = targetItem.getByRole("button", { name: "Restore Repo to the State at This Operation" });
  await expect(restoreBtn).toBeVisible();
  await restoreBtn.click();

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(logEntries.find((e) => e.description.trim() === "commit B")).toBeUndefined();
    expect(logEntries.find((e) => e.description.trim() === "commit C")).toBeUndefined();
    expect(logEntries.find((e) => e.description.trim() === "commit A")).toBeDefined();
  }).toPass();

  const fileContent = await testRepo.readFile("a.txt");
  expect(fileContent.trim()).toBe("content a");
});
