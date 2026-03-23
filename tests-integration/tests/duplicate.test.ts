import { test, expect } from "./baseTest";
import { getParents } from "../testRepo";

test("duplicate commit onto another via drag and drop", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitC = nodes.nth(1);
  const commitA = nodes.nth(3);

  await commitC.dragTo(commitA);

  const duplicateOntoItem = graphFrame.locator('.context-menu-item[data-action="duplicateOnto"]');
  await expect(duplicateOntoItem).toBeVisible();
  await duplicateOntoItem.click();

  await expect(nodes).toHaveCount(6);

  await expect(async () => {
    const logEntries = await testRepo.log();
    const cCommits = logEntries.filter((e) => e.description.trim() === "C");
    expect(cCommits).toHaveLength(2);

    const cParents = cCommits.map((c) => {
      const parentEntry = logEntries.find((e) => e.change_id === c.parents[0]?.change_id);
      return parentEntry?.description.trim() ?? "";
    });
    expect(cParents).toContain("A");
    expect(cParents).toContain("B");
    expect(getParents(logEntries, "B")).toEqual(["A"]);
  }).toPass();
});

test("duplicate after another commit via drag and drop", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitC = nodes.nth(1);
  const commitA = nodes.nth(3);

  await commitC.dragTo(commitA);

  const duplicateAfterItem = graphFrame.locator('.context-menu-item[data-action="duplicateAfter"]');
  await expect(duplicateAfterItem).toBeVisible();
  await duplicateAfterItem.click();

  await expect(nodes).toHaveCount(6);

  await expect(async () => {
    const logEntries = await testRepo.log();
    const cCommits = logEntries.filter((e) => e.description.trim() === "C");
    expect(cCommits).toHaveLength(2);

    const bEntry = logEntries.find((e) => e.description.trim() === "B");
    expect(bEntry).toBeDefined();
    expect(bEntry!.parents).toHaveLength(1);

    const bParent = logEntries.find((e) => e.change_id === bEntry!.parents[0].change_id);
    expect(bParent).toBeDefined();
    expect(bParent!.description.trim()).toBe("C");

    const cDuplicate = bParent;
    const cDuplicateParent = logEntries.find((e) => e.change_id === cDuplicate!.parents[0]?.change_id);
    expect(cDuplicateParent).toBeDefined();
    expect(cDuplicateParent!.description.trim()).toBe("A");
  }).toPass();
});

test("duplicate before another commit via drag and drop", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitC = nodes.nth(1);
  const commitB = nodes.nth(2);

  await commitC.dragTo(commitB);

  const duplicateBeforeItem = graphFrame.locator('.context-menu-item[data-action="duplicateBefore"]');
  await expect(duplicateBeforeItem).toBeVisible();
  await duplicateBeforeItem.click();

  await expect(nodes).toHaveCount(6);

  await expect(async () => {
    const logEntries = await testRepo.log();
    const cCommits = logEntries.filter((e) => e.description.trim() === "C");
    expect(cCommits).toHaveLength(2);

    const bEntry = logEntries.find((e) => e.description.trim() === "B");
    expect(bEntry).toBeDefined();
    expect(bEntry!.parents).toHaveLength(1);

    const bParent = logEntries.find((e) => e.change_id === bEntry!.parents[0].change_id);
    expect(bParent).toBeDefined();
    expect(bParent!.description.trim()).toBe("C");

    const duplicateCEntry = bParent;
    expect(duplicateCEntry!.parents).toHaveLength(1);

    const duplicateCParent = logEntries.find((e) => e.change_id === duplicateCEntry!.parents[0].change_id);
    expect(duplicateCParent).toBeDefined();
    expect(duplicateCParent!.description.trim()).toBe("A");
  }).toPass();
});
