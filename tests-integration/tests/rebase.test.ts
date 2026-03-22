import { test, expect } from "./baseTest";
import { getParents } from "../testRepo";

test("rebase commit onto another via drag and drop", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5, { timeout: 10000 });

  const commitC = nodes.nth(1);
  const commitA = nodes.nth(3);

  await commitC.dragTo(commitA);

  const rebaseOntoItem = graphFrame.locator('.context-menu-item[data-action="rebaseOnto"]');
  await expect(rebaseOntoItem).toBeVisible({ timeout: 5000 });
  await rebaseOntoItem.click();

  await expect(nodes).toHaveCount(5, { timeout: 10000 });

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "C")).toEqual(["A"]);
  }).toPass({ timeout: 10000 });
});

test("rebase after another commit via drag and drop", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5, { timeout: 10000 });

  const commitC = nodes.nth(1);
  const commitA = nodes.nth(3);

  await commitC.dragTo(commitA);

  const rebaseAfterItem = graphFrame.locator('.context-menu-item[data-action="rebaseAfter"]');
  await expect(rebaseAfterItem).toBeVisible({ timeout: 5000 });
  await rebaseAfterItem.click();

  await expect(nodes).toHaveCount(5, { timeout: 10000 });

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "B")).toEqual(["C"]);
  }).toPass({ timeout: 10000 });
});

test("rebase before another commit via drag and drop", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5, { timeout: 10000 });

  const commitC = nodes.nth(1);
  const commitB = nodes.nth(2);

  await commitC.dragTo(commitB);

  const rebaseBeforeItem = graphFrame.locator('.context-menu-item[data-action="rebaseBefore"]');
  await expect(rebaseBeforeItem).toBeVisible({ timeout: 5000 });
  await rebaseBeforeItem.click();

  await expect(nodes).toHaveCount(5, { timeout: 10000 });

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "C")).toEqual(["A"]);
    expect(getParents(logEntries, "B")).toEqual(["C"]);
  }).toPass({ timeout: 10000 });
});
