import { test, expect, increaseJJVisibleSize } from "./baseTest";
import { getParents } from "../testRepo";

test("revert commit onto another via drag and drop", async ({ workbox, graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  await increaseJJVisibleSize(workbox);

  const commitC = nodes.nth(1);
  const commitA = nodes.nth(3);

  await commitC.dragTo(commitA);

  const revertItem = graphFrame.locator('.context-menu-item[data-action="revert"]');
  await expect(revertItem).toBeVisible();
  await revertItem.hover();

  const revertOntoItem = graphFrame.locator('.context-submenu-item[data-action="revertOnto"]');
  await expect(revertOntoItem).toBeVisible();
  await revertOntoItem.click();

  await expect(nodes).toHaveCount(6);

  await expect(async () => {
    const logEntries = await testRepo.log();
    const revertCommits = logEntries.filter((e) => e.description.includes("Revert") && e.description.includes("C"));
    expect(revertCommits).toHaveLength(1);

    const revertCommit = revertCommits[0];
    expect(getParents(logEntries, revertCommit.description.trim())).toEqual(["A"]);
  }).toPass();
});

test("revert after another commit via drag and drop", async ({ workbox, graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  await increaseJJVisibleSize(workbox);

  const commitC = nodes.nth(1);
  const commitA = nodes.nth(3);

  await commitC.dragTo(commitA);

  const revertItem = graphFrame.locator('.context-menu-item[data-action="revert"]');
  await expect(revertItem).toBeVisible();
  await revertItem.hover();

  const revertAfterItem = graphFrame.locator('.context-submenu-item[data-action="revertAfter"]');
  await expect(revertAfterItem).toBeVisible();
  await revertAfterItem.click();

  await expect(nodes).toHaveCount(6);

  await expect(async () => {
    const logEntries = await testRepo.log();
    const revertCommits = logEntries.filter((e) => e.description.includes("Revert") && e.description.includes("C"));
    expect(revertCommits).toHaveLength(1);

    const bParents = getParents(logEntries, "B");
    expect(bParents).toHaveLength(1);
    expect(bParents[0]).toContain("Revert");
    expect(bParents[0]).toContain("C");
    expect(getParents(logEntries, bParents[0])).toEqual(["A"]);
  }).toPass();
});

test("revert before another commit via drag and drop", async ({ workbox, graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  await increaseJJVisibleSize(workbox);

  const commitC = nodes.nth(1);
  const commitB = nodes.nth(2);

  await commitC.dragTo(commitB);

  const revertItem = graphFrame.locator('.context-menu-item[data-action="revert"]');
  await expect(revertItem).toBeVisible();
  await revertItem.hover();

  const revertBeforeItem = graphFrame.locator('.context-submenu-item[data-action="revertBefore"]');
  await expect(revertBeforeItem).toBeVisible();
  await revertBeforeItem.click();

  await expect(nodes).toHaveCount(6);

  await expect(async () => {
    const logEntries = await testRepo.log();
    const revertCommits = logEntries.filter((e) => e.description.includes("Revert") && e.description.includes("C"));
    expect(revertCommits).toHaveLength(1);

    const bParents = getParents(logEntries, "B");
    expect(bParents).toHaveLength(1);
    expect(bParents[0]).toContain("Revert");
    expect(bParents[0]).toContain("C");
    expect(getParents(logEntries, bParents[0])).toEqual(["A"]);
  }).toPass();
});
