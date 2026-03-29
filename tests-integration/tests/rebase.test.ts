import { test, expect } from "./baseTest";
import { getParents } from "../testRepo";

test("rebase commit onto another via drag and drop", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitC = nodes.nth(1);
  const commitA = nodes.nth(3);

  await commitC.dragTo(commitA);

  const rebaseItem = graphFrame.locator('.context-menu-item[data-action="rebase"]');
  await expect(rebaseItem).toBeVisible();
  await rebaseItem.hover();

  const rebaseOntoItem = graphFrame.locator('.context-submenu-item[data-action="rebaseOnto"]');
  await expect(rebaseOntoItem).toBeVisible();
  await rebaseOntoItem.click();

  await expect(nodes).toHaveCount(5);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "C")).toEqual(["A"]);
  }).toPass();
});

test("rebase after another commit via drag and drop", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitC = nodes.nth(1);
  const commitA = nodes.nth(3);

  await commitC.dragTo(commitA);

  const rebaseItem = graphFrame.locator('.context-menu-item[data-action="rebase"]');
  await expect(rebaseItem).toBeVisible();
  await rebaseItem.hover();

  const rebaseAfterItem = graphFrame.locator('.context-submenu-item[data-action="rebaseAfter"]');
  await expect(rebaseAfterItem).toBeVisible();
  await rebaseAfterItem.click();

  await expect(nodes).toHaveCount(5);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "B")).toEqual(["C"]);
  }).toPass();
});

test("rebase before another commit via drag and drop", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitC = nodes.nth(1);
  const commitB = nodes.nth(2);

  await commitC.dragTo(commitB);

  const rebaseItem = graphFrame.locator('.context-menu-item[data-action="rebase"]');
  await expect(rebaseItem).toBeVisible();
  await rebaseItem.hover();

  const rebaseBeforeItem = graphFrame.locator('.context-submenu-item[data-action="rebaseBefore"]');
  await expect(rebaseBeforeItem).toBeVisible();
  await rebaseBeforeItem.click();

  await expect(nodes).toHaveCount(5);

  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "C")).toEqual(["A"]);
    expect(getParents(logEntries, "B")).toEqual(["C"]);
  }).toPass();
});

test("rebase commit with descendants onto another via drag and drop", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitC = nodes.nth(1);
  const commitA = nodes.nth(3);

  await commitC.dragTo(commitA);

  const rebaseWithDescendantsItem = graphFrame.locator('.context-menu-item[data-action="rebaseWithDescendants"]');
  await expect(rebaseWithDescendantsItem).toBeVisible();
  await rebaseWithDescendantsItem.hover();

  const rebaseOntoWithDescendantsItem = graphFrame.locator(
    '.context-submenu-item[data-action="rebaseOntoWithDescendants"]',
  );
  await expect(rebaseOntoWithDescendantsItem).toBeVisible();
  await rebaseOntoWithDescendantsItem.click();

  await expect(nodes).toHaveCount(5);

  // Before: A -> B -> C -> @
  // After:  A --> B
  //           \-> C -> @
  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "@")).toEqual(["C"]);
    expect(getParents(logEntries, "C")).toEqual(["A"]);
    expect(getParents(logEntries, "B")).toEqual(["A"]);
  }).toPass();
});

test("rebase commit with descendants after another via drag and drop", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitC = nodes.nth(1);
  const commitA = nodes.nth(3);

  await commitC.dragTo(commitA);

  const rebaseWithDescendantsItem = graphFrame.locator('.context-menu-item[data-action="rebaseWithDescendants"]');
  await expect(rebaseWithDescendantsItem).toBeVisible();
  await rebaseWithDescendantsItem.hover();

  const rebaseAfterWithDescendantsItem = graphFrame.locator(
    '.context-submenu-item[data-action="rebaseAfterWithDescendants"]',
  );
  await expect(rebaseAfterWithDescendantsItem).toBeVisible();
  await rebaseAfterWithDescendantsItem.click();

  await expect(nodes).toHaveCount(5);

  // Before: A -> B -> C -> @
  // After:  A -> C -> @ -> B
  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "B")).toEqual(["@"]);
    expect(getParents(logEntries, "@")).toEqual(["C"]);
    expect(getParents(logEntries, "C")).toEqual(["A"]);
  }).toPass();
});

test("rebase commit with descendants before another via drag and drop", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitC = nodes.nth(1);
  const commitA = nodes.nth(3);

  await commitC.dragTo(commitA);

  const rebaseWithDescendantsItem = graphFrame.locator('.context-menu-item[data-action="rebaseWithDescendants"]');
  await expect(rebaseWithDescendantsItem).toBeVisible();
  await rebaseWithDescendantsItem.hover();

  const rebaseBeforeWithDescendantsItem = graphFrame.locator(
    '.context-submenu-item[data-action="rebaseBeforeWithDescendants"]',
  );
  await expect(rebaseBeforeWithDescendantsItem).toBeVisible();
  await rebaseBeforeWithDescendantsItem.click();

  await expect(nodes).toHaveCount(5);

  // Before: A -> B -> C -> @
  // After:  C -> @ -> A -> B
  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "B")).toEqual(["A"]);
    expect(getParents(logEntries, "A")).toEqual(["@"]);
    expect(getParents(logEntries, "@")).toEqual(["C"]);
  }).toPass();
});
