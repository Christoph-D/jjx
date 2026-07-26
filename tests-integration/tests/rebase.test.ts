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

  const rebaseItem = graphFrame.locator('[data-action="rebase"]');
  await expect(rebaseItem).toBeVisible();
  await rebaseItem.hover();

  const rebaseOntoItem = graphFrame.locator('[data-action="rebaseOnto"]');
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

  const rebaseItem = graphFrame.locator('[data-action="rebase"]');
  await expect(rebaseItem).toBeVisible();
  await rebaseItem.hover();

  const rebaseAfterItem = graphFrame.locator('[data-action="rebaseAfter"]');
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

  const rebaseItem = graphFrame.locator('[data-action="rebase"]');
  await expect(rebaseItem).toBeVisible();
  await rebaseItem.hover();

  const rebaseBeforeItem = graphFrame.locator('[data-action="rebaseBefore"]');
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

  const rebaseWithDescendantsItem = graphFrame.locator('[data-action="rebaseWithDescendants"]');
  await expect(rebaseWithDescendantsItem).toBeVisible();
  await rebaseWithDescendantsItem.hover();

  const rebaseOntoWithDescendantsItem = graphFrame.locator('[data-action="rebaseOntoWithDescendants"]');
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

  const rebaseWithDescendantsItem = graphFrame.locator('[data-action="rebaseWithDescendants"]');
  await expect(rebaseWithDescendantsItem).toBeVisible();
  await rebaseWithDescendantsItem.hover();

  const rebaseAfterWithDescendantsItem = graphFrame.locator('[data-action="rebaseAfterWithDescendants"]');
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

  const rebaseWithDescendantsItem = graphFrame.locator('[data-action="rebaseWithDescendants"]');
  await expect(rebaseWithDescendantsItem).toBeVisible();
  await rebaseWithDescendantsItem.hover();

  const rebaseBeforeWithDescendantsItem = graphFrame.locator('[data-action="rebaseBeforeWithDescendants"]');
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

test("rebase commit with descendants add parent via drag and drop", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitC = nodes.nth(1);
  const commitA = nodes.nth(3);

  await commitC.dragTo(commitA);

  const rebaseWithDescendantsItem = graphFrame.locator('[data-action="rebaseWithDescendants"]');
  await expect(rebaseWithDescendantsItem).toBeVisible();
  await rebaseWithDescendantsItem.hover();

  const rebaseAddParentItem = graphFrame.locator('[data-action="rebaseAddParentWithDescendants"]');
  await expect(rebaseAddParentItem).toBeVisible();
  await rebaseAddParentItem.click();

  await expect(nodes).toHaveCount(5);

  // Before: A -> B -> C -> @
  // After:  C is rebased onto its existing parents plus A, becoming a merge of B and A.
  //         @ stays a child of C.
  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "C").sort()).toEqual(["A", "B"]);
    expect(getParents(logEntries, "@")).toEqual(["C"]);
    expect(getParents(logEntries, "B")).toEqual(["A"]);
  }).toPass();
});

test("add parent is hidden when dropping onto an existing parent", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  // Stack: A -> B -> C -> @. B is already a parent of C.
  const commitC = nodes.nth(1);
  const commitB = nodes.nth(2);

  await commitC.dragTo(commitB);

  const rebaseWithDescendantsItem = graphFrame.locator('[data-action="rebaseWithDescendants"]');
  await expect(rebaseWithDescendantsItem).toBeVisible();
  await rebaseWithDescendantsItem.hover();

  // Adding B as a parent of C is a no-op, so the entry should be hidden.
  const rebaseAddParentItem = graphFrame.locator('[data-action="rebaseAddParentWithDescendants"]');
  await expect(rebaseAddParentItem).toBeHidden();
});

test("remove parent removes a parent of a merge via drag and drop", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  const commitC = nodes.nth(1);
  const commitA = nodes.nth(3);

  const rebaseWithDescendantsItem = graphFrame.locator('[data-action="rebaseWithDescendants"]');
  const rebaseAddParentItem = graphFrame.locator('[data-action="rebaseAddParentWithDescendants"]');
  const rebaseRemoveParentItem = graphFrame.locator('[data-action="rebaseRemoveParentWithDescendants"]');

  // First make C a merge of B and A via "Add Parent".
  await commitC.dragTo(commitA);
  await expect(rebaseWithDescendantsItem).toBeVisible();
  await rebaseWithDescendantsItem.hover();
  await expect(rebaseAddParentItem).toBeVisible();
  await rebaseAddParentItem.click();

  await expect(nodes).toHaveCount(5);

  // C is now a merge with parents A and B.
  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "C").sort()).toEqual(["A", "B"]);
  }).toPass();

  // Now drag C onto A (an existing parent). Since C has >= 2 parents,
  // "Remove Parent" should be visible and remove A from C's parents.
  await commitC.dragTo(commitA);
  await expect(rebaseWithDescendantsItem).toBeVisible();
  await rebaseWithDescendantsItem.hover();
  await expect(rebaseRemoveParentItem).toBeVisible();
  await rebaseRemoveParentItem.click();

  await expect(nodes).toHaveCount(5);

  // Before: C is a merge of A and B. After: A is removed, C is left with only B.
  await expect(async () => {
    const logEntries = await testRepo.log();
    expect(getParents(logEntries, "C")).toEqual(["B"]);
    expect(getParents(logEntries, "@")).toEqual(["C"]);
  }).toPass();
});

test("remove parent is hidden when dropping onto the only parent", async ({ graphFrame, testRepo }) => {
  await testRepo.commitFile("a.txt", "content a", "A");
  await testRepo.commitFile("b.txt", "content b", "B");
  await testRepo.commitFile("c.txt", "content c", "C");

  const nodes = graphFrame.locator("#nodes > div");
  await expect(nodes).toHaveCount(5);

  // Stack: A -> B -> C -> @. B is the only parent of C.
  const commitC = nodes.nth(1);
  const commitB = nodes.nth(2);

  await commitC.dragTo(commitB);

  const rebaseWithDescendantsItem = graphFrame.locator('[data-action="rebaseWithDescendants"]');
  await expect(rebaseWithDescendantsItem).toBeVisible();
  await rebaseWithDescendantsItem.hover();

  // C only has a single parent, so removing one would leave it with none;
  // the entry must be hidden.
  const rebaseRemoveParentItem = graphFrame.locator('[data-action="rebaseRemoveParentWithDescendants"]');
  await expect(rebaseRemoveParentItem).toBeHidden();
});
